# HODL On A Minute

A 60-second BTC prediction game. The player guesses whether BTC/USD will be higher or
lower one minute from now; a correct guess is +1 point, a wrong one −1.

This repo has two lives, and they pull in different directions:

1. **A technical-test deliverable for epilot** — capped at about half a day of work,
   followed by a one-hour walkthrough with their developers. What is evaluated is
   ownership and the ability to explain decisions, not code cleanliness.
2. **A public portfolio piece.**

Polish belongs to phase 6, _after_ submission. Do not gold-plate before then. When
choosing between an elegant solution and a defensible-and-explainable one, choose the
one that is easier to defend out loud.

## Invariants — never violate these

The full statement lives in the `fairness-invariants` skill. In short:

1. **The client never supplies a price or a timestamp.** Entry price, entry time and
   resolution price are all fetched server-side. The client sends one thing: the string
   `"up"` or `"down"`. A `price` or `timestamp` field appearing in a request Zod schema
   is a design bug, not a feature.
2. **Identity comes from a signed httpOnly cookie**, never from `localStorage` and never
   from a request body. Identity determines the score, so it is server data.
3. **"One guess at a time" is enforced by the database**, via
   `ConditionExpression: 'attribute_not_exists(activeGuess)'` — not by an
   `if (player.activeGuess) throw` in application code, which two concurrent requests
   both walk straight through.
4. **Resolution is idempotent**, conditioned on the guess id, so a double resolve cannot
   double-count the score.
5. **A guess is resolved only when both conditions hold**: at least 60 seconds have
   passed _and_ the price has changed. Never resolve arbitrarily to unblock a player.

The browser is a view. The server holds the truth.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript 5 strict · Tailwind 4 + shadcn/ui ·
TanStack Query · Zod · DynamoDB (`@aws-sdk/lib-dynamodb`) · Binance public API ·
Vitest + Testing Library · deployed on Vercel.

## Conventions

- TypeScript strict. **No `any`** — use `unknown` and narrow.
- `src/lib/game/` holds **pure functions only**. No I/O, no `fetch`, no SDK calls, no
  `Date.now()` read from inside — time and prices are passed in as arguments. This is
  what makes the critical logic testable without mocks.
- `src/lib/price/` wraps Binance. `src/lib/db/` wraps DynamoDB. Errors are typed
  (`PriceUnavailableError`), never swallowed.
- API route inputs are validated with Zod. The parsed type is the source of truth.
- Tests live in `src/tests/`.

## Scripts

| Command                 | What it does                       |
| ----------------------- | ---------------------------------- |
| `npm run dev`           | Dev server                         |
| `npm run build`         | Production build                   |
| `npm run lint`          | ESLint                             |
| `npm run typecheck`     | `tsc --noEmit`                     |
| `npm test`              | Vitest, single run                 |
| `npm run test:coverage` | Vitest with coverage               |
| `npm run check`         | lint + typecheck + tests, in order |

## Do not

- Accept a price, a timestamp or a player id from the client.
- Use `localStorage` for identity.
- Add authentication, a leaderboard, a separate `guesses` table, real money, a custom
  WebSocket server, or multi-region anything. These are deliberately out of scope and
  the reasons are written down — see the README's "known limitations".

  Note the wording: **no separate table**, not "no history". Resolved guesses are kept
  as a `history` list on the player item, prepended by the very same conditional write
  that resolves them. One item still means one atomic update, so the idempotence
  guarantee is untouched. A second table would need a DynamoDB transaction to keep it.
- Chase global test coverage. Cover the resolution logic and the fairness guarantees
  deeply; leave the rest.
- Commit `.env`. This repo is public.

## Testing philosophy

Priority order: `canResolve` and `computeDelta` edge cases → historical resolution →
the concurrency guarantees (double POST returns 409, double resolve increments once) →
the test proving a client-supplied `price` is ignored. That last one is the most
valuable test in the project: it documents a security decision while verifying it.

@AGENTS.md
