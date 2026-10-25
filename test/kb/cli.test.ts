import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../../src/cli/main";

process.env.GIT_AUTHOR_NAME = "Test";
process.env.GIT_AUTHOR_EMAIL = "test@example.com";
process.env.GIT_COMMITTER_NAME = "Test";
process.env.GIT_COMMITTER_EMAIL = "test@example.com";

const tmpDirs: string[] = [];

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "emo-cli-"));
  tmpDirs.push(dir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "a.txt"), "x\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup on Windows
    }
  }
});

function emo(cwd: string, args: string[], stdin = ""): { code: number; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const code = run([...args, "--author", "ada"], {
    cwd,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    readStdin: () => stdin,
  });
  return { code, out, err };
}

describe("emo cli", { timeout: 60_000 }, () => {
  it("runs plan → lesson → close → list → validate end to end", () => {
    const repo = makeRepo();
    expect(emo(repo, ["init"]).code).toBe(0);

    const plan = emo(repo, ["plan", "add", "--goal", "ship login", "--status", "confirmed"]);
    expect(plan.code).toBe(0);
    const planId = plan.out[0] as string;
    expect(planId.startsWith("plan-")).toBe(true);

    const lesson = emo(repo, [
      "lesson", "add", "--title", "Port clash",
      "--what", "Test hung", "--why", "Port held by dev server", "--do", "Use PORT=0",
    ]);
    expect(lesson.code).toBe(0);

    const closure = emo(
      repo,
      ["close", "--plan", planId, "--outcome", "done", "--tokens-estimated", "50000", "--tokens-actual", "82000", "--file", "-"],
      "## Plan vs actual\nOver by 64%.\n\n## Lessons\nPort clash.\n",
    );
    expect(closure.code).toBe(0);

    const listed = emo(repo, ["list", "lesson"]);
    expect(listed.out[0]).toContain("Port clash");

    const shown = emo(repo, ["show", closure.out[0] as string]);
    expect(shown.out[0]).toContain("tokens_actual: 82000");

    expect(emo(repo, ["validate"])).toMatchObject({ code: 0, out: ["ok"] });
  });

  it("reports user errors with exit code 2 and writes nothing", () => {
    const repo = makeRepo();
    const bad = emo(repo, ["lesson", "add", "--title", "t", "--what", "x", "--why", "y", "--do", " "]);
    expect(bad.code).toBe(2);
    expect(bad.err[0]).toContain("emo:");
    expect(emo(repo, ["list", "lesson"]).out).toEqual([]);
    expect(emo(repo, ["bogus"]).code).toBe(2);
  });

  it("validate flags a document edited by hand", () => {
    const repo = makeRepo();
    const id = emo(repo, [
      "lesson", "add", "--title", "t", "--what", "a", "--why", "b", "--do", "c",
    ]).out[0] as string;
    const file = path.join(repo, ".emo", "exp", "inbox", `${id}.md`);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("c\n", "key: sk-" + "a".repeat(30) + "\n"));
    const result = emo(repo, ["validate"]);
    expect(result.code).toBe(1);
    expect(result.err[0]).toContain("credential-like");
  });
});
