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

## 3. Data store — probe the boundary, do not read the policy

Run these with **`hodl-app`'s own credentials**, the ones the deployed app uses. No
administrator identity is involved, and none should be: reading the policy document
verifies an intention, calling the API verifies the effect. An inline policy can be
correct while a managed policy attached alongside it widens the blast radius — the
document would not show that, a denied call would.

This is the same shape as the project's most valuable unit test, the one proving a
client-supplied `price` is ignored: it documents a security decision by verifying it.

Region `eu-central-1`. Nothing below writes: three of the four calls must be refused, and
the probe key does not exist, so even an unexpected success changes nothing.

```bash
KEY='{"playerId":{"S":"deploy-check-probe"}}'
T=hodl-on-a-minute-players

aws dynamodb get-item    --table-name $T        --key "$KEY" --region eu-central-1  # must SUCCEED
aws dynamodb scan        --table-name $T                     --region eu-central-1  # must be DENIED
aws dynamodb delete-item --table-name $T        --key "$KEY" --region eu-central-1  # must be DENIED
aws dynamodb get-item    --table-name "$T-nope" --key "$KEY" --region eu-central-1  # must be DENIED
```

- **1 succeeds** → the table exists, is reachable, and `playerId` really is the partition
  key. A wrong key schema fails this call, so the schema needs no separate check.
- **2 is `AccessDeniedException`** → `Scan` is excluded, which is what makes the README's
  "no leaderboard" limitation a real constraint rather than a stylistic preference.
- **3 is `AccessDeniedException`** → the grant is not `dynamodb:*`.
- **4 is `AccessDeniedException`** → `Resource` is not `"*"`.

Report the four outcomes individually. A denial that does not arrive is a failure, not a
detail — and a call that fails for the wrong reason (bad credentials, wrong region,
throttling) is not a pass either. Read the error code, not just the exit status.

Billing mode is deliberately not checked here: `DescribeTable` is outside this identity's
grant, and on-demand pricing is covered by the budget layer described in the README's
Infrastructure section, which fires long before a misconfiguration would matter.

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
