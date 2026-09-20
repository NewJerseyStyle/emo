# emo 0.2: Evolve-My-OpenCode

`emo` stands for **Evolve-My-OpenCode**. It is an independent OpenCode plugin and library — `@cache-aware/opencode-cache-compaction` — that preserves evidence from completed [oh-my-opencode (OMO)](https://github.com/code-yeongyu/oh-my-openagent) work.

## Why this exists

`emo` is not only about fitting more work into a smaller context window. It exists so an agent can **evolve**: each completed piece of work leaves durable, PMI-inspired documentation behind, and that documentation — not the chat history — is what the agent learns from, including from its failures. The notepads this package reads are exactly that wins-and-failures surface: `decisions` and `learnings` are what to repeat, while `issues` and `problems` are what not to repeat.

Version 0.2 holds only the part of that mission it can hold safely:

- **Evidence, not inference.** Completion is proven from OMO's own artifacts: a Boulder work whose status is `completed`, plus a present, fully checked, non-empty plan.
- **A durable, PMI-style record.** Every verified completion can be exported as an immutable closure document covering the plan, the decisions, the learnings, the issues, and the problems around the work.
- **Learning that outlives the session.** The normalized snapshot can be promoted through a caller-provided memory sink, which is where distillation, cross-project knowledge, and cross-machine storage belong.
- **Honesty about measurement.** Usage that cannot be measured is reported as `not measured`; savings are never inferred from a plan estimate.

Compaction, planning, and continuation belong to OMO. `emo`'s job is to make what was learned survive. See [docs/vision.md](docs/vision.md) for the full model.

## What it does

It does not plan, route, execute, continue, or compact work. OMO already owns those jobs. This package observes OMO's durable artifacts read-only, verifies that a work item is complete, and can then:

- export an immutable Markdown closure; and
- promote the normalized snapshot through a caller-provided, idempotent memory sink when ownership explicitly permits it.

Both effects are off by default. If OMO is not installed or `.omo/boulder.json` is absent, the plugin is a no-op: it makes no OpenCode client calls and creates no state or output directories.

## Install

```sh
bun add @cache-aware/opencode-cache-compaction
```

The package does not depend on OMO, run OMO as a subprocess, or write into `.omo`. Installation has no lifecycle initializer and does not create or alter `~/.hl`.

The default package export is the OpenCode plugin. Utility APIs are intentionally isolated under `./library`, so importing the library never initializes the plugin.

```jsonc
{
  "plugin": [
    {
      "package": "@cache-aware/opencode-cache-compaction",
      "options": {
        "closureEnabled": true,
        "closureRoot": ".emo/closures",
        "stateRoot": ".emo/state",
        "memoryOwner": "auto",
        "upstreamMemory": "unknown"
      }
    }
  ]
}
```

The package targets the object-form `@opencode-ai/plugin` `^1.18.27` host contract: its default export has a stable `id` and one `server` initializer. The initializer returns lifecycle hooks; it does not create sessions, submit prompts, read messages, probe configuration, or alter the user's prompt.

## Runtime behavior

`session.idle` and `session.compacted` may trigger a bounded scan for the event's session. The event itself never proves completion. Processing requires all of the following:

1. an associated Boulder work whose status is exactly `completed`;
2. a present, safely contained plan; and
3. a recognized, non-empty top-level checklist with every item checked.

The reader supports Boulder schema version 2 and the documented legacy object form without a version. In version 2, `works` is authoritative; a mirrored root record is never processed a second time. Unknown explicit versions, malformed or partial JSON, unsafe paths, symlinks, non-regular files, and oversized sources are skipped without breaking OpenCode.

The implementation follows the OMO artifact protocol inspected at upstream commit `91ca94f642ef9d8de8b5c9b95bdf25e9ad94b7ad` on 2026-09-20. Newer unknown schema versions fail open until this package explicitly supports them.

### Read-only inputs

The bridge may read:

- `.omo/boulder.json`;
- the selected `.omo/plans/<plan>.md`;
- `.omo/goal/<encoded-session-id>.json`;
- `.omo/notepads/<plan>/{decisions,learnings,issues,problems}.md`; and
- `.omo/ulw-execute/ledger.jsonl` as opaque provenance only.

The ledger is not interpreted as typed completion evidence. Missing notepads and goals remain distinguishable from present-but-empty sources in the normalized snapshot.

Default limits are 256 KiB for Boulder, 512 KiB for a plan, 64 KiB per goal, 128 KiB per notepad, 256 KiB for the ledger, and 4 MiB in aggregate. At most 128 works and 128 sessions per work are considered. Additional absolute worktree roots must be explicitly authorized with `allowedWorktreeRoots`.

### Memory ownership

| `memoryOwner` | `upstreamMemory` | Result |
| --- | --- | --- |
| `off` | any | No memory promotion |
| `upstream` | any | Upstream owns memory; no sink call |
| `plugin` | any | Call the injected sink; skip with a diagnostic if none exists |
| `auto` | `available` | Upstream owns memory; no sink call |
| `auto` | `unknown` | Conservatively skip promotion |
| `auto` | `unavailable` | Call an injected sink, or skip if none exists |

Capability must be supplied explicitly or by a stable adapter. Package names and the presence of `.omo` are not capability signals. This package does not invoke a model for distillation; an explicitly configured sink owns any such behavior.

Memory promotion and closure export are independent. A closure can remain enabled while upstream owns memory.

## Library API

### Process a snapshot without OMO

Callers that already have a normalized snapshot do not need OMO installed:

```ts
import {
  createClosureExporter,
  processCompletedWork,
  type CompletedWorkSnapshot,
} from "@cache-aware/opencode-cache-compaction/library";

declare const snapshot: CompletedWorkSnapshot;

const result = await processCompletedWork(snapshot, {
  projectRoot: process.cwd(),
  memoryOwner: "off",
  upstreamMemory: "unknown",
  closureExporter: createClosureExporter({ root: ".emo/closures" }),
  receiptRoot: ".emo/state",
});
```

Public snapshots are validated again at processing time; TypeScript types are not treated as a trust boundary.

### Inject a memory sink

```ts
import {
  processCompletedWork,
  type MemorySink,
} from "@cache-aware/opencode-cache-compaction/library";

const sink: MemorySink = {
  id: "example-memory-v1",
  async promote(snapshot, { idempotencyKey }) {
    await durableStore.putIfAbsent(idempotencyKey, snapshot);
  },
};

await processCompletedWork(snapshot, {
  projectRoot: process.cwd(),
  memoryOwner: "plugin",
  upstreamMemory: "unavailable",
  memorySink: sink,
  receiptRoot: ".emo/state",
});
```

`MemorySink.id` and `ClosureExporter.id` must be stable. Implementations must honor the supplied idempotency key: local receipts and bounded locks reduce duplicate calls, but cannot provide exactly-once delivery across a crash after an external effect succeeds and before its receipt is published.

Closure files are deterministic and immutable. An unchanged snapshot is idempotent; changed post-completion evidence creates a new revision. Reports say `not measured` when authoritative scoped usage is absent and never infer `tokens_saved` from a plan estimate.

## Configuration

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Enable lifecycle observation |
| `closureEnabled` | `false` | Enable immutable closure export |
| `closureRoot` | `.emo/closures` | Closure output outside `.omo` |
| `stateRoot` | `.emo/state` | Effect receipts and locks outside `.omo` |
| `memoryOwner` | `auto` | `auto`, `upstream`, `plugin`, or `off` |
| `upstreamMemory` | `unknown` | `available`, `unavailable`, or `unknown` |
| `allowedWorktreeRoots` | `[]` | Additional authorized roots for absolute plan/worktree paths |
| `limits` | bounded defaults above | Per-source and aggregate read limits |
| `lockTimeoutMs` | `250` | Bounded cross-process lock wait |
| `lockLeaseMs` | `30000` | Stale-lock recovery lease |

Writable state and closure roots are validated to be outside the protected `.omo` tree, including symlink aliases. They are created lazily only when an enabled effect actually succeeds or needs coordination.

## Migration

Version 0.2 is intentionally breaking and has no BA/PM/controller compatibility wrappers. See [docs/migration-0.2.md](docs/migration-0.2.md) for removed exports and options.

Fixture tests prove protocol handling, idempotence, packaging, and no-op behavior. They do not establish model quality, token savings, latency improvements, or compatibility with an unpublished future OMO schema.
