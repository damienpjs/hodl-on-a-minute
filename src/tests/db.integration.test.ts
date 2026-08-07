// @vitest-environment node

/**
 * Integration tests for the data layer, run against DynamoDB Local.
 *
 *   docker run -d -p 8000:8000 --name hodl-ddb amazon/dynamodb-local
 *
 * These exist because the two guarantees they cover — "one guess at a time" and
 * "resolve exactly once" — are enforced by DynamoDB, not by our code. A unit
 * test with a mocked client would only assert that we *pass* a
 * ConditionExpression, never that the condition actually holds under a race.
 * So both tests fire two genuinely concurrent calls and check that exactly one
 * wins.
 *
 * The suite skips itself when nothing is listening on the endpoint, so `npm test`
 * stays green on a machine — or a CI runner — without the container.
 */

import {
  CreateTableCommand,
  DynamoDBClient,
  ResourceInUseException,
} from "@aws-sdk/client-dynamodb";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

// Set before anything reads it: getServerEnv() is lazy, so assigning here is
// early enough, and it keeps the suite self-contained rather than depending on
// whether the runner happened to load .env.local.
process.env.AWS_REGION ??= "eu-central-1";
process.env.AWS_ACCESS_KEY_ID ??= "local";
process.env.AWS_SECRET_ACCESS_KEY ??= "local";
process.env.DYNAMODB_TABLE ??= "hodl-on-a-minute-players";
process.env.DYNAMODB_ENDPOINT ??= "http://localhost:8000";
process.env.COOKIE_SECRET ??= "test-cookie-secret-at-least-32-characters";

const ENDPOINT = process.env.DYNAMODB_ENDPOINT;
const TABLE = process.env.DYNAMODB_TABLE;

// DynamoDB Local answers a bare GET with an HTTP error, which still resolves the
// promise. Only a refused connection rejects, and that is what "not running"
// looks like.
const containerIsUp = await fetch(ENDPOINT).then(
  () => true,
  () => false,
);

const { createGuess, getOrCreatePlayer, getPlayer, resolveGuess } = await import(
  "@/lib/db/players"
);
const { GuessAlreadyActiveError, GuessAlreadyResolvedError } = await import(
  "@/lib/db/errors"
);

function aGuess() {
  return {
    id: randomUUID(),
    direction: "up" as const,
    entryPrice: 60_000,
    entryAt: Date.now(),
  };
}

describe.skipIf(!containerIsUp)("data layer against DynamoDB Local", () => {
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
      // Already created by a previous run. Anything else is a real failure.
      if (!(error instanceof ResourceInUseException)) throw error;
    }
  });

  it("creates a new player with a score of zero and no guess", async () => {
    const player = await getOrCreatePlayer(randomUUID());

    expect(player.score).toBe(0);
    expect(player.activeGuess).toBeUndefined();
  });

  it("returns the same player on a second call rather than resetting them", async () => {
    const playerId = randomUUID();
    await getOrCreatePlayer(playerId);
    await createGuess(playerId, aGuess());

    const again = await getOrCreatePlayer(playerId);

    expect(again.playerId).toBe(playerId);
    expect(again.activeGuess).toBeDefined();
  });

  it("accepts exactly one of two concurrent guesses", async () => {
    const playerId = randomUUID();
    await getOrCreatePlayer(playerId);

    // The double-click case. Both calls check and write at the same time; only
    // the ConditionExpression can separate them.
    const outcomes = await Promise.allSettled([
      createGuess(playerId, aGuess()),
      createGuess(playerId, aGuess()),
    ]);

    const accepted = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");

    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(GuessAlreadyActiveError);
  });

  it("refuses a guess while one is already in flight", async () => {
    const playerId = randomUUID();
    await getOrCreatePlayer(playerId);
    await createGuess(playerId, aGuess());

    await expect(createGuess(playerId, aGuess())).rejects.toBeInstanceOf(
      GuessAlreadyActiveError,
    );
  });

  it("moves the score exactly once when a guess is resolved twice concurrently", async () => {
    const playerId = randomUUID();
    await getOrCreatePlayer(playerId);
    const guess = aGuess();
    await createGuess(playerId, guess);

    const lastResult = {
      direction: guess.direction,
      entryPrice: guess.entryPrice,
      resolvedPrice: 60_100,
      delta: 1 as const,
      resolvedAt: Date.now(),
    };

    const outcomes = await Promise.allSettled([
      resolveGuess(playerId, guess.id, 1, lastResult),
      resolveGuess(playerId, guess.id, 1, lastResult),
    ]);

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);

    const final = await getPlayer(playerId);
    expect(final?.score).toBe(1);
    expect(final?.activeGuess).toBeUndefined();
    expect(final?.lastResult?.resolvedPrice).toBe(60_100);
  });

  it("rejects a second resolution of an already-resolved guess", async () => {
    const playerId = randomUUID();
    await getOrCreatePlayer(playerId);
    const guess = aGuess();
    await createGuess(playerId, guess);

    const lastResult = {
      direction: guess.direction,
      entryPrice: guess.entryPrice,
      resolvedPrice: 59_900,
      delta: -1 as const,
      resolvedAt: Date.now(),
    };

    await resolveGuess(playerId, guess.id, -1, lastResult);

    await expect(
      resolveGuess(playerId, guess.id, -1, lastResult),
    ).rejects.toBeInstanceOf(GuessAlreadyResolvedError);

    const final = await getPlayer(playerId);
    expect(final?.score).toBe(-1);
  });
});
