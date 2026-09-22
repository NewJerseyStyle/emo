# Superseded: Project Management Layer plan

> Status: **superseded and removed**
> Superseded by: `refactor/omo-integration` / version 0.2
> Date: 2026-09-22

This historical plan described a parallel BA/PM/ULW orchestration and HL Git-memory layer.
That architecture has been physically removed and must not be reimplemented from this file.

Version 0.2 is an independent, read-only oh-my-opencode artifact bridge:

- oh-my-opencode owns planning, execution, goals, continuation, and compaction;
- this package reads supported `.omo` lifecycle artifacts without modifying them;
- closure export is explicit and immutable;
- memory promotion is conservative and requires an injected idempotent sink;
- no auxiliary model sessions, prompt injection, heartbeat loop, or private memory database remains.

Current references:

- [`README.md`](../../README.md)
- [`docs/migration-0.2.md`](../../docs/migration-0.2.md)
- [`docs/architecture-evaluation.md`](../../docs/architecture-evaluation.md)
