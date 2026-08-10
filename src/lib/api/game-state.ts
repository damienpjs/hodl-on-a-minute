import type { ActiveGuess, LastResult, PlayerItem } from "@/lib/types";

/**
 * What every game route returns. Declared as a projection rather than shipping
 * the raw item so that adding a column to the table never accidentally becomes a
 * change to the public API.
 */

/**
 * How many past guesses a response carries.
 *
 * The stored list has no server-side bound — DynamoDB cannot trim one in the
 * same write that appends to it — so the bound is applied here instead. The item
 * may grow; the payload cannot.
 */
export const HISTORY_PAGE_SIZE = 20;

export type GameState = {
  playerId: string;
  score: number;
  activeGuess?: ActiveGuess;
  /** Resolved guesses, newest first, capped at `HISTORY_PAGE_SIZE`. */
  history: LastResult[];
  /**
   * Set when the price source could not be reached. The guess stays pending and
   * the UI can say so, which is the honest alternative to resolving blind.
   */
  priceUnavailable?: true;
};

export function toGameState(player: PlayerItem): GameState {
  return {
    playerId: player.playerId,
    score: player.score,
    activeGuess: player.activeGuess,
    history: (player.history ?? []).slice(0, HISTORY_PAGE_SIZE),
  };
}
