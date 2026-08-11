// @vitest-environment node

/**
 * The API routes, exercised end to end against DynamoDB Local.
 *
 *   docker run -d -p 8000:8000 --name hodl-ddb amazon/dynamodb-local
 *
 * Only two things are faked: the cookie store, because `next/headers` needs a
 * request scope that does not exist here, and the price source, so the numbers
 * are known. The database is real — the "one guess at a time" and "resolve once"
 * guarantees are enforced by DynamoDB, and a mocked client would only prove that
 * we pass a ConditionExpression, never that it holds.
 *
 * The suite skips itself when nothing answers on the endpoint, so `npm test`
 * stays green without the container. That ergonomics is for a developer's
 * terminal only: set REQUIRE_DYNAMODB=1, as CI does, and a missing container
 * fails the run instead of quietly removing these guarantees from it.
 */

import { randomUUID } from "node:crypto";
import {
  CreateTableCommand,
  DynamoDBClient,
  ResourceInUseException,
} from "@aws-sdk/client-dynamodb";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.AWS_REGION ??= "eu-central-1";
process.env.AWS_ACCESS_KEY_ID ??= "local";
process.env.AWS_SECRET_ACCESS_KEY ??= "local";
process.env.DYNAMODB_TABLE ??= "hodl-on-a-minute-players";
process.env.DYNAMODB_ENDPOINT ??= "http://localhost:8000";
process.env.COOKIE_SECRET ??= "test-cookie-secret-at-least-32-characters";

const ENDPOINT = process.env.DYNAMODB_ENDPOINT;
const TABLE = process.env.DYNAMODB_TABLE;

/** The server's price. Nothing a client sends may ever replace it. */
const SERVER_PRICE = 60_000;

// `vi.hoisted` because `vi.mock` factories are lifted above every other
// statement and cannot close over ordinary module-scope bindings.
const { jar, price } = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  price: { current: 60_000, fails: false },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) } : undefined,
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

vi.mock("@/lib/price", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/price")>();

  const getCurrentPrice = async () => {
    if (price.fails) throw new actual.PriceUnavailableError("stubbed outage");
    return price.current;
  };

  return {
    ...actual,
    getCurrentPrice,
    binancePriceSource: { getCurrentPrice, getCandlesFrom: async () => [] },
  };
});

const containerIsUp = await fetch(ENDPOINT).then(
  () => true,
  () => false,
);

// Throwing here fails the whole file, which is the point: on a runner, a skip is
// a test that has silently stopped protecting anything — and the test that a
// client-supplied price is ignored is the one this project can least afford to
// lose without noticing.
if (!containerIsUp && process.env.REQUIRE_DYNAMODB === "1") {
  throw new Error(
    `REQUIRE_DYNAMODB=1 but nothing answers on ${ENDPOINT}. This suite carries ` +
      "the fairness guarantees, so it must run here rather than skip.",
  );
}

const guessRoute = await import("@/app/api/guess/route");
const sessionRoute = await import("@/app/api/session/route");
const { createGuess, getPlayer } = await import("@/lib/db/players");

