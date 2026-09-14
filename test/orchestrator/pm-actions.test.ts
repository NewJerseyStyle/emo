import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureRepo } from "../../src/hl-repo";
import { docPath } from "../../src/hl-repo/paths";
import type { HlRepoConfig } from "../../src/hl-repo/types";
import { writeProjectPlan } from "../../src/orchestrator/audit";
import {
  loadPriorClosures,
  scheduleNextTask,
  updateBaMemory,
  writeDecision,
} from "../../src/orchestrator/pm-actions";
import type { Task } from "../../src/pm/types";

const tmpDirs: string[] = [];

process.env.GIT_AUTHOR_NAME = "Pm Actions Test";
process.env.GIT_AUTHOR_EMAIL = "pm-actions@example.com";
process.env.GIT_COMMITTER_NAME = "Pm Actions Test";
process.env.GIT_COMMITTER_EMAIL = "pm-actions@example.com";

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-actions-"));
  tmpDirs.push(dir);
  return dir;
}

function makeConfig(root: string): HlRepoConfig {
  return { root, autoPush: false };
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function sampleTasks(): Task[] {
  return [
    { id: "t1", title: "setup", docTokens: 50, codeTokens: 200, complexity: "low", dependencies: [] },
    { id: "t2", title: "build", docTokens: 100, codeTokens: 500, complexity: "medium", dependencies: ["t1"] },
  ];
}

describe("writeDecision", () => {
  it("writes a decision doc with status/date frontmatter", () => {
    const root = makeTmpDir();
    ensureRepo(makeConfig(root));

    writeDecision(makeConfig(root), "proj-1", "Use TypeScript strict mode");

    const dir = path.join(root, "projects", "proj-1", "decisions");
    const files = fs.readdirSync(dir);
    expect(files.length).toBe(1);
    const content = fs.readFileSync(path.join(dir, files[0]), "utf8");
    expect(content).toContain('status: "accepted"');
    expect(content).toContain("Use TypeScript strict mode");
  });

  it("records a supersedes chain when provided", () => {
    const root = makeTmpDir();
    ensureRepo(makeConfig(root));

    writeDecision(makeConfig(root), "proj-1", "Use strict mode", "decision-1");

    const dir = path.join(root, "projects", "proj-1", "decisions");
    const files = fs.readdirSync(dir);
    const content = fs.readFileSync(path.join(dir, files[0]), "utf8");
    expect(content).toContain('supersedes: "decision-1"');
  });
});

describe("updateBaMemory", () => {
  it("creates ba-memory.md on first call", () => {
    const root = makeTmpDir();
    ensureRepo(makeConfig(root));

    updateBaMemory(makeConfig(root), "proj-1", "User prefers concise answers");

    const filePath = docPath(root, "proj-1", "ba-memory");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toContain("User prefers concise answers");
  });

  it("appends to existing ba-memory.md on later calls", () => {
    const root = makeTmpDir();
    ensureRepo(makeConfig(root));

    updateBaMemory(makeConfig(root), "proj-1", "First entry");
    updateBaMemory(makeConfig(root), "proj-1", "Second entry");

    const content = fs.readFileSync(docPath(root, "proj-1", "ba-memory"), "utf8");
    expect(content).toContain("First entry");
    expect(content).toContain("Second entry");
  });
});

describe("scheduleNextTask", () => {
  it("schedules the first uncompleted task and returns its id", () => {
    const root = makeTmpDir();
    writeProjectPlan(makeConfig(root), "proj-1", "goal", sampleTasks());

    const taskId = scheduleNextTask(makeConfig(root), "proj-1");

    expect(taskId).toBe("t1");
    const todoPath = docPath(root, "proj-1", "todo", "t1");
    expect(fs.existsSync(todoPath)).toBe(true);
    const content = fs.readFileSync(todoPath, "utf8");
    expect(content).toContain('status: "in-progress"');
  });

  it("returns null when there is no plan", () => {
    const root = makeTmpDir();
    ensureRepo(makeConfig(root));

    expect(scheduleNextTask(makeConfig(root), "proj-1")).toBeNull();
  });
});

describe("loadPriorClosures", () => {
  it("returns concatenated closure content", () => {
    const root = makeTmpDir();
    ensureRepo(makeConfig(root));
    const dir = path.join(root, "projects", "proj-1", "closures");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "2026-01-01.md"), "# Closure A");
    fs.writeFileSync(path.join(dir, "2026-01-02.md"), "# Closure B");

    const content = loadPriorClosures(makeConfig(root), "proj-1");

    expect(content).toContain("# Closure A");
    expect(content).toContain("# Closure B");
  });

  it("returns empty string when there are no closures", () => {
    const root = makeTmpDir();
    ensureRepo(makeConfig(root));

    expect(loadPriorClosures(makeConfig(root), "proj-1")).toBe("");
  });
});
