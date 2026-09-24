# emo: Evolve-My-OpenCode

`emo` stands for **Evolve-My-OpenCode**: an agent should get better at its job because of the work it has already done. It does two jobs for an OpenCode agent:

1. **Keeps work going across compaction.** It preserves useful task context across compaction and keeps ULW/ulw-loop handoffs warm, so a long run survives a fixed context window.
2. **Lets the agent learn from its own work.** When oh-my-opencode is present, it enables a business-analysis and project-management layer that writes each project's experience to durable, PMI-inspired documents.

Compaction answers *how do we keep working inside the context window?* The document layer answers *what did we learn, and how does that survive the session, the project, and the machine?* See [docs/vision.md](docs/vision.md) for the full model.

## What the agent learns, and where it is written

Experience is written down instead of accumulated in context. Every unit of work leaves a document behind in a shared Git-backed repository:

| Document | PMI/PMBOK equivalent | Written when |
| --- | --- | --- |
| project plan | project charter, scope statement / WBS, business case, risk register | a new goal is accepted |
| spec | requirements document, traceability matrix | scope is clarified |
| business-analysis memory | stakeholder register, assumption log, issue log | ambiguous input or feedback arrives |
| change requests | change request / change log | scope, a bug, or feedback changes the work |
| decisions | decision log (ADR, with a `supersedes` chain) | a design choice is made |
| feasibility | feasibility study | before committing to a plan |
| todos | schedule / task list | work is scheduled |
| closures | lessons learned register, project closure / final report | a phase or work item completes |

Wins become decisions, their rationale, and reusable patterns. Failures become issue logs, validated failure modes and their fixes, change requests, and lessons learned. Each lesson records **what** happened, **why** it happened, and **what to do differently** — all three are required.

Closures and prior decisions are read back when the next plan is generated, so the loop closes: plan → execute → close → remember → plan better.

## Memory scope

| Scope | How it works |
| --- | --- |
| Within a project | Documents live in the repository, so they outlive the context window, the session, and a process restart. |
| Across projects | One repository holds `projects/<project-id>/` for every project, plus shared `skills/` and an `index.md` catalog. |
| Across machines | The repository is a Git repository, so it can be mirrored through a remote (`hlRemote`) to carry experience between machines. |

The repository root is set with `hlRepoRoot`. The installer initialises `~/.hl`; the runtime default is `<opencode directory>/.hl`.

> Status: this is the 0.1.x line. The `refactor/omo-integration` branch (0.2) narrows the plugin to a read-only completed-work evidence bridge and delegates planning and memory promotion upstream.

## Install with an agent

If you already use OpenClaw, Codex, OpenCode, or another coding agent, copy the prompt below into that agent. It is intentionally written so the agent performs the setup instead of asking you to edit configuration files manually.

```text
Install and configure the NewJerseyStyle/emo repository as an OpenCode plugin in this environment.

Repository: https://github.com/NewJerseyStyle/emo
Plugin package: @cache-aware/opencode-cache-compaction
Required companion: oh-my-opencode

Act as the coding agent and do the whole setup:

1. Inspect the current environment and locate the active OpenCode configuration. Preserve existing settings, plugins, providers, credentials, and formatting.
2. Confirm that oh-my-opencode is installed or already configured. If it is missing, install/configure it using the environment's normal OpenCode procedure before continuing.
3. Clone this repository to a suitable local directory, or update its existing checkout.
4. Install dependencies with the available package manager, build the plugin, and run its typecheck and tests. If a required tool is missing, install it when permitted; otherwise report the exact blocker.
5. Register the built plugin in the active OpenCode configuration using a stable absolute local path. Do not remove or reorder unrelated plugins. If OpenCode supports the published package directly, use the published package instead.
6. Ensure the configuration still includes oh-my-opencode so this plugin can detect and cooperate with it.
7. Validate the resulting configuration, reload/restart OpenCode if needed, and verify that the plugin loads successfully. Look for the log message: "[cache-compaction] plugin server loaded".
8. Report exactly what you changed, which config file was changed, the validation commands and results, and any remaining issue. Do not merely give me instructions—perform the changes yourself.
```

## Manual installation

For a local checkout, build the plugin and add its absolute `dist` directory or package path to the `plugin` array in the OpenCode configuration. Keep the existing oh-my-opencode entry. After restarting OpenCode, a successful load prints:

```text
[cache-compaction] plugin server loaded
```

The package postinstall hook initializes the local HL repository at `~/.hl` when possible. It is best-effort and does not modify OpenCode configuration.

## Development

This project uses Bun:

```bash
bun install
bun run typecheck
bun test
bun run build
```

The plugin degrades gracefully when oh-my-opencode is not installed; the additional orchestration behavior is enabled only when the OpenCode configuration contains an oh-my-opencode-compatible plugin entry.

## License

MIT
