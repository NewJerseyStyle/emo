# emo skills

Plain `SKILL.md` files, usable by any agent that loads skills.

| skill | when |
| --- | --- |
| `emo-ba` | new goal / scope change / vague request: clarify, draft a plan |
| `emo-pm` | confirmed plan: tasks, relevant lessons, estimate |
| `emo-closure` | work finished or a dead end hit: lessons and plan-vs-actual |

They call the `emo` CLI (`bun run emo -- <args>` from this repo, or the `emo` binary once packaged) which reads and writes the `exp` branch of the current project repository.

## Load with omo

`omo --skill ./skills/emo-ba --skill ./skills/emo-pm --skill ./skills/emo-closure`

(The `--skill <path>` flag is in `omo --help` as of omo 5.1.34. Persistent configuration via `skills.sources` is documented for omo but has not been verified against the senpi edition.)