function postGuess(body: unknown): Request {
  return new Request("http://localhost/api/guess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Establishes an identity and returns the player id the server minted. */
async function newPlayer(): Promise<string> {
  jar.clear();
  const response = await sessionRoute.GET();
  const state = (await response.json()) as { playerId: string };
  return state.playerId;
}

describe.skipIf(!containerIsUp)("the guess routes", () => {
  beforeAll(async () => {
    const admin = new DynamoDBClient({
      region: process.env.AWS_REGION,
      endpoint: ENDPOINT,
      credentials: { accessKeyId: "local", secretAccessKey: "local" },
    });

    try {
      await admin.send(
        new CreateTableCommand({
          TableName: TABLE,
          AttributeDefinitions: [
            { AttributeName: "playerId", AttributeType: "S" },
          ],
          KeySchema: [{ AttributeName: "playerId", KeyType: "HASH" }],
          BillingMode: "PAY_PER_REQUEST",
        }),
      );
    } catch (error) {
      if (!(error instanceof ResourceInUseException)) throw error;
    }
  });

  beforeEach(() => {
    price.current = SERVER_PRICE;
    price.fails = false;
  });

  /**
   * The most valuable test in the project: it documents a security decision at
   * the same time as it verifies it. If it ever fails, the game is riggable
   * from the browser console.
   */
  it("ignores a price, a timestamp and a score sent by the client", async () => {
    await newPlayer();
    const before = Date.now();

    const response = await guessRoute.POST(
      postGuess({ direction: "up", price: 1, entryAt: 0, score: 9999 }),
    );

    expect(response.status).toBe(201);
    const state = (await response.json()) as {
      playerId: string;
      score: number;
      activeGuess: { entryPrice: number; entryAt: number };
    };

    // The client asked to enter at $1. It entered at the server's price.
    expect(state.activeGuess.entryPrice).toBe(SERVER_PRICE);
    // It asked for entryAt 0. It got the server clock.
    expect(state.activeGuess.entryAt).toBeGreaterThanOrEqual(before);
    // And it did not award itself 9,999 points.
    expect(state.score).toBe(0);

    // Not just the response — what was actually written.
    const stored = await getPlayer(state.playerId);
    expect(stored?.activeGuess?.entryPrice).toBe(SERVER_PRICE);
    expect(stored?.score).toBe(0);
  });

  it("rejects a body that is not a direction", async () => {
    await newPlayer();

    const response = await guessRoute.POST(postGuess({ direction: "sideways" }));

    expect(response.status).toBe(400);
  });

  it("answers 409 to a second guess while one is in flight", async () => {
    await newPlayer();

    expect((await guessRoute.POST(postGuess({ direction: "up" }))).status).toBe(201);
    expect((await guessRoute.POST(postGuess({ direction: "down" }))).status).toBe(409);
  });

  it("creates exactly one guess when two requests race", async () => {
    const playerId = await newPlayer();

    // The double-click. Both requests read the same state and both write.
    const responses = await Promise.all([
      guessRoute.POST(postGuess({ direction: "up" })),
      guessRoute.POST(postGuess({ direction: "down" })),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);

    const stored = await getPlayer(playerId);
    expect(stored?.activeGuess).toBeDefined();
    expect(stored?.score).toBe(0);
  });

  it("keeps the guess pending and answers 503 when no price can be read", async () => {
    await newPlayer();
    price.fails = true;

    const response = await guessRoute.POST(postGuess({ direction: "up" }));

    expect(response.status).toBe(503);
  });

  it("moves the score exactly once when two reads resolve the same guess", async () => {
    const playerId = await newPlayer();

    // Placed through the data layer so the entry can be backdated past the
    // sixty-second floor; the route always stamps `Date.now()`, by design.
    await createGuess(playerId, {
      id: randomUUID(),
      direction: "up",
      entryPrice: SERVER_PRICE,
      entryAt: Date.now() - 90_000,
    });

    price.current = SERVER_PRICE + 100;

    const responses = await Promise.all([guessRoute.GET(), guessRoute.GET()]);

    // Neither caller is told off: the work was done, so both get the state.
    expect(responses.map((r) => r.status)).toEqual([200, 200]);

    const stored = await getPlayer(playerId);
    expect(stored?.score).toBe(1);
    expect(stored?.activeGuess).toBeUndefined();
    expect(stored?.history).toHaveLength(1);
  });

  it("leaves a guess pending until the minute has passed", async () => {
    const playerId = await newPlayer();

    await guessRoute.POST(postGuess({ direction: "up" }));
    price.current = SERVER_PRICE + 100;

    const response = await guessRoute.GET();
    const state = (await response.json()) as { score: number; activeGuess?: unknown };

    // The price moved, but not sixty seconds. Both conditions are cumulative.
    expect(state.activeGuess).toBeDefined();
    expect(state.score).toBe(0);
    expect((await getPlayer(playerId))?.score).toBe(0);
  });
});
