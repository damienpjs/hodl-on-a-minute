import type { Candle, PriceSource } from "@/lib/price/types";
import type { ActiveGuess, Direction } from "@/lib/types";

/**
 * The resolution rules, as pure functions.
 *
 * Nothing in this file reads the clock or the network. `now` is an argument and
 * prices arrive through the injected `PriceSource`, which means every rule below
 * can be tested with plain numbers and an object literal — no mocking framework,
 * no fake timers. That matters because a wrong comparator here does not crash:
 * it produces a game that runs perfectly and quietly cheats.
 */

/** "at least 60 seconds have passed since the guess was made". */
export const RESOLUTION_DELAY_MS = 60_000;

/**
 * How long after the 60-second mark we still trust the *current* price.
 *
 * Inside this window the player is almost certainly still watching, so the live
 * price is both correct and what they see on screen. Past it they were away, and
 * resolving a three-day-old guess against today's price would satisfy the letter
 * of the rule while betraying it — hence the historical path below.
 */
export const LIVE_WINDOW_MS = 2 * 60_000;

/** One hour of 1-minute candles. Bounded on purpose: no unbounded search. */
export const HISTORICAL_LOOKUP_CANDLES = 60;

export type Outcome =
  | { status: "pending"; reason: "too-soon" | "price-unchanged" }
  | {
      status: "resolved";
      resolvedPrice: number;
      delta: 1 | -1;
      /** When the resolving price was observed — the candle close, historically. */
      resolvedAt: number;
    };

/** Whether the 60-second floor has been cleared. Exactly 60s counts. */
export function hasWaitedLongEnough(entryAt: number, now: number): boolean {
  return now - entryAt >= RESOLUTION_DELAY_MS;
}

/**
 * Both conditions of the assignment, together: the delay has elapsed *and* the
 * price has actually moved. Either one alone leaves the guess pending.
 *
 * Named arguments rather than four positional numbers: `(entryAt, now,
 * entryPrice, currentPrice)` is four values of the same type in a row, and
 * swapping a pair by accident is exactly the kind of bug that never throws.
 */
export function canResolve(args: {
  entryAt: number;
  now: number;
  entryPrice: number;
  currentPrice: number;
}): boolean {
  return (
    hasWaitedLongEnough(args.entryAt, args.now) &&
    args.currentPrice !== args.entryPrice
  );
}

/**
 * +1 when the guessed direction matches the move, -1 otherwise.
 *
 * Equal prices are rejected rather than defaulted. There is no honest answer to
 * "did the price go up?" when it did not move, and silently picking one would
 * make the game wrong in a way no player could ever see.
 */
export function computeDelta(
  direction: Direction,
  entryPrice: number,
  resolvedPrice: number,
): 1 | -1 {
  if (resolvedPrice === entryPrice) {
    throw new Error(
      "computeDelta called on an unchanged price — guard with canResolve first",
    );
  }

  const actual: Direction = resolvedPrice > entryPrice ? "up" : "down";
  return actual === direction ? 1 : -1;
}

function resolvedAgainst(
  guess: ActiveGuess,
  resolvedPrice: number,
  resolvedAt: number,
): Outcome {
  return {
    status: "resolved",
    resolvedPrice,
    delta: computeDelta(guess.direction, guess.entryPrice, resolvedPrice),
    resolvedAt,
  };
}

/** First candle whose close actually differs from the entry price. */
function firstMove(candles: Candle[], entryPrice: number): Candle | undefined {
  return candles.find((candle) => candle.close !== entryPrice);
}

/**
 * Decides what should happen to a guess, without touching the database.
 *
 * Two paths, chosen by how late we are:
 *
 * - **Live** (within `LIVE_WINDOW_MS` of the 60-second mark): resolve against the
 *   current price. The player is watching; this is the price they see.
 * - **Historical** (later): resolve against the first 1-minute candle after the
 *   60-second mark whose close differs from the entry price. This is what makes
 *   "close your browser and come back" fair rather than merely functional.
 *
 * A `PriceUnavailableError` from the source propagates untouched. The caller must
 * leave the guess pending — never resolve arbitrarily to unblock a player.
 */
export async function resolveOutcome(
  guess: ActiveGuess,
  priceSource: PriceSource,
  now: number,
): Promise<Outcome> {
  const target = guess.entryAt + RESOLUTION_DELAY_MS;

  if (now < target) return { status: "pending", reason: "too-soon" };

  if (now - target < LIVE_WINDOW_MS) {
    const currentPrice = await priceSource.getCurrentPrice();

    if (currentPrice === guess.entryPrice) {
      return { status: "pending", reason: "price-unchanged" };
    }
    return resolvedAgainst(guess, currentPrice, now);
  }

  const candles = await priceSource.getCandlesFrom(
    target,
    HISTORICAL_LOOKUP_CANDLES,
  );
  const moved = firstMove(candles, guess.entryPrice);

  if (moved) return resolvedAgainst(guess, moved.close, moved.closeAt);

  // An hour of identical closes, or no candles at all — a halted or gapped
  // market. Fall back to the current price rather than inventing one, and stay
  // pending if even that has not moved.
  const fallback = await priceSource.getCurrentPrice();

  if (fallback === guess.entryPrice) {
    return { status: "pending", reason: "price-unchanged" };
  }
  return resolvedAgainst(guess, fallback, now);
}
