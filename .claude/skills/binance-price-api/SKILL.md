---
name: binance-price-api
description: The Binance public endpoints HODL On A Minute uses, with real recorded responses, quotas and error handling. Load when touching src/lib/price/ or the client price display.
---

# Binance price API

No API key is required for any endpoint below. **The recorded responses in this file are
the source of truth for the types** — not the published documentation, and never an
assumption. Responses below were captured on 2026-08-07 against `api.binance.com`.

## Current price — `GET /api/v3/ticker/price`

```
https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT
```

```json
{ "symbol": "BTCUSDT", "price": "65193.12000000" }
```

**`price` is a string, not a number.** Parse it with `Number()` and reject `NaN` rather
than trusting the shape.

## Historical price — `GET /api/v3/klines`

```
https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=<ms>&limit=<n>
```

Returns an array of arrays — no field names:

```json
[
  [1786109700000,"65298.47000000","65307.81000000","65264.44000000","65303.32000000","19.71602000",1786109759999,"1287259.15414930",5908,"12.18093000","795292.60891610","0"],
  [1786109760000,"65303.33000000","65305.17000000","65193.11000000","65193.12000000","17.30264000",1786109819999,"1128974.39070490",6889,"6.63262000","432785.89905500","0"]
]
```

| Index | Meaning     | Type   |
| ----- | ----------- | ------ |
| 0     | Open time   | number (epoch ms) |
| 1     | Open        | string |
| 2     | High        | string |
| 3     | Low         | string |
| 4     | **Close**   | string |
| 5     | Volume      | string |
| 6     | Close time  | number (epoch ms) |
| 7     | Quote volume| string |
| 8     | Trade count | number |

**Index 4 (close) is the price this app resolves against.** Open times are aligned to
the minute, so `startTime` is rounded down into the candle containing it — pass
`entryAt + 60_000` and read forward until a close differs from the entry price.

This endpoint is the reason Binance was chosen over CoinGecko: it makes resolution
possible for a player who closed the browser and came back days later.

## Errors

Invalid symbol returns **HTTP 400** with:

```json
{ "code": -1121, "msg": "Invalid symbol." }
```

- `429` — rate limit exceeded; a `Retry-After` header may be present.
- `418` — banned after repeatedly ignoring 429. Do not retry into this.
- `451` / connection failure — Binance blocks some regions. Vercel's default region
  works; note it in the README if the deploy region has to move.

Weight limit is 6000 per minute per IP; `ticker/price` for one symbol costs 2 and
`klines` costs 2. This app is nowhere near the limit, so no client-side throttling is
warranted — but a failing price source must still surface as
`PriceUnavailableError` and leave the guess pending. **Never let a price failure resolve
a guess.**

## Live display — WebSocket

```
wss://stream.binance.com:9443/ws/btcusdt@trade
```

Message: `{ "e": "trade", "E": <ms>, "s": "BTCUSDT", "p": "65193.12000000", ... }` —
`p` is the trade price, again a string.

**This stream is browser-side and cosmetic only.** It makes the number feel alive; it is
never an input to resolution. If it fails, fall back to polling `/api/price`.
