// @vitest-environment node

/**
 * What the API says when the database cannot be reached.
 *
 * Before this, any store failure surfaced as a bare 500 with an empty body —
 * indistinguishable from a bug in our own code, and useless to the player. The
 * price side already had `PriceUnavailableError` and a 503; this is its
 * counterpart, and these tests are what keep the two consistent.
 */

import { describe, expect, it, vi } from "vitest";

import { asStoreFailure, DataStoreUnavailableError } from "@/lib/db/errors";

process.env.AWS_REGION ??= "eu-central-1";
process.env.AWS_ACCESS_KEY_ID ??= "local";
process.env.AWS_SECRET_ACCESS_KEY ??= "local";
process.env.DYNAMODB_TABLE ??= "hodl-on-a-minute-players";
process.env.COOKIE_SECRET ??= "test-cookie-secret-at-least-32-characters";

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) } : undefined,
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

// The data layer is replaced wholesale, but the error classes stay real —
// `instanceof` in the routes has to match the type the routes import.
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const down = () => {
    throw new actual.DataStoreUnavailableError();
  };

  return {
    ...actual,
    getOrCreatePlayer: down,
    getPlayer: down,
    createGuess: down,
    resolveGuess: down,
  };
});

const guessRoute = await import("@/app/api/guess/route");
const sessionRoute = await import("@/app/api/session/route");

function postGuess(body: unknown): Request {
  return new Request("http://localhost/api/guess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("asStoreFailure — whose fault is it", () => {
  it("treats a refused connection as the store being down", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });

    expect(asStoreFailure(refused)).toBeInstanceOf(DataStoreUnavailableError);
  });

  it("treats a timeout as the store being down", () => {
    expect(
      asStoreFailure(Object.assign(new Error("timed out"), { name: "TimeoutError" })),
    ).toBeInstanceOf(DataStoreUnavailableError);
  });

  it("treats a 5xx as the store being down", () => {
    expect(
      asStoreFailure({ name: "InternalServerError", $metadata: { httpStatusCode: 500 } }),
    ).toBeInstanceOf(DataStoreUnavailableError);
  });

  it.each([
    "ThrottlingException",
    "ProvisionedThroughputExceededException",
    "RequestLimitExceeded",
    "ResourceNotFoundException",
  ])("treats %s as the store being down", (name) => {
    expect(
      asStoreFailure({ name, $metadata: { httpStatusCode: 400 } }),
    ).toBeInstanceOf(DataStoreUnavailableError);
  });

  /**
   * The one failure the infrastructure is designed to cause. A $1 monthly
   * budget action attaches an explicit Deny on dynamodb:* to the application's
   * IAM user; the policy is detached at the start of the next budget period.
   * That is an outage that ends by itself, so it must not read as a crash.
   */
  it("treats the cost breaker firing as the store being down", () => {
    const denied = {
      name: "AccessDeniedException",
      $metadata: { httpStatusCode: 400 },
    };

    expect(asStoreFailure(denied)).toBeInstanceOf(DataStoreUnavailableError);
  });

  it.each(["UnrecognizedClientException", "InvalidSignatureException"])(
    "lets %s through, because that is a broken deployment and not weather",
    (name) => {
      const misconfigured = { name, $metadata: { httpStatusCode: 403 } };

      expect(asStoreFailure(misconfigured)).toBe(misconfigured);
    },
  );

  /**
   * The important negative case. A malformed request is *our* bug, and dressing
   * it up as a transient outage would hide it behind a retry loop forever.
   */
  it("passes a bad request straight through, because that one is on us", () => {
    const validation = {
      name: "ValidationException",
      $metadata: { httpStatusCode: 400 },
    };

    expect(asStoreFailure(validation)).toBe(validation);
    expect(asStoreFailure(validation)).not.toBeInstanceOf(DataStoreUnavailableError);
  });

  it("passes an ordinary programming error through untouched", () => {
    const bug = new TypeError("cannot read properties of undefined");

    expect(asStoreFailure(bug)).toBe(bug);
  });

  it("keeps the original error as the cause, so the log still says why", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });

    expect((asStoreFailure(refused) as DataStoreUnavailableError).cause).toBe(refused);
  });
});

describe("the routes with the store down", () => {
  it("answers 503 on the session read, not 500", async () => {
    const response = await sessionRoute.GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(await response.json()).toEqual({
      error: expect.stringContaining("data store"),
    });
  });

  it("answers 503 when a guess cannot be written", async () => {
    const response = await guessRoute.POST(postGuess({ direction: "up" }));

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
  });

  it("answers 503 when the state cannot be read", async () => {
    const response = await guessRoute.GET();

    expect(response.status).toBe(503);
  });

  it("still rejects a malformed body before it ever reaches the store", async () => {
    const response = await guessRoute.POST(postGuess({ direction: "sideways" }));

    // 400 beats 503: the request was wrong on its own terms, and retrying it
    // unchanged would never work.
    expect(response.status).toBe(400);
  });
});
