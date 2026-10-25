import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** The omo release the driver was last verified against. Bump together with `bun run e2e:live`. */
export const TESTED_OMO = "5.1.34";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string;
}

type Probe = (cmd: string, args: string[]) => string;

const defaultProbe: Probe = (cmd, args) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

function version(text: string): number[] {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : [];
}

function atLeast(have: number[], want: number[]): boolean {
  for (let i = 0; i < want.length; i++) {
    const h = have[i] ?? 0;
    const w = want[i] ?? 0;
    if (h !== w) return h > w;
  }
  return true;
}

/** Check the external tools emo-a depends on. `probe` is injectable for tests. */
export function doctor(omoBin = "omo", probe: Probe = defaultProbe): Check[] {
  const checks: Check[] = [];

  try {
    const out = probe("git", ["--version"]);
    // `git worktree add --orphan` (used for the exp branch) needs 2.42.
    const ok = atLeast(version(out), [2, 42]);
    checks.push({
      name: "git",
      ok,
      detail: out,
      ...(ok ? {} : { hint: "emo needs git >= 2.42 (worktree add --orphan). Upgrade git." }),
    });
  } catch {
    checks.push({ name: "git", ok: false, detail: "not found", hint: "Install git >= 2.42." });
  }

  try {
    const out = probe(omoBin, ["--version"]);
    const same = version(out).join(".") === version(TESTED_OMO).join(".");
    checks.push({
      name: "omo",
      ok: true,
      detail: same ? out : `${out} (verified against ${TESTED_OMO}; re-run the live e2e before relying on it)`,
    });
  } catch {
    checks.push({
      name: "omo",
      ok: false,
      detail: "not found",
      hint: `Install omo ${TESTED_OMO} and put it on PATH (or set OMO_BIN). Only needed to run the agent; the emo CLI works without it.`,
    });
  }

  return checks;
}

export function formatChecks(checks: Check[]): string[] {
  return checks.flatMap((c) => [
    `${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`,
    ...(c.hint !== undefined ? [`       ${c.hint}`] : []),
  ]);
}

/** Locate the bundled skills directory by walking up from this file (works from src/ and from dist/). */
export function skillsDir(from: string): string | null {
  let dir = path.dirname(from);
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, "skills");
    if (fs.existsSync(path.join(candidate, "emo-ba", "SKILL.md"))) return candidate;
    dir = path.dirname(dir);
  }
  return null;
}
