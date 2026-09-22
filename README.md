# Cache-aware OpenCode compaction

An OpenCode plugin that preserves useful task context across compaction and keeps ULW/ulw-loop handoffs warm. When oh-my-opencode is present, it also enables the project-management and business-analysis orchestration layer.

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
