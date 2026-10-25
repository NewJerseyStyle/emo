# emo-a: project-level knowledge for agent-driven SDLC

emo-a is the v2 line of emo. It drops the OpenCode plugin and becomes a **project-level knowledge and process layer** that sits beside a coding agent (omo/senpi first, any agent later). It is not part of the agent: it talks to the agent only through a few narrow, version-pinned interfaces.

## Goals

1. Give a team a near-SDLC loop around an agent: clarify → plan → execute → close → remember. Fast agent iteration must not silently pile up debt or lose information.
2. Keep experience at **project level**, shared by teammates through the project's own git repository.
3. Keep maintenance cost low: own the data format and the process, depend on omo only through a thin adapter.

## Non-goals

- Agent-level memory, compaction, recall, or secret masking at injection time. omo already ships these; emo-a does not compete with them.
- Forking or bundling omo (its SUL-1.0 license restricts redistribution to free, non-commercial use). Users install omo themselves.
- Writing into omo's own memory directory. That format is private to omo and changes between releases.

## Layers

```
┌───────────────────────────────────────────────┐
│ skills (SKILL.md)   BA · PM · closure         │  process, agent-agnostic
├───────────────────────────────────────────────┤
│ kb (this repo)      store · schema · scrub    │  data contract, we own it
├───────────────────────────────────────────────┤
│ driver/adapter      omo host session …        │  the only omo-coupled part
└───────────────────────────────────────────────┘
```

### Data contract: the `exp` branch

An orphan branch named `exp` in the project's repository, mounted as a git worktree (default `<repo>/.emo/exp`, git-ignored on code branches). Code and knowledge never share history.

```
EMO.md                  format version
plans/<id>.md           what we intend to do (PM output)
closures/<id>.md        what happened, plan vs actual, lessons
decisions/<id>.md       design choices, with supersedes chain
inbox/<id>.md           raw lessons, one file each, add-only
curated/<id>.md         consolidated knowledge, written only by dream (later)
```

Rules that make multi-writer safe:

- **One document, one file, unique id** (`<kind>-<utc stamp>-<author>-<rand>`). Two people never edit the same path.
- **Add-only.** A document is never overwritten. Corrections are new documents with `supersedes: <id>`; the old one is flagged by the consumer, not rewritten.
- **Secrets are refused at write time.** A document containing credential-like text is not written.
- **Lessons need all three parts**: what happened, why, what to do differently.
- **Curation (dream) is a proposal**, produced on its own branch and merged by review, regenerated from inputs if the base moved. It never edits `inbox/`.

### Process: skills, not a runtime

BA, PM and closure are `SKILL.md` files loaded by the agent. They no longer classify every user input (that cost tokens on every message). The unit of work is one **ulw-loop run = one plan item = one closure**.

- BA: only when a goal is new or ambiguous; asks, then writes a plan draft with a tl;dr.
- PM: turns the confirmed plan into agent-executable tasks, pulls relevant prior lessons, records an estimate.
- Closure: at the end of a run, compares plan vs actual and writes lessons.

Small tasks take a fast path (no BA/PM). Skips are counted so we can see how often the process is bypassed.

### Driver: the only omo-coupled part

omo 5.1.34 exposes (verified locally): `omo host session open|prompt|steer|abort|read|state|wait|list|close`, one JSON line per call, plus `omo --mode rpc` over stdio. The driver uses `wait --until idle` as the "run finished" signal and `read --messages` to collect the transcript for the closure. A weekly contract test runs the latest omo against these calls; omo is pinned until it passes.

## Migration from emo 0.1

| emo 0.1 | emo-a |
| --- | --- |
| `src/hl-repo/*` | replaced by `src/kb/*` (frontmatter parser reused; git calls rewritten without shell strings; worktree-based; add-only) |
| `src/ba/skill.md`, `src/pm/skill.md` | slimmed into `skills/*/SKILL.md`; the 15-class per-input taxonomy and 4F soothing are dropped |
| `src/pm/*`, `src/orchestrator/*` (OpenCode client calls) | removed; their work is done by skills |
| `src/index.ts`, `state-machine.ts`, `ulw-detector.ts`, compaction | removed; omo owns compaction |

## Milestones

1. **kb core** (this step): ids, schema, secret scrub, `exp` worktree store, tests.
2. **CLI**: `emo init | plan | close | lesson add | sync | validate`.
3. **Skills**: BA/PM/closure `SKILL.md`, loaded via omo `skills.sources`.
4. **Driver spike**: open → prompt → wait → read with a tiny task; closure draft to `exp`.
5. **Pilot** with a 2–3 person team; measure repeated dead ends and tokens per task.
6. **Dream/curation** as reviewed PRs, once there is data to consolidate.

## Open risks

- omo's `host session` interface is not documented as stable. Mitigation: pin + contract test.
- Retrieval quality: injecting irrelevant lessons costs tokens and misleads. Start with a small index the agent reads on demand.
- Agent compliance with the closure skill is unmeasured; the driver (milestone 4) is the fallback trigger.
