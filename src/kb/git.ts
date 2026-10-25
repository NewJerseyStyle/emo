import { execFileSync } from "node:child_process";

/** Run git with an argument array (no shell). Returns trimmed stdout. */
export function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message: string };
    const detail = (e.stderr ? String(e.stderr) : e.message).trim();
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${detail}`);
  }
}

/** True when `git <args>` exits 0. */
export function gitOk(cwd: string, args: string[]): boolean {
  try {
    execFileSync("git", args, { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
