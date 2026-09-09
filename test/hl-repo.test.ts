import { afterEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureRepo, readDoc, writeDoc } from "../src/hl-repo";
import { docPath, projectDir } from "../src/hl-repo/paths";
import { parseFrontmatter, validateFrontmatter } from "../src/hl-repo/schema";
import type { HlRepoConfig } from "../src/hl-repo/types";

const tmpDirs: string[] = [];

// Provide a git identity via env so real commits work in any environment.
process.env.GIT_AUTHOR_NAME = "HL Repo Test";
process.env.GIT_AUTHOR_EMAIL = "test@example.com";
process.env.GIT_COMMITTER_NAME = "HL Repo Test";
process.env.GIT_COMMITTER_EMAIL = "test@example.com";

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-repo-"));
  tmpDirs.push(dir);
  return dir;
}

function makeConfig(root: string, overrides: Partial<HlRepoConfig> = {}): HlRepoConfig {
  return { root, autoPush: false, ...overrides };
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("ensureRepo", () => {
  it("S1: creates projects/skills/index.md, git init, and initial commit", () => {
    const root = makeTmpDir();
    ensureRepo(makeConfig(root));

    expect(fs.existsSync(path.join(root, "projects"))).toBe(true);
    expect(fs.existsSync(path.join(root, "skills"))).toBe(true);
    expect(fs.existsSync(path.join(root, "index.md"))).toBe(true);

    const log = execSync("git log --oneline", { cwd: root, encoding: "utf8" });
    expect(log.trim()).not.toBe("");
  });

  it("S1: is idempotent when called twice", () => {
    const root = makeTmpDir();
    ensureRepo(makeConfig(root));
    expect(() => ensureRepo(makeConfig(root))).not.toThrow();
  });
});

describe("writeDoc", () => {
  it("S2: writes project-plan with valid frontmatter and commits", () => {
    const root = makeTmpDir();
    ensureRepo(makeConfig(root));
    const content = `---\nstatus: active\ntitle: My Plan\n---\n# Plan\nbody here`;

    writeDoc(makeConfig(root), "proj-1", "project-plan", content);

    const p = docPath(root, "proj-1", "project-plan");
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.readFileSync(p, "utf8")).toBe(content);

    const log = execSync("git log --oneline", { cwd: root, encoding: "utf8" });
    expect(log).toContain("project-plan");
  });

  it("S2: writes a named decision into decisions/", () => {
    const root = makeTmpDir();
    ensureRepo(makeConfig(root));
    const content = `---\nstatus: accepted\ndate: 2026-01-01\n---\n# ADR\nbody`;

    writeDoc(makeConfig(root), "proj-1", "decision", content, "adr-001");

    const p = docPath(root, "proj-1", "decision", "adr-001");
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.readFileSync(p, "utf8")).toBe(content);
  });

  it("S3: throws validation error for invalid closure frontmatter", () => {
    const root = makeTmpDir();
    ensureRepo(makeConfig(root));
    const content = `---\nphase: p1\ntokens_saved: abc\n---\nbody`;

    expect(() =>
      writeDoc(makeConfig(root), "proj-1", "closure", content, "c1"),
    ).toThrow(/tokens_saved/);
  });

  it("S3: throws when content has no frontmatter", () => {
    const root = makeTmpDir();
    ensureRepo(makeConfig(root));

    expect(() =>
      writeDoc(makeConfig(root), "proj-1", "project-plan", "# no frontmatter"),
    ).toThrow(/frontmatter/);
  });
});

describe("readDoc", () => {
  it("S4: returns null for a missing doc", () => {
    const root = makeTmpDir();
    ensureRepo(makeConfig(root));
    expect(readDoc(makeConfig(root), "proj-1", "spec")).toBeNull();
  });

  it("S4: returns parsed doc for an existing doc", () => {
    const root = makeTmpDir();
    ensureRepo(makeConfig(root));
    const content = `---\nstatus: active\n---\n# Body`;
    writeDoc(makeConfig(root), "proj-1", "project-plan", content);

    const parsed = readDoc(makeConfig(root), "proj-1", "project-plan");
    expect(parsed).not.toBeNull();
    expect(parsed!.frontmatter).toEqual({ status: "active" });
    expect(parsed!.body).toBe("# Body");
  });
});

