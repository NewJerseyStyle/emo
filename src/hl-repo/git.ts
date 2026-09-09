import { execSync } from "node:child_process";

function run(root: string, args: string[], label: string): string {
  try {
    return execSync(`git ${args.join(" ")}`, {
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
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
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
  run(root, ["add", "-A"], "add");
  run(root, ["commit", "-m", JSON.stringify(message)], "commit");
}

/** Push the current branch to its upstream remote. */
export function gitPush(root: string): void {
  run(root, ["push"], "push");
}
