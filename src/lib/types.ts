/**
 * Domain types shared by the game logic, the data layer and the API routes.
 *
 * Every price and timestamp in here is produced by the server. None of these
 * shapes is ever built from a request body — see the `fairness-invariants`
 * skill, invariant I1.
 */

export type Direction = "up" | "down";

/** The single in-flight guess a player may have. Absent means "free to guess". */
export type ActiveGuess = {
  /** UUID. Resolution is conditioned on this, which is what makes it idempotent. */
  id: string;
  direction: Direction;
  /** Fetched server-side when the guess was written. */
  entryPrice: number;
  /** Server clock, epoch ms. */
  entryAt: number;
};

/** The outcome of the previous guess, kept so the UI can show what just happened. */
export type LastResult = {
  direction: Direction;
  entryPrice: number;
  resolvedPrice: number;
  delta: 1 | -1;
  resolvedAt: number;
};

/** One item per player in the `hodl-on-a-minute-players` table. */
export type PlayerItem = {
  playerId: string;
  score: number;
  activeGuess?: ActiveGuess;
  lastResult?: LastResult;
  createdAt: number;
  updatedAt: number;
};
