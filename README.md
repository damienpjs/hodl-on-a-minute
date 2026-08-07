# HODL On A Minute

_A 60-second BTC prediction game._

Guess whether BTC/USD will be higher or lower one minute from now. A correct guess is
+1 point, a wrong one −1. One guess at a time; your score survives closing the browser.

> **Status: in progress.** Project setup is done; the game is not built yet. This README
> is filled in as the app is (functionality, local setup, deployment, technical
> decisions, how fairness is guaranteed, what is tested and why, agent tooling, known
> limitations).

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in AWS credentials and a cookie secret
npm run dev
```

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

## Agent tooling

This repo versions its coding-agent configuration under `.claude/`, the same way it
versions ESLint and CI config. Three agents with narrow scopes, four commands, three
packaged skills. `CLAUDE.md` holds the invariants that must never be violated — chiefly
that the client never supplies a price or a timestamp. See
[`.claude/README.md`](.claude/README.md) for the rationale behind each one.
