/** One 1-minute Binance candle, reduced to what resolution actually needs. */
export type Candle = {
  /** Epoch ms, aligned to the minute. */
  openAt: number;
  /** Epoch ms, `openAt + 59_999`. */
  closeAt: number;
  /** Close price. This is the value a guess resolves against. */
  close: number;
};

/**
 * The price capability, expressed as an interface so `src/lib/game/` can depend
 * on it without depending on Binance — and so tests can satisfy it with a plain
 * object literal instead of a mocking framework.
 */
export type PriceSource = {
  /** Latest traded price. Throws `PriceUnavailableError` if it cannot be had. */
  getCurrentPrice(): Promise<number>;
  /**
   * Consecutive 1-minute candles starting at the candle containing `startMs`.
   * Empty when the range is in the future or holds no data — never a guess.
   */
  getCandlesFrom(startMs: number, limit: number): Promise<Candle[]>;
};

/**
 * Raised whenever a price cannot be established. It exists so callers can tell
 * "the market did not move" from "we do not know whether it moved" — the second
 * must leave the guess pending, never resolve it.
 */
export class PriceUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PriceUnavailableError";
  }
}
