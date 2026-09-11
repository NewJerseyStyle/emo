import { afterEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureRepo } from "../../src/hl-repo";
import { docPath } from "../../src/hl-repo/paths";
import type { HlRepoConfig } from "../../src/hl-repo/types";
import {
  slugify,
  writeChangeRequest,
  writeProjectPlan,
} from "../../src/orchestrator/audit";
import type { Task } from "../../src/pm/types";

const tmpDirs: string[] = [];

process.env.GIT_AUTHOR_NAME = "Audit Test";
process.env.GIT_AUTHOR_EMAIL = "audit@example.com";
process.env.GIT_COMMITTER_NAME = "Audit Test";
process.env.GIT_COMMITTER_EMAIL = "audit@example.com";

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-"));
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

describe("slugify", () => {
  it("lowercases and joins words with dashes", () => {
    expect(slugify("Tender Extraction System")).toBe("tender-extraction-system");
  });

  it("strips non-alphanumeric characters", () => {
    expect(slugify("Build a dashboard! (v2)")).toBe("build-a-dashboard-v2");
  });

  it("falls back to 'project' for empty input", () => {
    expect(slugify("   ")).toBe("project");
  });
});

describe("writeProjectPlan", () => {
  it("writes spec.md and project-plan.md and returns total tokens", () => {
    const root = makeTmpDir();
    const config = makeConfig(root);

    const total = writeProjectPlan(config, "proj-1", "Build a dashboard", sampleTasks());

    expect(fs.existsSync(docPath(root, "proj-1", "spec"))).toBe(true);
    expect(fs.existsSync(docPath(root, "proj-1", "project-plan"))).toBe(true);
    expect(total).toBeGreaterThan(0);

    const plan = fs.readFileSync(docPath(root, "proj-1", "project-plan"), "utf8");
    expect(plan).toContain("t1: setup");
    expect(plan).toContain("t2: build");
  });

  it("commits the docs to git", () => {
    const root = makeTmpDir();
    writeProjectPlan(makeConfig(root), "proj-1", "goal", sampleTasks());

    const log = execSync("git log --oneline", { cwd: root, encoding: "utf8" });
    expect(log).toContain("project-plan");
  });
});

describe("writeChangeRequest", () => {
  it("writes a change-request doc under the project dir", () => {
    const root = makeTmpDir();
    ensureRepo(makeConfig(root));

    writeChangeRequest(makeConfig(root), "proj-1", "Add export to CSV");

    const dir = path.join(root, "projects", "proj-1", "change-requests");
    const files = fs.readdirSync(dir);
    expect(files.length).toBe(1);
    const content = fs.readFileSync(path.join(dir, files[0]), "utf8");
    expect(content).toContain("Add export to CSV");
    expect(content).toContain('status: "open"');
  });
});
