/**
 * Both of these are *expected* outcomes of a conditional write, not faults.
 * They exist so the API routes can map a lost race to the right HTTP status
 * without inspecting AWS SDK internals.
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
