// @vitest-environment node

/**
 * The Binance client, with `fetch` stubbed.
 *
 * Two things here are load-bearing for fairness rather than for tidiness, and
 * both are invisible when they break:
 *
 *   - `floorToMinute`. Binance rounds `startTime` *up* to the next boundary, so
 *     a mid-candle value silently skips the candle containing it. Unfloored, a
 *     guess would resolve against a minute later than it should.
 *   - The retry policy. Replaying a 429 or a 418 makes a rate-limit worse, and
 *     replaying a 4xx burns quota on a request that will never succeed.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  floorToMinute,
  getCandlesFrom,
  getCurrentPrice,
  getPriceAt,
  PriceUnavailableError,
} from "@/lib/price";

const MINUTE = 60_000;
/** An exact minute boundary, for readable arithmetic. */
const BOUNDARY = 1_700_000_040_000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** One kline in Binance's positional format; index 4 is the close. */
function kline(openAt: number, close: string) {
  return [openAt, "1", "2", "0.5", close, "10", openAt + 59_999, "0", 1, "0", "0", "0"];
}

function stubFetch(...responses: (Response | Error)[]) {
  const calls: string[] = [];
  let index = 0;

  const fetchMock = vi.fn(async (url: string | URL) => {
    calls.push(String(url));
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next instanceof Error) throw next;
    return next.clone();
  });

  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("floorToMinute", () => {
  it("leaves a value already on the boundary alone", () => {
    expect(floorToMinute(BOUNDARY)).toBe(BOUNDARY);
  });

  it("rounds down, never up", () => {
    expect(floorToMinute(BOUNDARY + 1)).toBe(BOUNDARY);
    expect(floorToMinute(BOUNDARY + 59_999)).toBe(BOUNDARY);
    expect(floorToMinute(BOUNDARY + MINUTE - 1)).toBe(BOUNDARY);
  });

  it("moves to the next boundary only once one is reached", () => {
    expect(floorToMinute(BOUNDARY + MINUTE)).toBe(BOUNDARY + MINUTE);
  });
});

describe("getCurrentPrice", () => {
  it("parses the price, which Binance sends as a string", async () => {
    stubFetch(jsonResponse({ symbol: "BTCUSDT", price: "65123.45000000" }));

    expect(await getCurrentPrice()).toBe(65_123.45);
  });

  it("refuses a price that is not a usable number", async () => {
    stubFetch(jsonResponse({ symbol: "BTCUSDT", price: "not-a-number" }));

    await expect(getCurrentPrice()).rejects.toBeInstanceOf(PriceUnavailableError);
  });

  it("refuses zero rather than treating it as a price", async () => {
    stubFetch(jsonResponse({ symbol: "BTCUSDT", price: "0" }));

    await expect(getCurrentPrice()).rejects.toBeInstanceOf(PriceUnavailableError);
  });

  it("refuses a body of the wrong shape", async () => {
    stubFetch(jsonResponse({ unexpected: true }));

    await expect(getCurrentPrice()).rejects.toBeInstanceOf(PriceUnavailableError);
  });

  it("refuses a body that is not JSON at all", async () => {
    stubFetch(new Response("<html>502 Bad Gateway</html>", { status: 200 }));

    await expect(getCurrentPrice()).rejects.toBeInstanceOf(PriceUnavailableError);
  });
});

describe("the retry policy", () => {
  it("retries a 5xx and gives up as a typed error", async () => {
    const { fetchMock } = stubFetch(jsonResponse({ msg: "down" }, 503));

    await expect(getCurrentPrice()).rejects.toBeInstanceOf(PriceUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("recovers when a retry succeeds", async () => {
    const { fetchMock } = stubFetch(
      jsonResponse({ msg: "down" }, 500),
      jsonResponse({ symbol: "BTCUSDT", price: "64000.00" }),
    );

    expect(await getCurrentPrice()).toBe(64_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a transport failure", async () => {
    const { fetchMock } = stubFetch(
      Object.assign(new Error("network down"), { code: "ECONNRESET" }),
      jsonResponse({ symbol: "BTCUSDT", price: "64000.00" }),
    );

    expect(await getCurrentPrice()).toBe(64_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    [400, "a malformed request"],
    [418, "an existing ban"],
    [429, "a rate limit"],
  ])("does not replay %i — %s", async (status) => {
    const { fetchMock } = stubFetch(
      jsonResponse({ code: -1121, msg: "Invalid symbol." }, status),
    );

    await expect(getCurrentPrice()).rejects.toBeInstanceOf(PriceUnavailableError);
    // Replaying any of these makes the situation worse, never better.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("getCandlesFrom", () => {
  it("floors startTime to the minute before asking", async () => {
    const { calls } = stubFetch(jsonResponse([kline(BOUNDARY, "65000")]));

    await getCandlesFrom(BOUNDARY + 31_000, 5);

    // Binance rounds startTime up. Sending the unfloored value would skip the
    // candle we are actually asking about.
    expect(calls[0]).toContain(`startTime=${BOUNDARY}`);
    expect(calls[0]).not.toContain(`startTime=${BOUNDARY + 31_000}`);
  });

  it("reads the close from index 4, not the open", async () => {
    stubFetch(jsonResponse([kline(BOUNDARY, "65432.10")]));

    const [candle] = await getCandlesFrom(BOUNDARY, 1);

    expect(candle.close).toBe(65_432.1);
    expect(candle.openAt).toBe(BOUNDARY);
    expect(candle.closeAt).toBe(BOUNDARY + 59_999);
  });

  it("clamps the limit into what the endpoint accepts", async () => {
    const { calls } = stubFetch(jsonResponse([kline(BOUNDARY, "65000")]));

    await getCandlesFrom(BOUNDARY, 5_000);
    expect(calls[0]).toContain("limit=1000");

    await getCandlesFrom(BOUNDARY, 0);
    expect(calls[1]).toContain("limit=1");
  });

  it("refuses a shape it does not recognise", async () => {
    stubFetch(jsonResponse({ not: "an array" }));

    await expect(getCandlesFrom(BOUNDARY, 1)).rejects.toBeInstanceOf(
      PriceUnavailableError,
    );
  });

  it("accepts extra trailing fields, so a new one cannot break us", async () => {
    stubFetch(jsonResponse([[...kline(BOUNDARY, "65000"), "brand", "new"]]));

    const [candle] = await getCandlesFrom(BOUNDARY, 1);
    expect(candle.close).toBe(65_000);
  });
});

describe("getPriceAt", () => {
  it("returns the close of the candle containing the timestamp", async () => {
    stubFetch(jsonResponse([kline(BOUNDARY, "65000")]));

    expect(await getPriceAt(BOUNDARY + 30_000)).toBe(65_000);
  });

  it("returns null — not a guess — when there is no candle there", async () => {
    stubFetch(jsonResponse([]));

    expect(await getPriceAt(BOUNDARY)).toBeNull();
  });

  it("returns null when the candle returned is not the one asked for", async () => {
    // Binance answered with a later candle; the timestamp falls outside it.
    stubFetch(jsonResponse([kline(BOUNDARY + 10 * MINUTE, "65000")]));

    expect(await getPriceAt(BOUNDARY)).toBeNull();
  });
});
