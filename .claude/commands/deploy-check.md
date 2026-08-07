---
description: Pre-deploy checklist — secrets, env vars, table, build, and the live demo link.
allowed-tools: Bash, Read, Grep, Glob, WebFetch
---

"You build it, you run it": going live is part of the work, so it gets an executable
checklist. Run every step, report every result, and never report a step you skipped as
passing.

## 1. Secrets — this repo is public

- `git ls-files | grep -E '^\.env'` returns nothing but `.env.example`.
- `.env.example` contains **no real values** — every secret line is empty.
- `git log --all -p -- .env .env.local` is empty: no secret was ever committed, even in
  a commit later reverted.
- Grep the tracked tree for stray `AKIA` strings and long base64 secrets.

## 2. Environment

- Every variable in `.env.example` exists in the Vercel project (`vercel env ls` if the
  CLI is available; otherwise list what must be checked by hand in the dashboard).
- `AWS_REGION` matches the region the DynamoDB table actually lives in.
- `COOKIE_SECRET` is set in production and is not the local development value.

## 3. Data store

- Table `hodl-on-a-minute-players` exists, partition key `playerId`, on-demand billing.
- The IAM user is dedicated to this app and its policy is limited to `GetItem`,
  `PutItem` and `UpdateItem` on that one table's ARN — not `dynamodb:*`, not `Resource: "*"`.

## 4. Build and tests

- `npm run check` passes.
- `npm run build` succeeds — a route that only fails in a production build is the
  classic way to ship a broken demo.

## 5. The live app

- Fetch the deployed URL: it returns 200 and shows a BTC price.
- `GET /api/session` on the deployed URL returns a player with `score: 0` and sets an
  httpOnly cookie.
- Confirm the README's demo link points at the current deployment.

## Report

A table of step → pass/fail → what to do. End with a single verdict: **safe to share the
link**, or the blocking items in order. If anything could not be checked automatically,
list it explicitly as "needs manual confirmation" rather than assuming it passes.
