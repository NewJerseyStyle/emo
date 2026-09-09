import { afterEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureRepo } from "../../src/hl-repo";
import { docPath } from "../../src/hl-repo/paths";
import { parseFrontmatter, validateFrontmatter } from "../../src/hl-repo/schema";
import type { HlRepoConfig } from "../../src/hl-repo/types";
import { buildClosureContent, writeClosure } from "../../src/orchestrator/closure";
import type { ClosureInput } from "../../src/orchestrator/types";

const tmpDirs: string[] = [];

// Provide a git identity via env so real commits work in any environment.
process.env.GIT_AUTHOR_NAME = "Orchestrator Test";
process.env.GIT_AUTHOR_EMAIL = "orch@example.com";
process.env.GIT_COMMITTER_NAME = "Orchestrator Test";
process.env.GIT_COMMITTER_EMAIL = "orch@example.com";

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-closure-"));
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

const SECTIONS = [
  "Project Summary",
  "Performance vs Baseline",
  "Deliverables Summary",
  "Issues & Changes",
  "Risk Summary",
  "Lessons Learned",
  "Value Realization",
  "Handover",
  "Closure Approval",
];

function sampleInput(): ClosureInput {
  return {
    phase: "p5",
    tokensSaved: 1200,
    supersedes: "p4",
    summary: "Completed the orchestration layer.",
    estimatedTokens: 5000,
    actualTokens: 3800,
    deliverables: ["orchestrator/route.ts", "orchestrator/closure.ts"],
    issues: ["frontmatter supersedes is optional"],
    risks: ["git identity required in CI"],
    lessons: [
      { what: "routeInput is reusable", why: "avoids duplication", differently: "import it" },
      { what: "frontmatter must be valid", why: "writeDoc validates", differently: "test it" },
    ],
    value: "Cohesive BA→PM→ulw flow",
    handover: "Next: wire into plugin event handler",
  };
}

describe("buildClosureContent", () => {
  it("S4: produces valid closure frontmatter", () => {
    const content = buildClosureContent(sampleInput());
    const parsed = parseFrontmatter(content);

    expect(parsed).not.toBeNull();
    expect(typeof parsed!.frontmatter.phase).toBe("string");
    expect(typeof parsed!.frontmatter.tokens_saved).toBe("number");
    expect(validateFrontmatter("closure", parsed!.frontmatter)).toEqual([]);
  });

  it("S4: includes all PMI section headers", () => {
    const content = buildClosureContent(sampleInput());
    for (const section of SECTIONS) {
      expect(content).toContain(`## ${section}`);
    }
  });

  it("S4: each lesson has what/why/differently", () => {
    const content = buildClosureContent(sampleInput());
    for (const lesson of sampleInput().lessons) {
      expect(content).toContain(`What: ${lesson.what}`);
      expect(content).toContain(`Why: ${lesson.why}`);
      expect(content).toContain(`Differently: ${lesson.differently}`);
    }
  });
});

describe("writeClosure", () => {
  it("S5: writes closure doc to a real git repo and commits", () => {
    const root = makeTmpDir();
    ensureRepo(makeConfig(root));
    const input = sampleInput();

    writeClosure(makeConfig(root), "proj-1", input);

    const p = docPath(root, "proj-1", "closure", input.phase);
    expect(fs.existsSync(p)).toBe(true);

    const log = execSync("git log --oneline", { cwd: root, encoding: "utf8" });
    expect(log).toContain("closure");
  });
});
