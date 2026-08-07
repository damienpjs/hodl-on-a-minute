import { describe, expect, it } from "vitest";

import {
  canResolve,
  computeDelta,
  HISTORICAL_LOOKUP_CANDLES,
  LIVE_WINDOW_MS,
  RESOLUTION_DELAY_MS,
  resolveOutcome,
} from "@/lib/game";
import { type Candle, PriceUnavailableError, type PriceSource } from "@/lib/price";
import type { ActiveGuess } from "@/lib/types";

const ENTRY_AT = 1_700_000_000_000;
const ENTRY_PRICE = 60_000;
const TARGET = ENTRY_AT + RESOLUTION_DELAY_MS;

/**
 * Both methods throw unless a test explicitly provides one, so taking an
 * unexpected branch fails loudly instead of quietly returning undefined.
 */
function priceSource(overrides: Partial<PriceSource>): PriceSource {
  return {
    getCurrentPrice: () => {
      throw new Error("getCurrentPrice was not expected on this path");
    },
    getCandlesFrom: () => {
      throw new Error("getCandlesFrom was not expected on this path");
    },
    ...overrides,
  };
}

function candle(openAt: number, close: number): Candle {
  return { openAt, closeAt: openAt + 59_999, close };
}

function guess(direction: "up" | "down" = "up"): ActiveGuess {
  return { id: "guess-1", direction, entryPrice: ENTRY_PRICE, entryAt: ENTRY_AT };
}

describe("canResolve", () => {
  it("refuses at 59 seconds even though the price moved", () => {
    expect(
      canResolve({
        entryAt: ENTRY_AT,
        now: ENTRY_AT + 59_000,
        entryPrice: ENTRY_PRICE,
        currentPrice: 60_500,
      }),
    ).toBe(false);
  });

  it("accepts at exactly 60 seconds — 'at least 60' includes the boundary", () => {
    expect(
      canResolve({
        entryAt: ENTRY_AT,
        now: TARGET,
        entryPrice: ENTRY_PRICE,
        currentPrice: 60_500,
      }),
    ).toBe(true);
  });

  it("refuses past 60 seconds while the price is unchanged", () => {
    expect(
      canResolve({
        entryAt: ENTRY_AT,
        now: ENTRY_AT + 61_000,
        entryPrice: ENTRY_PRICE,
        currentPrice: ENTRY_PRICE,
      }),
    ).toBe(false);
  });

  it("accepts past 60 seconds once the price has moved, in either direction", () => {
    const base = { entryAt: ENTRY_AT, now: ENTRY_AT + 61_000, entryPrice: ENTRY_PRICE };

    expect(canResolve({ ...base, currentPrice: 60_001 })).toBe(true);
    expect(canResolve({ ...base, currentPrice: 59_999 })).toBe(true);
  });
});

describe("computeDelta", () => {
  it("awards a point when the guess matches the move", () => {
    expect(computeDelta("up", ENTRY_PRICE, 60_001)).toBe(1);
    expect(computeDelta("down", ENTRY_PRICE, 59_999)).toBe(1);
  });

  it("takes a point when the guess contradicts the move", () => {
    expect(computeDelta("up", ENTRY_PRICE, 59_999)).toBe(-1);
    expect(computeDelta("down", ENTRY_PRICE, 60_001)).toBe(-1);
  });

  it("scores on the smallest possible move, not on a threshold", () => {
    expect(computeDelta("up", 60_000, 60_000.01)).toBe(1);
  });

  it("refuses an unchanged price rather than inventing a direction", () => {
    expect(() => computeDelta("up", ENTRY_PRICE, ENTRY_PRICE)).toThrow(
      /unchanged price/,
    );
  });
});

describe("resolveOutcome — before the delay", () => {
  it("is pending at 59 seconds without consulting the price source at all", async () => {
    const outcome = await resolveOutcome(guess(), priceSource({}), ENTRY_AT + 59_999);

    expect(outcome).toEqual({ status: "pending", reason: "too-soon" });
  });
});

