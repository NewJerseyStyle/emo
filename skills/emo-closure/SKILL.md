---
name: emo-closure
description: Use when a planned piece of work finishes, stalls, or is abandoned, and whenever a dead end cost more than one retry. Record plan vs actual and the lessons, so the team does not repeat it.
---

# emo-closure: compare plan to actual, keep the lessons

Reply in the user's language.

## When

- A plan finishes, stalls, or is dropped.
- Mid-task, whenever something took more than one retry to get past.

## Lesson (one per distinct insight)

`emo lesson add --title "<short>" --what "<what happened>" --why "<root cause>" --do "<what to do differently>"`

All three parts are required. A lesson without "do differently" is a complaint; do not write it.
Keep each part to one or two sentences. Do not paste logs, keys, tokens, or customer data (writes containing credential-like text are refused).

Write a lesson only for something a teammate could act on next time: a wrong assumption, a tool quirk, an environment trap, a pattern that worked. Skip the obvious.

## Closure (once per plan)

`emo close --plan <plan-id> --outcome "<done|partial|dropped>" --tokens-estimated <n> --tokens-actual <n> --file -`
(omit token flags if not measured; never guess them) with:

```
## Plan vs actual
What was planned, what happened, where it deviated, and why.

## Lessons
Ids of the lessons written for this work, or "none".
```

Then run `emo validate` and `emo sync`. Report the closure id and any lesson ids to the user in one short list.
