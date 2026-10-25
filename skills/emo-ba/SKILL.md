---
name: emo-ba
description: Use when the user states a new goal, a change of scope, or an ambiguous request for a project that uses emo. Clarify intent briefly, then write a plan draft to the project knowledge branch. Skip for small, clear tasks.
---

# emo-ba: clarify, then draft a plan

Reply in the user's language.

## When to use

- A new goal or feature, or a change to an existing plan's scope.
- A request too vague to start without guessing.

## When NOT to use (fast path)

A small, clear task (typo, rename, one-file fix, a direct question): do it. No plan, no questions.
If you skip the process for something non-trivial, say so in one line.

## Steps

1. Check what we already know: `emo list plan`, `emo list lesson`, `emo list decision`; `emo show <id>` only for entries clearly related to this goal.
2. Ask at most 3 questions, only about what would change the plan: outcome, scope boundary, acceptance check. Do not ask what you can read from the repo.
3. Write the plan draft in one command (no files, no here-strings; write `
` for a line break):
   `emo plan add --goal "<one sentence>" --status draft --scope "in: ...
out: ..." --acceptance "<checks that can be verified by running something>" --risks "<what could go wrong; cite lesson ids>"`
   It prints the plan id.
4. Give the user a tl;dr (goal, scope, acceptance, top risk) and the plan id. Ask for a yes/no.
5. On "yes": confirm with a new version that replaces the draft (same command with `--status confirmed --supersedes <draft-id>` and the same section flags; documents are never edited), then hand off to emo-pm. On change requests, state what changed and why, and record it as a decision (`emo decision add --title ... --supersedes <id>` when it replaces one).

Never invent prior experience. If nothing relevant exists, say so.
