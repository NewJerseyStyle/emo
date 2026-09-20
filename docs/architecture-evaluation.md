# Architecture evaluation: emo vs. oh-my-opencode

Date: 2026-09-19

## Decision

Do not continue `emo` as a parallel BA/PM/orchestration plugin.

The useful product is a narrow oh-my-opencode extension for durable, verified knowledge distillation across completed ULW loops and process restarts. Reuse oh-my-opencode's planner, agents, goal loop, boulder state, notepads, todo continuation, and compaction hooks. Keep only capabilities that are absent upstream: durable cross-loop knowledge promotion, optional closure/decision export, and an evidence-based cache experiment if it proves savings.

This conclusion is based on the canonical `code-yeongyu/oh-my-openagent` dev branch at commit [`c43a341`](https://github.com/code-yeongyu/oh-my-openagent/commit/c43a34195babfb8555cd9512ff4a71bbf7724cc1), inspected on 2026-09-19.

## What upstream already provides

| emo concern | Existing oh-my-opencode surface | Conclusion |
| --- | --- | --- |
| ULW keyword detection | `keyword-detector` injects model-aware `ultrawork`/`ulw` prompts | Duplicate |
| Planning and feasibility | Prometheus/`ulw-plan`, plan-consultant, and plan-reviewer | Replace emo PM generation |
| Execution handoff | `/ulw-execute`, Atlas, category workers, and resumable delegated sessions | Replace emo's todo-only handoff |
| Durable work state | `.omo/boulder.json`, `.omo/plans/`, `.omo/notepads/`, and persistent goals | Replace active-project maps |
| Loop continuation | goal hook, todo continuation enforcer, Atlas idle continuation | Replace heartbeat/closure timers |
| Compaction continuity | compaction-context injector, compaction todo preserver, agent/model/tool checkpoint recovery | Replace task-context reinjection |
| Skills and agent routing | skill loader, built-in skills, model-aware agents/categories | Do not add a parallel BA router |
| Long-term memory | harness-neutral `memory-core`; currently consumed by the Senpi adapter, not the OpenCode adapter | Real gap worth extending upstream |
| Immutable project closure/ADR export | No equivalent durable cross-project closure catalog was found | Potential narrow extension |

## Current emo findings

### Blocking functional gaps

1. The runtime reducer cannot trigger compaction. Runtime state never receives context-token usage, no timer emits `tick`, and returned `compact`/`heartbeat` actions are only logged. `runHandoff` is test-only.
2. `NEXT_STEP` writes a todo file but does not invoke an oh-my-opencode agent, `/ulw-execute`, task tool, or another execution surface.
3. Task summaries and active project associations are process-local maps. A restart loses the association needed to restore context, log changes, or write a closure.
4. The task-context extractor runs after `session.compacted`, so the original detail may already be gone. Its runtime lifecycle is not covered by tests.
5. The global `busy` flag can discard genuine messages from another concurrent session.
6. Closure accounting reports the plan estimate as tokens saved and hardcodes actual usage to zero. Multiple closures on the same date overwrite one another.
7. The retained runtime scripts do not drive compaction, restart/resume, context injection, ULW execution, or closure retrieval end to end.

### Security and integrity bugs fixed during this evaluation

- Git commands now use argv-based `execFileSync` instead of a shell-built command, preventing command substitution through model-derived commit messages.
- Project/document/task identifiers are restricted to safe single path segments, preventing traversal outside the HL repository.
- HL repository detection now requires the configured root itself to be the Git top-level. A nested `.hl` no longer stages or commits the parent application repository.
- `git add` is scoped to the HL repository path.
- Model-generated task IDs and dependency IDs are rejected unless they are safe filename segments.
- Task context extraction now honors its documented recent-message limit.
- Failed context injection keeps the stored summary for a later retry.
- The runtime default now matches the installer and uses the shared `~/.hl` repository rather than `<project>/.hl`.

## Recommended target architecture

1. Remove or disable emo's BA classifier, PM task generator, feasibility agent, ULW detector, heartbeat state machine, and active-project orchestration when oh-my-opencode is present.
2. Implement knowledge distillation as an oh-my-opencode skill plus a small lifecycle hook, not as a second orchestrator.
3. Read authoritative work state from the existing goal, plan, boulder, notepad, todo, and session surfaces.
4. At verified ULW completion, promote only durable facts:
   - decisions and their rationale;
   - reusable repository conventions;
   - validated failure modes and fixes;
   - user preferences that should survive projects;
   - unresolved risks and explicit handoff state.
5. Write promoted knowledge through `@oh-my-opencode/memory-core` rather than maintaining a second Git memory schema. The clean upstream contribution is an OpenCode adapter for memory-core.
6. Keep an optional closure exporter that derives an immutable report from upstream artifacts. It must record measured usage or say `not measured`; it must never infer savings from an estimate.
7. Treat provider-cache heartbeats as an experiment behind a disabled-by-default flag. Ship only after an A/B test demonstrates lower total cost/latency without extra model turns or cross-session interference.

## Docker evaluation

The pinned Docker gate is `docker compose run --rm --build test` (also `bun run test:docker`). It installs Bun 1.4.1 and Git, then runs:

- all Bun tests;
- TypeScript typecheck;
- the production bundle;
- the packaged postinstall initialization.

Baseline before fixes: 110 tests passed once Git was added to the container. The initial bare Bun image produced 23 expected environment failures because Git was absent; that is now encoded in `Dockerfile.test` instead of depending on host state.

Final gate after fixes: 118 tests passed, TypeScript typecheck passed, both production entry points built, and postinstall initialized the isolated `/root/.hl` volume successfully.

## Required end-to-end experiment before choosing an implementation

Run the same real OpenCode/oh-my-opencode task in isolated containers under three conditions:

1. upstream oh-my-opencode only;
2. upstream plus a minimal memory-core OpenCode adapter;
3. current emo plugin (comparison/control, not the expected winner).

For each condition, force at least two compactions, restart the OpenCode process, resume in the same session, then start a new session for the same repository. Score:

- exact goal/constraint recall;
- correct next action after resume;
- retained decisions and validated lessons;
- false or stale memories;
- duplicate planning/classification turns;
- input/output/cache-read tokens;
- wall-clock latency and provider cost;
- whether completion remains evidence-backed.

Success means the minimal adapter improves restart and cross-session recall over upstream alone without duplicating planning, changing ULW behavior, or increasing total tokens enough to erase the benefit.

## Scope still intentionally unresolved

The architectural deletion/refactor is not applied in this evaluation because it changes the product boundary. The security and data-loss fixes are safe regardless of that decision. The next implementation should target the upstream extension described above rather than wiring the currently dead custom compaction state machine.
