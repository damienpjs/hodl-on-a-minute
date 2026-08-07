import type { ActiveGuess, LastResult, PlayerItem } from "@/lib/types";

/**
 * What every game route returns. Declared as a projection rather than shipping
 * the raw item so that adding a column to the table never accidentally becomes a
 * change to the public API.
 */
export type GameState = {
  playerId: string;
  score: number;
  activeGuess?: ActiveGuess;
  lastResult?: LastResult;
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
    lastResult: player.lastResult,
  };
}
