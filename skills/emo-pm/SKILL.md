---
name: emo-pm
description: Use after a plan is confirmed, before executing it. Break the plan into verifiable tasks, pull relevant past lessons so known dead ends are not repeated, and record a rough estimate.
---

# emo-pm: turn a confirmed plan into executable tasks

Reply in the user's language.

## Steps

1. Read the confirmed plan: `emo show <plan-id>`.
2. Pull experience, keep it small: `emo list lesson` and `emo list decision`; read (`emo show`) only entries that touch the same files, tools, or failure modes. Quote the "Do differently" line, not the whole lesson.
3. Break the work into tasks, each with:
   - a verifiable done-check (a command or test that passes),
   - the lessons it must respect (ids),
   - an order that puts the riskiest or least-known task first.
4. Record a rough estimate in tokens (low / expected / high) and what drives it: files touched, new vs. changed code, unknowns. Say `not measured` for anything you cannot estimate. Do not invent precision.
5. Write the tasks and estimate into the plan's record:
   `emo plan add --goal "<same goal>" --status confirmed --file -` with `## Tasks`, `## Estimate`, `## Lessons applied`.
6. Start executing task 1. Keep each task test-first where a test is possible.

## During execution

- If you hit a dead end that took more than one retry, write the lesson immediately (emo-closure format) instead of waiting for the end.
- If scope changes, stop and go back to emo-ba; do not drift.