describe("resolveOutcome — live window", () => {
  it("stays pending while the current price equals the entry price", async () => {
    const outcome = await resolveOutcome(
      guess(),
      priceSource({ getCurrentPrice: async () => ENTRY_PRICE }),
      TARGET + 1_000,
    );

    expect(outcome).toEqual({ status: "pending", reason: "price-unchanged" });
  });

  it("resolves against the current price and stamps the moment it was read", async () => {
    const now = TARGET + 1_000;

    const outcome = await resolveOutcome(
      guess("up"),
      priceSource({ getCurrentPrice: async () => 60_500 }),
      now,
    );

    expect(outcome).toEqual({
      status: "resolved",
      resolvedPrice: 60_500,
      delta: 1,
      resolvedAt: now,
    });
  });

  it("propagates a price failure instead of resolving blind", async () => {
    await expect(
      resolveOutcome(
        guess(),
        priceSource({
          getCurrentPrice: () => {
            throw new PriceUnavailableError("Binance unreachable");
          },
        }),
        TARGET + 1_000,
      ),
    ).rejects.toBeInstanceOf(PriceUnavailableError);
  });
});

describe("resolveOutcome — historical window", () => {
  /** Past the live window: the player closed the browser and came back later. */
  const LATE = TARGET + LIVE_WINDOW_MS + 1;

  it("reads candles from the 60-second mark, not from now", async () => {
    let requestedStart: number | undefined;

    await resolveOutcome(
      guess(),
      priceSource({
        getCandlesFrom: async (startMs) => {
          requestedStart = startMs;
          return [candle(TARGET, 60_500)];
        },
      }),
      LATE,
    );

    expect(requestedStart).toBe(TARGET);
  });

  it("asks for a bounded window rather than an open-ended scan", async () => {
    let requestedLimit: number | undefined;

    await resolveOutcome(
      guess(),
      priceSource({
        getCandlesFrom: async (_startMs, limit) => {
          requestedLimit = limit;
          return [candle(TARGET, 60_500)];
        },
      }),
      LATE,
    );

    expect(requestedLimit).toBe(HISTORICAL_LOOKUP_CANDLES);
  });

  it("skips candles that closed at the entry price and takes the first real move", async () => {
    const outcome = await resolveOutcome(
      guess("down"),
      priceSource({
        getCandlesFrom: async () => [
          candle(TARGET, ENTRY_PRICE),
          candle(TARGET + 60_000, ENTRY_PRICE),
          candle(TARGET + 120_000, 59_800),
          candle(TARGET + 180_000, 61_000),
        ],
      }),
      LATE,
    );

    expect(outcome).toEqual({
      status: "resolved",
      resolvedPrice: 59_800,
      delta: 1,
      // The candle's close time, not "now" — this is what makes a guess resolved
      // three days late still resolve against the right minute.
      resolvedAt: TARGET + 120_000 + 59_999,
    });
  });

  it("falls back to the current price when no candle in the window moved", async () => {
    const outcome = await resolveOutcome(
      guess("up"),
      priceSource({
        getCandlesFrom: async () => [candle(TARGET, ENTRY_PRICE)],
        getCurrentPrice: async () => 60_400,
      }),
      LATE,
    );

    expect(outcome).toEqual({
      status: "resolved",
      resolvedPrice: 60_400,
      delta: 1,
      resolvedAt: LATE,
    });
  });

  it("falls back to the current price when there are no candles at all", async () => {
    const outcome = await resolveOutcome(
      guess("up"),
      priceSource({
        getCandlesFrom: async () => [],
        getCurrentPrice: async () => 59_000,
      }),
      LATE,
    );

    expect(outcome).toMatchObject({ status: "resolved", resolvedPrice: 59_000, delta: -1 });
  });

  it("stays pending when even the fallback price has not moved", async () => {
    const outcome = await resolveOutcome(
      guess(),
      priceSource({
        getCandlesFrom: async () => [],
        getCurrentPrice: async () => ENTRY_PRICE,
      }),
      LATE,
    );

    expect(outcome).toEqual({ status: "pending", reason: "price-unchanged" });
  });
});
