# Agent tooling

This directory is versioned on purpose, the same way `eslint.config.mjs` and the CI
workflow are versioned. It is part of how this repo is built, so it belongs in the repo.
A tooling directory with no explanation is what makes tooling look like leftover local
configuration — hence this file.

**Why `.claude/` and not a neutral `.agents/`.** `.claude/` is the convention actually
read by the tool in use: `CLAUDE.md` at the root, then `agents/`, `commands/`, `skills/`
here. An `.agents/` directory would be decorative — nothing reads it, and its only real
effect would be to obscure which assistant was used. Naming the tool invites the question
"how do you use it?", which is the useful conversation. Hiding it invites "what are you
hiding?".

Twelve short files, deliberately. Past that, tooling becomes theatre.

## `CLAUDE.md` (repo root)

The constitution. Read automatically at the start of every session, so it carries the
rules nothing may violate — chiefly that the client never supplies a price or a
timestamp. Written before the first line of application code. Without it, every new
session rediscovers the constraints, and the first one forgotten is always the expensive
one.

## Agents

| Agent               | Scope                                                     | Why this one                                                                                                                                     |
| ------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `game-logic`        | Writes only in `src/lib/game/`. Pure functions, no I/O.    | This is where a bug is *invisible*: a wrong comparator yields a game that runs perfectly and cheats. Isolating it forces it to be treated as critical. |
| `fairness-auditor`  | **Read-only.** Reviews a diff against the invariants.      | The most useful of the three — it turns a security rule into an automatic check. A `price` field appearing in a request schema is caught before the commit. |
| `test-writer`       | Writes only in `src/tests/`.                               | Enumerating edge cases is systematic and tedious, which is exactly what should be delegated. Choosing *what* to test stays human.                  |

**Deliberately not created**, which matters as much as the list above:

- **No UI agent.** Interface work has immediate visual feedback; delegating costs more
  than doing it.
- **No deploy agent.** One command does the job. An agent would be staging.
- **No "architect" agent.** The architecture is decided in the project brief. An agent
  re-deciding it every session would be a regression.

## Commands

| Command             | What it does                                                              | Why                                                                                            |
| ------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `/check`            | `lint` + `tsc --noEmit` + `vitest --coverage`, with a summary               | One command before each commit, so none is forgotten and discovered failing in CI.               |
| `/fairness-audit`   | Runs `fairness-auditor` on the uncommitted diff                            | Makes the security invariant checkable on demand, rather than documented somewhere nobody rereads. |
| `/deploy-check`     | Secrets, env vars, IAM scope, table, build, live link                      | "You build it, you run it" — going live is a step of the work and deserves an executable checklist. |
| `/walkthrough-prep` | Reads the code and generates discussion points                             | The real deliverable is the hour-long conversation. It may as well be tooled.                    |

## Skills

| Skill                          | Why package it                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `fairness-invariants`          | The core of the assignment. Written once and reused by the auditor and by `CLAUDE.md`, so the two cannot drift apart.                        |
| `dynamodb-conditional-writes`  | An unfamiliar API that is easy to get subtly wrong — a bad condition fails *silently*, leaving the impression that a guarantee exists.        |
| `binance-price-api`            | Holds the **real recorded responses**. Actual responses are the source of truth for the types, never the documentation and never a guess.    |
