import { afterEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../../src/config";
import { ensureRepo } from "../../src/hl-repo";
import { docPath } from "../../src/hl-repo/paths";
import type { HlRepoConfig } from "../../src/hl-repo/types";
import { runHandoff, shouldCompact } from "../../src/orchestrator/handoff";
import type { ClosureInput } from "../../src/orchestrator/types";
import type { ControllerEvent } from "../../src/types";

const tmpDirs: string[] = [];

// Provide a git identity via env so real commits work in any environment.
process.env.GIT_AUTHOR_NAME = "Handoff Test";
process.env.GIT_AUTHOR_EMAIL = "handoff@example.com";
process.env.GIT_COMMITTER_NAME = "Handoff Test";
process.env.GIT_COMMITTER_EMAIL = "handoff@example.com";

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-"));
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

function sampleInput(): ClosureInput {
  return {
    phase: "p6",
    tokensSaved: 900,
    summary: "Wired compaction to closure handoff.",
    estimatedTokens: 4000,
    actualTokens: 3100,
    deliverables: ["orchestrator/handoff.ts"],
    issues: ["contextTokens is external to events"],
    risks: ["git identity required in CI"],
    lessons: [
      { what: "reuse reduce", why: "avoids duplication", differently: "import it" },
    ],
    value: "Compaction decisions persist as phase closures.",
    handover: "Next: wire into plugin event handler",
  };
}

function compactEvents(): ControllerEvent[] {
  const t0 = 1000;
  return [
    { type: "session.idle", now: t0 },
    { type: "tick", now: t0 + DEFAULT_CONFIG.gracePeriodMs },
  ];
}

describe("shouldCompact", () => {
  it("S1: idle + large context + grace elapsed → true", () => {
    const events = compactEvents();
    expect(shouldCompact(events, 50_000)).toBe(true);
  });

  it("S2: prompt.submit → false", () => {
    const events: ControllerEvent[] = [{ type: "prompt.submit", now: 1000 }];
    expect(shouldCompact(events, 50_000)).toBe(false);
  });

  it("S2: idle without tick (grace not elapsed) → false", () => {
    const events: ControllerEvent[] = [{ type: "session.idle", now: 1000 }];
    expect(shouldCompact(events, 50_000)).toBe(false);
  });

  it("S6: context below minContextTokens → false", () => {
    const events = compactEvents();
    expect(shouldCompact(events, DEFAULT_CONFIG.minContextTokens - 1)).toBe(false);
  });
});

describe("runHandoff", () => {
  it("S3: compact-triggering events write closure to a real git repo and commit", () => {
    const root = makeTmpDir();
    ensureRepo(makeConfig(root));
    const input = sampleInput();

    const wrote = runHandoff(compactEvents(), input, makeConfig(root), "proj-1", 50_000);

    expect(wrote).toBe(true);
    const p = docPath(root, "proj-1", "closure", input.phase);
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.readFileSync(p, "utf8")).toContain(`phase: "${input.phase}"`);

    const log = execSync("git log --oneline", { cwd: root, encoding: "utf8" });
    expect(log).toContain("closure");
  });

  it("S4: non-compact events → false, no closure file written", () => {
    const root = makeTmpDir();
    ensureRepo(makeConfig(root));
    const input = sampleInput();

    const wrote = runHandoff(
      [{ type: "prompt.submit", now: 1000 }],
      input,
      makeConfig(root),
      "proj-1",
      50_000,
    );

    expect(wrote).toBe(false);
    const p = docPath(root, "proj-1", "closure", input.phase);
    expect(fs.existsSync(p)).toBe(false);
  });
});
