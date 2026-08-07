---
description: Run lint, typecheck and tests with coverage, then summarise what to fix.
allowed-tools: Bash, Read, Grep, Glob
---

Run the full local gate, in this order, and **do not stop at the first failure** — the
point is one complete picture before a commit, not one error at a time.

1. `npm run lint`
2. `npm run typecheck`
3. `npm run test:coverage`

Then report:

- A line per step: ✅ or ❌ with the failure count.
- For each failure: the file and line, what is actually wrong, and the fix. Group
  repeats of the same root cause instead of listing every instance.
- Coverage for `src/lib/game/` specifically. Global coverage is not a goal here — say
  nothing about it unless the resolution logic itself is under-covered.
- A verdict: ready to commit, or the ordered list of what to fix first.

Do not fix anything unless asked. This command reports.
