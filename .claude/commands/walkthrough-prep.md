---
description: Generate walkthrough talking points from the code as it actually is.
allowed-tools: Bash, Read, Grep, Glob
---

The real deliverable is not the code, it is the hour-long conversation about it. Prepare
that conversation **from the current code**, not from the plan — where they diverge, the
code wins and the divergence is itself worth discussing.

Read the actual implementation: `src/lib/game/`, `src/lib/db/`, `src/lib/price/`,
`src/app/api/`, `src/lib/session.ts`, and the tests. Then produce:

## 1. Two-minute overview

What the app does and how it is put together, for someone who has never seen it. No
jargon that the repo itself invented.

## 2. The decisions, with file references

For each, in the order they should be shown: the decision, `file:line` to open, the
alternative rejected, and why. Cover at minimum:

- The client never sends a price — show the Zod schema, then the test that proves it.
- Conditional write instead of an application-level check — name the race it eliminates.
- Idempotent resolution conditioned on the guess id.
- WebSocket for display, server REST for truth.
- Historical resolution for a player who left.
- Vercel + DynamoDB against "AWS services preferred".
- Versioning `.claude/` — and the agents deliberately **not** created.

## 3. Questions they will ask

Anticipate the hard ones and draft an honest answer for each, grounded in the code. What
happens if Binance is down mid-guess. What happens with two tabs open. What a cleared
cookie does. Why coverage is not higher. Where the logic would break at 10 000 players.

## 4. Known limitations

Every one stated plainly, each with what would be done differently in production. Being
able to name what was deliberately left out is half of what is being assessed.

## 5. Three production improvements

Concrete, costed, in priority order. They ask this explicitly.

Flag anything you find in the code that contradicts the README or `CLAUDE.md` — better
to find it now than to be asked about it live.
