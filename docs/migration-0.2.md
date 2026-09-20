# Migrating to 0.2

Version 0.2 changes `@cache-aware/opencode-cache-compaction` from a second BA/PM/cache orchestrator into a narrow, independent completed-work evidence bridge for oh-my-opencode (OMO).

This is a breaking pre-1.0 release. There are no compatibility wrappers for the removed orchestration APIs.

## What changed

OMO is now the only owner of planning, feasibility, execution routing, ULW continuation, goals, compaction recovery, agents, and skills. The plugin reads OMO lifecycle artifacts without importing, invoking, vendoring, or modifying OMO.

The plugin now does only two optional things after evidence-backed completion:

- immutable closure export; and
- promotion through an injected idempotent memory sink when the configured ownership matrix permits it.

Both effects default off. An installation without OMO loads as a no-op and remains usable through the direct snapshot library API.

## Removed exports

The package root no longer exports library helpers. It default-exports only the OpenCode plugin module. Import supported utilities from `@cache-aware/opencode-cache-compaction/library`.

The following 0.1 surfaces were removed rather than deprecated:

- cache controller state and decisions: `DEFAULT_CONFIG`, `initialState`, `decide`, and `reduce`;
- ULW inference: `isUlwSession` and regex/message-history detection;
- BA classification, intent types, routing, Four-F detection, and soothing;
- PM task generation, feasibility, token estimates, plans, and task types;
- handoff/compaction helpers such as `shouldCompact` and `runHandoff`;
- task-context extraction and reinjection helpers;
- active-project planning, change-request, todo, `NEXT_STEP`, and BA-memory helpers; and
- the HL Git repository API and schema.

There is no replacement BA or PM API in this package. Use OMO's planner, execution workflow, goals, notepads, and continuation loop.

## Removed configuration

These 0.1 cache/controller options have no effect in 0.2 and should be deleted:

- `minContextTokens`;
- `heartbeatIntervalMs`;
- `idleTimeoutMs`;
- `gracePeriodMs`;
- `maxHeartbeats`; and
- `cacheTtlMs`.

These HL repository options were also removed:

- `hlRepoRoot`;
- `hlAutoPush`; and
- `hlRemote`.

They do not silently map to the new exporter because doing so could resume unexpected filesystem or Git writes. Configure `closureEnabled`, `closureRoot`, and `stateRoot` explicitly instead.

## Configuration replacement

Before:

```jsonc
{
  "plugin": [
    {
      "package": "@cache-aware/opencode-cache-compaction",
      "options": {
        "hlRepoRoot": "~/.hl",
        "hlAutoPush": true,
        "heartbeatIntervalMs": 60000
      }
    }
  ]
}
```

After, for closure export only:

```jsonc
{
  "plugin": [
    {
      "package": "@cache-aware/opencode-cache-compaction",
      "options": {
        "closureEnabled": true,
        "closureRoot": ".emo/closures",
        "stateRoot": ".emo/state",
        "memoryOwner": "upstream",
        "upstreamMemory": "available"
      }
    }
  ]
}
```

Use `memoryOwner: "plugin"` only when you deliberately inject a `MemorySink`. The default `auto` plus `unknown` capability makes no memory write. The plugin never infers capability from an OMO package name or `.omo` directory.

## Library imports

Before:

```ts
import {
  buildPlan,
  classifyWithLLM,
  generateTasks,
  isUlwSession,
  reduce,
} from "@cache-aware/opencode-cache-compaction";
```

There is no like-for-like 0.2 replacement for those functions.

For supported evidence processing:

```ts
import {
  createClosureExporter,
  discoverCompletedWork,
  processCompletedWork,
  type CompletedWorkSnapshot,
  type MemorySink,
} from "@cache-aware/opencode-cache-compaction/library";
```

`discoverCompletedWork` reads a project/worktree's supported artifacts. `processCompletedWork` accepts a normalized snapshot directly, so library users do not need OMO installed.

## Lifecycle differences

The plugin no longer:

- classifies `chat.message` text;
- creates auxiliary OpenCode sessions;
- submits PM summaries, heartbeat prompts, or restored context;
- reads conversation messages or probes OpenCode configuration;
- treats idle, compaction, a word such as `done`, or a timer as completion;
- creates plans, todos, feasibility notes, BA memory, or change requests; or
- writes anywhere below `.omo`.

`session.idle` and `session.compacted` are read-only scan opportunities. Automatic processing requires completed Boulder status plus a present, non-empty, fully checked recognized plan.

## Existing data

Existing `~/.hl` content is left untouched. Version 0.2 does not initialize, inspect, migrate, delete, commit, push, or reinterpret it as OMO state. Remove it manually only if you independently decide it is no longer needed.

Historical 0.1 documents are not converted into `.omo` files. OMO remains the owner of its own state.

## Artifact and path safety

- Boulder schema version 2 and the legacy unversioned form are supported.
- Unknown explicit versions are skipped without failing OpenCode.
- Unknown fields are tolerated.
- Artifact reads are bounded and regular-file-only.
- Traversal, symlink escapes, and unapproved absolute worktree paths are rejected.
- Additional worktree roots must be listed explicitly in `allowedWorktreeRoots`.
- State and closure roots must resolve outside `.omo`.

The supported protocol was evaluated against OMO commit `91ca94f642ef9d8de8b5c9b95bdf25e9ad94b7ad`. Review release notes and fixtures before enabling a future schema version.

## Operational rollout

1. Remove all 0.1 options and imports listed above.
2. Upgrade to 0.2 and verify that the plugin loads with both OMO absent and present.
3. Leave memory at `auto`/`unknown` or select `upstream` unless a stable capability signal proves upstream memory unavailable.
4. Enable closure export explicitly if wanted, using roots outside `.omo`.
5. If injecting a sink/exporter, give it a stable `id` and make the supplied idempotency key authoritative.
6. Run one completed fixture/work and verify that `.omo` is byte-for-byte unchanged.

Local receipts and locks reduce duplicate effects but do not turn an external sink into exactly-once delivery. A sink must safely replay the same idempotency key after process interruption.
