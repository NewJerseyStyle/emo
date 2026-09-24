# Why emo exists

`emo` began as a context-compaction plugin for OpenCode. Compaction answers one question: *how do we keep working inside a fixed context window?* It does not answer the more important one: *what did we learn?*

This document describes the product beyond compaction: an agent that **evolves**, because its experience is written down as durable project documents, so knowledge outlives the context window, the session, the process, and eventually the machine.

## Experience belongs in documents, not in context

Context is working memory: large, fast, and volatile. Documents are long-term memory: small, ordered, and reviewable. `emo` treats every meaningful unit of work — a goal, a decision, a change of scope, a failure, a phase — as something that should leave a durable artifact behind.

The practical rule is: **do not accumulate in context, accumulate in documents.** Context holds what is needed right now; documents hold what must survive.

## A PMI-inspired document model

The document set is deliberately modelled on project-management practice (PMI/PMBOK), because that practice has already answered "how does an organization remember what it did?" over decades.

| PMI / PMBOK artifact | `emo` document | Written when |
| --- | --- | --- |
| Project Charter, Scope Statement / WBS, Business Case, Risk Register | project plan | a new goal is accepted |
| Requirements document, traceability matrix | spec | scope is clarified |
| Stakeholder register, assumption log, issue log | business-analysis memory | input is ambiguous, or feedback arrives |
| Change Request / change log | change requests | scope, a bug, or feedback changes the work |
| Decision log (ADR) | decisions | a design choice is made, with rationale |
| Feasibility study | feasibility | before committing to a plan |
| Schedule / task list | todos | work is scheduled |
| Lessons Learned Register | closures | a phase or work item completes |
| Project closure / closeout / final report | closures | a phase or work item completes |

Those documents map onto the five PMBOK process groups:

| PMBOK process group | Who does it | Output |
| --- | --- | --- |
| Initiating | business analysis | goal, scope, stakeholders, expectations |
| Planning | project management | plan, spec, schedule, cost estimate, risk, feasibility |
| Executing | the execution loop | documents and code, built test-first |
| Monitoring & controlling | analysis + management | validation, change requests |
| Closing | closure capture | final report and lessons learned |

## Learning from wins and from failures

A learning system that records only successes learns a fantasy. `emo` records both:

- **Wins** become decisions with their rationale, reusable conventions, and validated patterns — the knowledge that should be repeated.
- **Failures** become issue logs, validated failure modes and their fixes, change requests, and lessons — the knowledge that should not be repeated.

Every closure carries a **lessons learned** register. Each lesson has three parts, and all three are required:

- **What** happened;
- **Why** it happened;
- **What to do differently** next time.

A lesson without a "differently" is a complaint, not knowledge.

Closures and prior decisions are then read back when the next work item is planned, so the loop closes: plan → execute → close → remember → plan better.

## Scope of memory

The same document set is meant to serve three progressively larger scopes:

1. **Within a project** — documents outlive the context window, the session, and a process restart.
2. **Across projects** — one catalog holds many projects plus shared skills and an index, so a convention or failure learned in one repository is available in the next.
3. **Across machines** — the catalog is versioned and can be mirrored through a remote, so experience follows the developer rather than the machine.

The first scope is the solid foundation. The second and third are the direction of travel: they depend on documents being structured, deterministic, and safe to replay, which is why the format and the write discipline matter as much as the features.

## What must stay true

- The agent must not fabricate experience. Unmeasured values are reported as `not measured`.
- A document is evidence, not decoration; it must be derived from real work.
- Writes must be reviewable, immutable where possible, and safe to repeat.
- Ownership of a document must be explicit, and another tool's state must never be silently rewritten.

See the repository README for how the current version implements this vision.
