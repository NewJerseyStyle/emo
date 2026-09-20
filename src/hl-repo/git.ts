import { execFileSync } from "node:child_process";
import path from "node:path";

function run(root: string, args: string[], label: string): string {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`git ${label} failed in ${root}: ${detail}`);
  }
}

/** True when `root` is inside a git work tree. */
export function isGitRepo(root: string): boolean {
  try {
    const topLevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return path.resolve(topLevel.trim()) === path.resolve(root);
  } catch {
    return false;
  }
}

/** Initialize a git repository at `root`. */
export function gitInit(root: string): void {
  run(root, ["init"], "init");
}

/** True when there are uncommitted changes in the work tree. */
export function gitHasChanges(root: string): boolean {
  const out = run(root, ["status", "--porcelain"], "status");
  return out.trim().length > 0;
}

/** Stage all changes and commit with `message`. No-op when nothing changed. */
export function gitCommit(root: string, message: string): void {
  if (!gitHasChanges(root)) return;
  run(root, ["add", "--all", "--", "."], "add");
  run(root, ["commit", "-m", message], "commit");
}

/** Push the current branch to its upstream remote. */
export function gitPush(root: string): void {
  run(root, ["push"], "push");
}
