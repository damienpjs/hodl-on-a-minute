# HODL On A Minute

_A 60-second BTC prediction game._

Guess whether BTC/USD will be higher or lower one minute from now. A correct guess is
+1 point, a wrong one −1. One guess at a time; your score survives closing the browser.

> **Status: in progress.** Project setup is done; the game is not built yet. This README
> is filled in as the app is (functionality, local setup, deployment, technical
> decisions, how fairness is guaranteed, what is tested and why, agent tooling, known
> limitations).

## Getting started

Running locally needs no AWS account: the data layer talks to DynamoDB Local, which
speaks the same API. Docker must be running.

```bash
npm install
cp .env.example .env.local   # see the file for the DynamoDB Local values
npm run db:local:up          # start the container
npm run db:local             # create the table (in-memory: re-run after a restart)
npm run dev
```

Point `DYNAMODB_ENDPOINT` at nothing to talk to real AWS instead.

| Command                 | What it does                       |
| ----------------------- | ---------------------------------- |
| `npm run dev`           | Dev server on :3000                |
| `npm run build`         | Production build                   |
| `npm run lint`          | ESLint                             |
| `npm run typecheck`     | `tsc --noEmit`                     |
| `npm test`              | Vitest, single run                 |
| `npm run test:coverage` | Vitest with coverage               |
| `npm run check`         | lint + typecheck + tests, in order |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript 5 · Tailwind 4 + shadcn/ui ·
TanStack Query · Zod · AWS DynamoDB · Binance public API · Vitest + Testing Library ·
deployed on Vercel.

## Known limitations

**Guess history is bounded by the item, not by a table.** Resolved guesses are prepended
to a `history` list on the player item, inside the same conditional write that resolves
them — one item, one atomic update, so resolution stays idempotent. The cost is that
DynamoDB cannot trim a list server-side, and appending to plus removing from the same
attribute in one expression is rejected as overlapping paths. Bounding the list would
therefore mean a second write on every resolution. Instead the ceiling is accepted: at
roughly 100 bytes an entry, the 400 KB item limit lands near 4,000 guesses — about 66
hours of uninterrupted play. API responses are capped independently at 20 entries, so
the payload is bounded even though the item is not. In production this is where an
append-only `guesses` table with a TTL belongs, written through a DynamoDB transaction.

**Clearing cookies starts a new player.** Identity is a signed httpOnly cookie, not an
account. The assignment asked for persistence across browser restarts, which this
satisfies; real accounts would need authentication, which it did not ask for.

**No leaderboard and no other-player activity.** Listing active guesses across players
would need either a `Scan` — which the IAM policy deliberately excludes — or a sparse
GSI keyed on a "guess in flight" attribute. The latter is the right design, and it is
what production would use; it is out of scope here, and a live activity feed on a
single-player deployment would show an empty list anyway.

**The price stream is display-only.** The browser reads Binance over a WebSocket for a
smooth ticker. No guess is ever priced from it: entry, resolution and timestamps are all
fetched server-side.

## Agent tooling

This repo versions its coding-agent configuration under `.claude/`, the same way it
versions ESLint and CI config. Three agents with narrow scopes, four commands, three
packaged skills. `CLAUDE.md` holds the invariants that must never be violated — chiefly
that the client never supplies a price or a timestamp. See
[`.claude/README.md`](.claude/README.md) for the rationale behind each one.
