# emo-a

**Project-level knowledge for agent-driven development.** emo-a gives a team a near-SDLC loop around a coding agent (omo first): clarify → plan → execute → close → remember. Plans, decisions, lessons and closures live in the project's own git repository, on a dedicated `exp` branch, so the whole team's agents share them and nothing is lost when a session ends.

> emo started as an OpenCode plugin (Evolve-My-OpenCode, v0.1). v0.2 is a rewrite: it no longer lives inside the agent. The data format and the process are ours; omo is reached only through a thin driver. See [docs/emo-a-design.md](docs/emo-a-design.md) for the design and [docs/vision.md](docs/vision.md) for why.

## Why

Fast agent iteration piles up debt and loses information: dead ends are not written down, so the next session (or the next teammate's agent) spends tokens re-discovering them. emo-a makes the agent leave a trail a team can review:

| Document | Written when | Purpose |
| --- | --- | --- |
| `plan` | a goal is accepted | scope, acceptance checks, risks, tasks, estimate; new versions replace old ones via `supersedes` |
| `lesson` | a dead end or insight | **what happened / why / do differently** (all three required) |
| `decision` | a design choice | rationale, with a `supersedes` chain |
| `closure` | work finishes, stalls or is dropped | plan vs actual, lessons written, tokens estimated vs actual |

## How it works

```
skills (emo-ba · emo-pm · emo-closure)   process, agent-agnostic SKILL.md files
emo CLI + kb                             data contract on the `exp` branch
driver                                   runs omo over RPC, verifies the closure
```

- **`exp` branch:** an orphan branch mounted as a git worktree at `<repo>/.emo/exp` (git-ignored on code branches). Code and knowledge never share history.
- **Multi-writer safe:** one document = one file with a unique id; documents are never rewritten, only superseded. Teammates sync with `git pull --rebase`, which does not conflict because nobody edits the same path.
- **Secrets are refused at write time**; lessons without all three parts are rejected; links (`plan`, `supersedes`) must resolve.
- **The runner does not trust the agent's word.** After each run the driver checks that a closure really exists and reminds the agent if not (we observed agents claiming work was done without calling a tool).

## Install

emo-a is a standalone CLI. It does not run inside a coding agent; it drives one (omo) and gives it skills.

Requirements: **git >= 2.42**, **Node >= 20**, and [omo](https://github.com/code-yeongyu/oh-my-openagent) **5.1.34** (the version the driver is verified against; it is only needed to run the agent, the `emo` knowledge CLI works without it). Building from source also needs [bun](https://bun.sh).

```bash
git clone https://github.com/NewJerseyStyle/emo
cd emo
bun install && bun run build
npm link            # puts `emo` on PATH
emo doctor          # checks git and omo
```

Then, in the project you want to work on:

```bash
emo init                                   # mounts the exp branch at .emo/exp
omo --skill "$(emo skills)/emo-ba" --skill "$(emo skills)/emo-pm" --skill "$(emo skills)/emo-closure"
```

The agent then runs `emo plan add`, `emo lesson add`, `emo close` itself. Teammates share the knowledge with `emo sync`.

## Use (CLI)

```bash
emo plan add --goal "ship login" --scope "in: form
out: SSO" --acceptance "login test passes"
emo lesson add --title "Port clash" --what "Test hung" --why "Dev server held the port" --do "Use PORT=0"
emo close --plan <plan-id> --outcome done --actual "as planned" --lessons <lesson-id>
emo list lesson                # superseded plans are hidden unless --all
emo validate && emo sync
```

Drive omo programmatically (RPC, with rate-limit backoff and closure verification): see `src/driver/` and `scripts/e2e-live.ts`.

## Status

- Knowledge store, CLI, skills, driver: implemented, covered by unit/integration tests (`bun test`).
- **Live agent compliance is only partly demonstrated.** With `groq/qwen/qwen3.8-27b` the agent followed emo-ba and emo-pm correctly (draft → confirmed → planned, store validated) but the free tier's 7k-token request cap stopped the run before the closure step. With `google/gemini-flash-lite-latest` the agent made no tool calls and only claimed to be done; the driver caught it (no closure after two reminders). A full plan → execute → closure run by the agent itself has **not** been shown yet; it needs a model/tier with enough quota (`google/gemini-flash-latest` free tier allows 20 requests/day).
- Verified against omo 5.1.34 (`--mode rpc`, `--skill`). omo's RPC surface is not documented as stable: pin the omo version and re-run `bun run e2e:live` before upgrading.
- Not yet done: lesson retrieval ranking, curation/"dream" of the knowledge base, a team pilot.

## Develop

```bash
bun install
bun run typecheck
bun test
bun run build
bun run e2e:live      # real omo + a real model; needs a provider key in .env (see .env.example)
```

## License

MIT