describe("docPath", () => {
  it("S5: maps each DocType to the correct path", () => {
    const root = "/root";
    expect(docPath(root, "p1", "project-plan")).toBe(
      path.join(root, "projects", "p1", "project-plan.md"),
    );
    expect(docPath(root, "p1", "spec")).toBe(path.join(root, "projects", "p1", "spec.md"));
    expect(docPath(root, "p1", "ba-memory")).toBe(
      path.join(root, "projects", "p1", "ba-memory.md"),
    );
    expect(docPath(root, "p1", "decision", "d1")).toBe(
      path.join(root, "projects", "p1", "decisions", "d1.md"),
    );
    expect(docPath(root, "p1", "change-request", "cr1")).toBe(
      path.join(root, "projects", "p1", "change-requests", "cr1.md"),
    );
    expect(docPath(root, "p1", "closure", "c1")).toBe(
      path.join(root, "projects", "p1", "closures", "c1.md"),
    );
    expect(docPath(root, "p1", "todo", "t1")).toBe(
      path.join(root, "projects", "p1", "todos", "t1.md"),
    );
    expect(docPath(root, "p1", "index")).toBe(path.join(root, "index.md"));
    expect(docPath(root, "p1", "skill", "s1")).toBe(path.join(root, "skills", "s1.md"));
  });

  it("S5: projectDir resolves under projects/", () => {
    expect(projectDir("/root", "p1")).toBe(path.join("/root", "projects", "p1"));
  });
});

describe("parseFrontmatter", () => {
  it("parses string/number/boolean/array values", () => {
    const content = `---\nstatus: active\ncount: 3\nflag: true\nitems: [a, b, c]\n---\nbody`;
    const parsed = parseFrontmatter(content);
    expect(parsed).not.toBeNull();
    expect(parsed!.frontmatter).toEqual({
      status: "active",
      count: 3,
      flag: true,
      items: ["a", "b", "c"],
    });
    expect(parsed!.body).toBe("body");
  });

  it("returns null when there is no frontmatter", () => {
    expect(parseFrontmatter("# no frontmatter")).toBeNull();
  });

  it("parses quoted strings and strips quotes", () => {
    const content = `---\ntitle: "Hello World"\n---\nbody`;
    const parsed = parseFrontmatter(content);
    expect(parsed!.frontmatter).toEqual({ title: "Hello World" });
  });
});

describe("validateFrontmatter", () => {
  it("closure requires phase and numeric tokens_saved", () => {
    expect(validateFrontmatter("closure", { phase: "p1", tokens_saved: 100 })).toEqual([]);
    expect(validateFrontmatter("closure", { phase: "p1", tokens_saved: "abc" })).not.toEqual([]);
    expect(validateFrontmatter("closure", { tokens_saved: 100 })).not.toEqual([]);
  });

  it("decision requires status and date", () => {
    expect(validateFrontmatter("decision", { status: "accepted", date: "2026-01-01" })).toEqual([]);
    expect(validateFrontmatter("decision", { status: "accepted" })).not.toEqual([]);
    expect(validateFrontmatter("decision", { date: "2026-01-01" })).not.toEqual([]);
  });

  it("change-request requires status and date", () => {
    expect(
      validateFrontmatter("change-request", { status: "open", date: "2026-01-01" }),
    ).toEqual([]);
    expect(validateFrontmatter("change-request", { status: "open" })).not.toEqual([]);
  });

  it("project-plan requires status", () => {
    expect(validateFrontmatter("project-plan", { status: "active" })).toEqual([]);
    expect(validateFrontmatter("project-plan", {})).not.toEqual([]);
  });

  it("other doc types have no required fields", () => {
    expect(validateFrontmatter("spec", {})).toEqual([]);
    expect(validateFrontmatter("ba-memory", {})).toEqual([]);
    expect(validateFrontmatter("todo", {})).toEqual([]);
    expect(validateFrontmatter("index", {})).toEqual([]);
    expect(validateFrontmatter("skill", {})).toEqual([]);
  });
});
