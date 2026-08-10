/**
 * The first two are *expected* outcomes of a conditional write, not faults.
 * They exist so the API routes can map a lost race to the right HTTP status
 * without inspecting AWS SDK internals. The third says the store itself is the
 * problem, which is a different answer to the caller entirely.
 */

/** A guess was already in flight. The caller should answer 409. */
export class GuessAlreadyActiveError extends Error {
  constructor() {
    super("A guess is already active for this player");
    this.name = "GuessAlreadyActiveError";
  }
}

/**
 * Another concurrent call resolved this guess first. Not an error for the
 * player: the work was done, so the caller should re-read and return 200.
 */
export class GuessAlreadyResolvedError extends Error {
  constructor() {
    super("This guess was already resolved");
    this.name = "GuessAlreadyResolvedError";
  }
}

/**
 * The data store could not be reached, or refused to serve us. Transient by
 * assumption, so the caller answers 503 and invites a retry — as opposed to a
 * 500, which tells the player nothing and tells us it was our own bug.
 *
 * This is the counterpart of `PriceUnavailableError` on the price side. Both
 * exist for the same reason: "we do not know" must be distinguishable from "we
 * know, and the answer is no".
 */
export class DataStoreUnavailableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("The data store is unavailable", options);
    this.name = "DataStoreUnavailableError";
  }
}

const THROTTLING_ERRORS = new Set([
  "ThrottlingException",
  "ProvisionedThroughputExceededException",
  "RequestLimitExceeded",
  // The table is gone or misconfigured. From a caller's point of view that is
  // indistinguishable from the store being down, and it is certainly not a bad
  // request on their part.
  "ResourceNotFoundException",
]);

/**
 * Decides whether a failure belongs to the store or to us, and returns the error
 * to throw.
 *
 * Deliberately narrow. A 4xx from DynamoDB means the request we built was wrong
 * — a bug — and is passed through untouched so it surfaces loudly as a 500.
 * Only a missing response, a 5xx, or a throttle become `DataStoreUnavailableError`.
 */
export function asStoreFailure(error: unknown): unknown {
  const candidate = error as {
    name?: string;
    code?: string;
    $metadata?: { httpStatusCode?: number };
  };

  const status = candidate?.$metadata?.httpStatusCode;

  const transportFailure =
    typeof candidate?.code === "string" && candidate.code.startsWith("E");
  const timedOut = candidate?.name === "TimeoutError";
  const serviceFailure = typeof status === "number" && status >= 500;
  const throttled =
    typeof candidate?.name === "string" && THROTTLING_ERRORS.has(candidate.name);

  if (transportFailure || timedOut || serviceFailure || throttled) {
    return new DataStoreUnavailableError({ cause: error });
  }
  return error;
}
