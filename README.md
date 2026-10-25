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

## Use

```bash
bun install
bun run emo -- init                       # mount the exp branch in the current repo
bun run emo -- plan add --goal "ship login" --scope "in: form\nout: SSO" --acceptance "login test passes"
bun run emo -- lesson add --title "Port clash" --what "Test hung" --why "Dev server held the port" --do "Use PORT=0"
bun run emo -- close --plan <plan-id> --outcome done --actual "as planned" --lessons <lesson-id>
bun run emo -- list lesson                # superseded plans are hidden unless --all
bun run emo -- validate && bun run emo -- sync
```

Load the skills into omo so the agent uses these commands itself:

```bash
omo --skill ./skills/emo-ba --skill ./skills/emo-pm --skill ./skills/emo-closure
```

Drive omo programmatically (RPC, with rate-limit backoff and closure verification): see `src/driver/` and `scripts/e2e-live.ts`.

## Status

- Knowledge store, CLI, skills, driver: implemented, covered by unit/integration tests (`bun test`).
- Verified against omo 5.1.34 (`--mode rpc`, `--skill`). omo's RPC surface is not documented as stable: pin the omo version and re-run `bun run e2e:live` before upgrading.
- Not yet done: lesson retrieval ranking (the PM skill lists lessons and reads the relevant ones), curation/"dream" of the knowledge base, a team pilot.

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
