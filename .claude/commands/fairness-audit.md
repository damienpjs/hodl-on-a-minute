---
description: Audit the current uncommitted diff against the project's fairness invariants.
allowed-tools: Task, Bash, Read, Grep, Glob
---

Launch the `fairness-auditor` agent against the current uncommitted changes
(`git diff HEAD`, `git diff --cached`, and any untracked files under `src/`).

If `$ARGUMENTS` names a commit range, a branch or specific paths, audit that instead.

Relay the agent's findings in full — every violation with its invariant id, location,
the concrete exploit or race, and the fix. Do not summarise findings away, and do not
soften a `FAIL`.

If the verdict is `PASS`, say so in one line and stop. A clean audit needs no commentary.
