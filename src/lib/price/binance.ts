import { z } from "zod";

import { type Candle, PriceUnavailableError, type PriceSource } from "./types";

/**
 * Binance public market data. No API key is required for either endpoint.
 *
 * The recorded response shapes and the reasoning behind the retry policy live in
 * the `binance-price-api` skill. Two things that are easy to get wrong and are
 * load-bearing here: prices come back as *strings*, and index 4 of a kline is
 * the close.
 */

const BASE_URL = "https://api.binance.com";
const SYMBOL = "BTCUSDT";
const MINUTE_MS = 60_000;

const REQUEST_TIMEOUT_MS = 5_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = [150, 400];

const tickerSchema = z.object({
  symbol: z.string(),
  price: z.string(),
});

/**
 * Klines are arrays, not objects. Only the fields resolution needs are typed;
 * the rest is accepted and ignored so an added trailing field cannot break us.
 */
const klineSchema = z
  .tuple([
    z.number(), // 0 open time (epoch ms)
    z.string(), // 1 open
    z.string(), // 2 high
    z.string(), // 3 low
    z.string(), // 4 close  <- the one that matters
    z.string(), // 5 volume
    z.number(), // 6 close time (epoch ms)
  ])
  .rest(z.unknown());

const klinesSchema = z.array(klineSchema);

/** Binance's error envelope, e.g. `{"code":-1121,"msg":"Invalid symbol."}`. */
const binanceErrorSchema = z.object({ code: z.number(), msg: z.string() });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A 4xx is our bug (bad symbol, bad range) and retrying only burns rate limit.
 * A 429 means slow down and a 418 means we are already banned — retrying into
 * either makes things worse. So only transport failures and 5xx are retried.
 */
function isRetryableStatus(status: number): boolean {
  return status >= 500;
}

async function fetchJson(path: string): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS[attempt - 1] ?? 400);

    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        // Explicit even though Next 16 no longer caches fetch by default: a
        // cached price is a fairness bug, and this line says so out loud.
        cache: "no-store",
      });
    } catch (cause) {
      lastError = cause;
      continue;
    }

    if (response.ok) {
      try {
        return (await response.json()) as unknown;
      } catch (cause) {
        throw new PriceUnavailableError("Binance returned a malformed body", { cause });
      }
    }

    const body = await response.text().catch(() => "");
    const parsedError = binanceErrorSchema.safeParse(safeJsonParse(body));
    const detail = parsedError.success
      ? `${parsedError.data.msg} (code ${parsedError.data.code})`
      : body.slice(0, 200);

    lastError = new PriceUnavailableError(
      `Binance responded ${response.status}: ${detail}`,
    );

    if (!isRetryableStatus(response.status)) throw lastError;
  }

  throw new PriceUnavailableError(
    `Binance unreachable after ${MAX_ATTEMPTS} attempts`,
    { cause: lastError },
  );
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** Epoch ms rounded down to the 1-minute candle boundary containing it. */
export function floorToMinute(timestampMs: number): number {
  return Math.floor(timestampMs / MINUTE_MS) * MINUTE_MS;
}

/** Binance sends prices as strings. Anything that is not a positive finite number is a failure, not a zero. */
function toPrice(raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new PriceUnavailableError(`Binance returned an unusable price: "${raw}"`);
  }
  return value;
}

export async function getCurrentPrice(): Promise<number> {
  const body = await fetchJson(`/api/v3/ticker/price?symbol=${SYMBOL}`);
  const parsed = tickerSchema.safeParse(body);

  if (!parsed.success) {
    throw new PriceUnavailableError("Unexpected shape from /api/v3/ticker/price");
  }

  return toPrice(parsed.data.price);
}

export async function getCandlesFrom(startMs: number, limit: number): Promise<Candle[]> {
  const clampedLimit = Math.min(Math.max(Math.trunc(limit), 1), 1000);
  // Binance rounds `startTime` UP to the next boundary, so a mid-candle value
  // silently skips the candle that contains it. Verified against the live API.
  // Left unfloored, resolution at `entryAt + 60s` would read a candle a full
  // minute late — a fairness bug that no unit test with a fake source would
  // catch, because it lives in the remote API's semantics.
  const startTime = floorToMinute(startMs);

  const body = await fetchJson(
    `/api/v3/klines?symbol=${SYMBOL}&interval=1m&startTime=${startTime}&limit=${clampedLimit}`,
  );
  const parsed = klinesSchema.safeParse(body);

  if (!parsed.success) {
    throw new PriceUnavailableError("Unexpected shape from /api/v3/klines");
  }

  return parsed.data.map(([openAt, , , , close, , closeAt]) => ({
    openAt,
    closeAt,
    close: toPrice(close),
  }));
}

/**
 * Close of the 1-minute candle containing `timestampMs`. `null` when Binance has
 * no candle there (a timestamp in the future, or a gap) — distinct from a
 * failure, which throws.
 */
export async function getPriceAt(timestampMs: number): Promise<number | null> {
  const [candle] = await getCandlesFrom(timestampMs, 1);
  if (!candle || candle.openAt > timestampMs || timestampMs > candle.closeAt) {
    return null;
  }
  return candle.close;
}

/** The production `PriceSource`, injected into the game logic by the API routes. */
export const binancePriceSource: PriceSource = {
  getCurrentPrice,
  getCandlesFrom,
};

export { MINUTE_MS, SYMBOL };
