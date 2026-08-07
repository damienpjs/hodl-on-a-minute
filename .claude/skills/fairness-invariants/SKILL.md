---
name: fairness-invariants
description: The non-negotiable fairness and integrity rules of HODL On A Minute, written to be checkable. Load when writing or reviewing API routes, Zod schemas, session handling, or resolution logic.
---

# Fairness invariants

The assignment says guesses must be "resolved fairly". Everything below follows from one
sentence: **the browser is a view, the server is the truth.** These rules are written so
they can be checked against a diff, not just agreed with.

## I1 — The client never supplies a price or a timestamp

The only thing a client may send about a guess is its direction.

- Entry price: fetched server-side at the moment the guess is written.
- Entry timestamp: the server clock, via `Date.now()` inside the route handler.
- Resolution price: fetched server-side.

**How to check:** search request-body Zod schemas for `price`, `timestamp`, `entryAt`,
`time`, `now`, `score`. Any hit is a violation. The guess schema is exactly
`z.object({ direction: z.enum(["up", "down"]) })`.

**Why it matters:** if the browser sends "I bet at $65,000", the game is riggable from
the console in one line.

## I2 — Identity is a signed httpOnly cookie

The player id is a server-generated UUID in an httpOnly, `secure`, `sameSite=lax`
cookie, signed with `COOKIE_SECRET`.

**How to check:** no `localStorage` / `sessionStorage` anywhere near identity. No
`playerId` in any request body, query string or non-cookie header. Cookie writes set
`httpOnly: true`. The signature is verified before the id is trusted, and a bad
signature yields a **new** player rather than the claimed one.

**Why it matters:** identity determines the score. An identity the client can edit is a
score the client can edit.

## I3 — "One guess at a time" is enforced by the database

Creating a guess uses `ConditionExpression: 'attribute_not_exists(activeGuess)'`.

**How to check:** the create path must not decide on a prior read. A pattern of
`const p = await getPlayer(); if (p.activeGuess) return 409;` followed by an
unconditional write is a violation even though it looks correct — two concurrent
requests both pass the read and both write.

**Why it matters:** a double-click must create one guess, not two.

## I4 — Resolution is idempotent

Resolving uses `ConditionExpression: 'activeGuess.id = :guessId'` together with
`SET score = score + :delta REMOVE activeGuess`, in a single update.

**How to check:** the score increment and the removal of `activeGuess` are one atomic
`UpdateCommand`, conditioned on the guess id. Never a read, then a separate write.

**Why it matters:** the resolve path is reachable concurrently (polling, two tabs). It
must be able to run twice and count once.

## I5 — Resolution requires both conditions

A guess resolves only when **60 seconds have elapsed** _and_ **the price differs from
the entry price**. Both, always.

- 59s elapsed with the price moved → still pending.
- 61s elapsed with the price identical → still pending.
- Price source unavailable → still pending, with a clear message. Never resolve
  arbitrarily, never guess a direction, never treat "no data" as "no change".

## I6 — A returning player is resolved against history, not against now

If the player closed the browser and comes back later, the guess is resolved using the
Binance 1-minute kline at `entryAt + 60s`, not today's price.

**How to check:** the resolve path takes the elapsed time into account and reaches for
`getPriceAt(...)` when the guess is stale.

**Why it matters:** resolving a three-day-old guess against the current price satisfies
the letter of the rule and betrays its intent. This is the invariant that most
distinguishes a careful implementation from a quick one.

## Reviewing a diff against these

Report violations as: invariant id → file and line → the concrete exploit or race it
opens. Say nothing about style. If a change is merely suspicious rather than a
violation, say so explicitly instead of inflating it.
