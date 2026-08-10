"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { fetchServerPrice } from "@/lib/client/api";

/**
 * The displayed price, from Binance's public trade stream.
 *
 * This feed is *comfort only*. It never prices a guess — that happens
 * server-side inside POST /api/guess — so a browser that tampers with it changes
 * nothing but its own display. Streaming straight from Binance also keeps the
 * ticker smooth without hammering our own routes.
 *
 * When the socket is blocked (corporate proxy, offline), we fall back to polling
 * our own /api/price. Slower and less pretty, but the game stays playable.
 */

const BINANCE_TRADE_STREAM = "wss://stream.binance.com:9443/ws/btcusdt@trade";

/** A socket that connects but never delivers is a failure too — just a quiet one. */
const FIRST_MESSAGE_TIMEOUT_MS = 5_000;

const SERVER_POLL_INTERVAL_MS = 3_000;

/**
 * How much the displayed price can be trusted, worst to best:
 *
 * - `offline`   — nothing is answering. Any price shown is stale.
 * - `connecting`— no price yet, but nothing has failed either.
 * - `degraded`  — the Binance socket is down; polling our own route instead.
 * - `live`      — streaming from Binance, updating on every trade.
 *
 * Only `live` earns the green dot. Saying "live" while quietly serving a
 * three-second-old poll would be a small lie, and this app is about not telling
 * those.
 */
export type PriceStatus = "offline" | "connecting" | "degraded" | "live";

/** One sampled point of the trace. */
export type PriceTick = { at: number; price: number };

export type PriceFeed = {
  price: number | null;
  status: PriceStatus;
  /** Rolling window of samples, oldest first, for the chart. */
  ticks: PriceTick[];
};

/** Long enough to cover a full round plus its run-up. */
const TICK_WINDOW_MS = 120_000;

/**
 * BTCUSDT trades many times a second. The displayed number follows every one of
 * them, but the trace samples at this rate — a few hundred points is already
 * more resolution than a 300px-tall chart can show, and storing every trade
 * would grow without bound for no visible gain.
 */
const TICK_SAMPLE_MS = 500;

export function useLivePrice(): PriceFeed {
  const [streamPrice, setStreamPrice] = useState<number | null>(null);
  const [streamFailed, setStreamFailed] = useState(false);
  const [ticks, setTicks] = useState<PriceTick[]>([]);
  const lastSampleAt = useRef(0);

  useEffect(() => {
    let cancelled = false;

    // Armed before the socket exists on purpose. If the constructor itself
    // throws — a blocked scheme, a hostile environment — there is no event to
    // listen for, and this timer is what moves us to the fallback. It also keeps
    // every state change inside a callback rather than in the effect body.
    const giveUp = setTimeout(() => {
      if (!cancelled) setStreamFailed(true);
    }, FIRST_MESSAGE_TIMEOUT_MS);

    let socket: WebSocket | undefined;
    try {
      socket = new WebSocket(BINANCE_TRADE_STREAM);
    } catch {
      socket = undefined;
    }

    socket?.addEventListener("message", (event: MessageEvent<string>) => {
      if (cancelled) return;

      const price = readTradePrice(event.data);
      if (price === null) return;

      clearTimeout(giveUp);
      setStreamPrice(price);
      setStreamFailed(false);

      // Only the stream feeds the trace. When it dies the line stops growing
      // rather than continuing at the fallback's three-second granularity — a
      // coarse line drawn as if it were live would misrepresent the data, and
      // the badge already says the feed is degraded.
      const at = Date.now();
      if (at - lastSampleAt.current < TICK_SAMPLE_MS) return;
      lastSampleAt.current = at;

      setTicks((previous) =>
        [...previous, { at, price }].filter(
          (tick) => at - tick.at <= TICK_WINDOW_MS,
        ),
      );
    });

    // `close` also fires on our own teardown, hence the `cancelled` guard.
    const fail = () => {
      if (!cancelled) setStreamFailed(true);
    };
    socket?.addEventListener("error", fail);
    socket?.addEventListener("close", fail);

    return () => {
      cancelled = true;
      clearTimeout(giveUp);
      socket?.close();
    };
  }, []);

  // Kept enabled once we have fallen back rather than toggling with the socket:
  // one request every three seconds is cheap, and flapping between two sources
  // would show the player a jittering price.
  const serverPrice = useQuery({
    queryKey: ["server-price"],
    queryFn: ({ signal }) => fetchServerPrice(signal),
    enabled: streamFailed,
    refetchInterval: SERVER_POLL_INTERVAL_MS,
  });

  if (!streamFailed) {
    return streamPrice === null
      ? { price: null, status: "connecting", ticks }
      : { price: streamPrice, status: "live", ticks };
  }

  // Fallen back. The last streamed price is better than nothing while the first
  // poll is in flight, but it is stale by definition — so the status says so.
  const price = serverPrice.data ?? streamPrice;

  if (serverPrice.isError) return { price, status: "offline", ticks };

  return { price, status: price === null ? "connecting" : "degraded", ticks };
}

/**
 * Binance trade payload: `{"e":"trade","s":"BTCUSDT","p":"65000.00", ...}`.
 * Anything unparseable is dropped rather than shown as a zero.
 */
function readTradePrice(raw: string): number | null {
  try {
    const message: unknown = JSON.parse(raw);

    if (!message || typeof message !== "object" || !("p" in message)) return null;

    const { p } = message as { p: unknown };
    if (typeof p !== "string") return null;

    const price = Number(p);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}
