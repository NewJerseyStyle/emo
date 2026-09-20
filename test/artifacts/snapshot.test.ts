import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverCompletedWork } from "../../src/artifacts/snapshot";
import { validateCompletedWorkSnapshot } from "../../src/snapshot";

const roots: string[] = [];

function temporaryProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), "emo-artifact-discovery-"));
  roots.push(root);
  return root;
}

function write(root: string, relative: string, content: string | Uint8Array): void {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function completedWork(overrides: Record<string, unknown> = {}) {
  return {
    work_id: "work-a",
    active_plan: ".omo/plans/plan-a.md",
    plan_name: "plan-a",
    status: "completed",
    started_at: "2026-09-20T00:00:00.000Z",
    ended_at: "2026-09-20T01:00:00.000Z",
    session_ids: ["opencode:session-a"],
    ...overrides,
  };
}

function completePlan(title = "Ship"): string {
  return `## TODOs\n- [x] 1. ${title}\n## Final Verification Wave\n- [x] F1. Verify\n`;
}

function writeGoal(root: string, session = "session-a", overrides: Record<string, unknown> = {}): void {
  write(root, `.omo/goal/${encodeURIComponent(session)}.json`, JSON.stringify({
    version: 1,
    goal: {
      id: `goal-${session}`,
      sessionID: session,
      objective: "Complete the work",
      status: "complete",
      tokensUsed: 10,
      timeUsedSeconds: 20,
      createdAt: 1,
      updatedAt: 2,
      completedAt: 3,
      ...overrides,
    },
  }));
}

function createCompleteFixture(): string {
  const root = temporaryProject();
  write(root, ".omo/boulder.json", JSON.stringify({
    schema_version: 2,
    active_work_id: "work-a",
    works: { "work-a": completedWork() },
    // A root mirror must never create a second snapshot.
    ...completedWork({ work_id: undefined, plan_name: "stale-mirror" }),
  }));
  write(root, ".omo/plans/plan-a.md", completePlan());
  writeGoal(root);
  write(root, ".omo/notepads/plan-a/decisions.md", "");
  write(root, ".omo/notepads/plan-a/learnings.md", "# Learnings\n");
  write(root, ".omo/notepads/plan-a/issues.md", "Issue evidence\n");
  // problems.md is intentionally missing.
  write(root, ".omo/ulw-execute/ledger.jsonl", '{"event":"task-completed"}\n');
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("discoverCompletedWork", () => {
  test("reports absent OMO without creating state", async () => {
    const root = temporaryProject();
    expect(await discoverCompletedWork({ projectRoot: root })).toEqual({
      presence: "absent",
      snapshots: [],
      diagnostics: [],
    });
  });

  test("discovers normalized goal, notes, ledger, provenance, and a valid deterministic snapshot", async () => {
    const root = createCompleteFixture();
    const first = await discoverCompletedWork({ projectRoot: root, sessionID: "session-a" });
    const second = await discoverCompletedWork({ projectRoot: root, sessionID: "opencode:session-a" });
    expect(first.presence).toBe("present");
    expect(first.snapshots).toHaveLength(1);
    expect(second.snapshots[0]?.snapshotID).toBe(first.snapshots[0]?.snapshotID);

    const snapshot = first.snapshots[0];
    if (snapshot === undefined) throw new Error("fixture did not produce a snapshot");
    expect(validateCompletedWorkSnapshot(snapshot)).toEqual([]);
    expect(snapshot.sessionIDs).toEqual(["opencode:session-a"]);
    expect(snapshot.goals[0]).toMatchObject({
      state: "present",
      value: { sessionID: "opencode:session-a", objective: "Complete the work" },
    });
    expect(snapshot.notepads.decisions).toMatchObject({ state: "present", value: "" });
    expect(snapshot.notepads.learnings).toMatchObject({ state: "present", value: "# Learnings\n" });
    expect(snapshot.notepads.problems).toEqual({ state: "missing" });
    expect(snapshot.ledger).toMatchObject({ state: "present" });
    expect(snapshot.completion.boulder.selector).toBe("#/works/work-a");
  });

  test("isolates concurrent works, sessions, statuses, and unrelated Boulder changes", async () => {
    const root = createCompleteFixture();
    const boulderPath = path.join(root, ".omo/boulder.json");
    const registry = {
      schema_version: 2,
      active_work_id: "work-b",
      works: {
        "work-a": completedWork(),
        "work-b": completedWork({
          work_id: "work-b",
          plan_name: "plan-b",
          active_plan: ".omo/plans/plan-b.md",
          session_ids: ["codex:session-b"],
        }),
        "work-active": completedWork({ work_id: "work-active", status: "active", session_ids: ["opencode:session-a"] }),
        "work-paused": completedWork({ work_id: "work-paused", status: "paused", session_ids: ["opencode:session-a"] }),
        "work-abandoned": completedWork({ work_id: "work-abandoned", status: "abandoned", session_ids: ["opencode:session-a"] }),
      },
    };
    writeFileSync(boulderPath, JSON.stringify(registry));
    write(root, ".omo/plans/plan-b.md", completePlan("Other"));
    const first = await discoverCompletedWork({ projectRoot: root, sessionID: "session-a" });
    expect(first.snapshots.map((item) => item.workID)).toEqual(["work-a"]);

    registry.works["work-b"] = completedWork({
      work_id: "work-b",
      plan_name: "changed-unrelated",
      active_plan: ".omo/plans/plan-b.md",
      session_ids: ["codex:session-b"],
    });
    writeFileSync(boulderPath, JSON.stringify(registry));
    const second = await discoverCompletedWork({ projectRoot: root, sessionID: "session-a" });
    expect(second.snapshots[0]?.snapshotID).toBe(first.snapshots[0]?.snapshotID);
  });

  test("keeps reused legacy plans distinct through start time", async () => {
    const root = temporaryProject();
    const legacy = (started_at: string) => ({
      active_plan: ".omo/plans/reused.md",
      plan_name: "reused",
      status: "completed",
      started_at,
      session_ids: [],
    });
    write(root, ".omo/plans/reused.md", "- [x] done\n");
    write(root, ".omo/boulder.json", JSON.stringify(legacy("2026-09-20T00:00:00.000Z")));
    const first = await discoverCompletedWork({ projectRoot: root });
    write(root, ".omo/boulder.json", JSON.stringify(legacy("2026-09-21T00:00:00.000Z")));
    const second = await discoverCompletedWork({ projectRoot: root });
    expect(first.snapshots[0]?.workID).toBe("reused-legacy");
    expect(second.snapshots[0]?.workID).toBe("reused-legacy");
    expect(second.snapshots[0]?.snapshotID).not.toBe(first.snapshots[0]?.snapshotID);
  });

  test("requires completed Boulder status and a nonempty fully checked plan", async () => {
    const root = createCompleteFixture();
    const boulderPath = path.join(root, ".omo/boulder.json");
    const planPath = path.join(root, ".omo/plans/plan-a.md");

    writeFileSync(boulderPath, JSON.stringify({ schema_version: 2, works: { "work-a": completedWork({ status: "active" }) } }));
    expect((await discoverCompletedWork({ projectRoot: root })).snapshots).toEqual([]);

    writeFileSync(boulderPath, JSON.stringify({ schema_version: 2, works: { "work-a": completedWork() } }));
    writeFileSync(planPath, "No checklist\n");
    expect((await discoverCompletedWork({ projectRoot: root })).snapshots).toEqual([]);
    writeFileSync(planPath, "- [x] done\n- [ ] open\n");
    expect((await discoverCompletedWork({ projectRoot: root })).snapshots).toEqual([]);
  });

  test("fails open for malformed and unsupported Boulder state", async () => {
    const root = temporaryProject();
    write(root, ".omo/boulder.json", "{");
    expect((await discoverCompletedWork({ projectRoot: root })).presence).toBe("unsupported");
    write(root, ".omo/boulder.json", JSON.stringify({ schema_version: 99 }));
    expect((await discoverCompletedWork({ projectRoot: root })).presence).toBe("unsupported");
  });

  test("skips work for malformed goal evidence and oversized optional evidence", async () => {
    const root = createCompleteFixture();
    writeGoal(root, "session-a", { sessionID: "different" });
    const malformed = await discoverCompletedWork({ projectRoot: root });
    expect(malformed.snapshots).toEqual([]);
    expect(malformed.diagnostics.map((item) => item.code)).toContain("goal.invalid");

    writeGoal(root);
    write(root, ".omo/notepads/plan-a/issues.md", "123456");
    const oversized = await discoverCompletedWork({
      projectRoot: root,
      limits: { notepadBytes: 5 },
    });
    expect(oversized.snapshots).toEqual([]);
    expect(oversized.diagnostics.map((item) => item.code)).toContain("read.too_large");
  });

  test("rejects plan traversal and symlink escapes", async () => {
    const root = createCompleteFixture();
    write(root, ".omo/boulder.json", JSON.stringify({
      schema_version: 2,
      works: { "work-a": completedWork({ active_plan: "../outside.md" }) },
    }));
    const traversal = await discoverCompletedWork({ projectRoot: root });
    expect(traversal.snapshots).toEqual([]);
    expect(traversal.diagnostics.map((item) => item.code)).toContain("plan.unsafe_path");

    const planPath = path.join(root, ".omo/plans/plan-a.md");
    rmSync(planPath);
    const outside = path.join(temporaryProject(), "outside.md");
    writeFileSync(outside, completePlan());
    symlinkSync(outside, planPath);
    write(root, ".omo/boulder.json", JSON.stringify({ schema_version: 2, works: { "work-a": completedWork() } }));
    const symlink = await discoverCompletedWork({ projectRoot: root });
    expect(symlink.snapshots).toEqual([]);
    expect(symlink.diagnostics.map((item) => item.code)).toContain("read.symlink");
  });

  test("reads an explicitly authorized worktree and rejects an unauthorized one", async () => {
    const root = createCompleteFixture();
    const worktree = temporaryProject();
    write(worktree, ".omo/plans/plan-a.md", completePlan("Worktree"));
    write(root, ".omo/boulder.json", JSON.stringify({
      schema_version: 2,
      works: { "work-a": completedWork({ worktree_path: worktree }) },
    }));
    expect((await discoverCompletedWork({ projectRoot: root })).snapshots).toEqual([]);
    const allowed = await discoverCompletedWork({ projectRoot: root, allowedWorktreeRoots: [worktree] });
    expect(allowed.snapshots).toHaveLength(1);
    expect(allowed.snapshots[0]?.plan).toMatchObject({
      state: "present",
      value: { markdown: completePlan("Worktree") },
      source: { relativePath: ".omo/plans/plan-a.md" },
    });

    rmSync(path.join(worktree, ".omo/plans/plan-a.md"));
    const fallback = await discoverCompletedWork({
      projectRoot: root,
      allowedWorktreeRoots: [worktree],
    });
    expect(fallback.snapshots).toHaveLength(1);
    expect(fallback.snapshots[0]?.plan).toMatchObject({
      state: "present",
      value: { markdown: completePlan() },
    });
  });

  test("enforces aggregate read budget", async () => {
    const root = createCompleteFixture();
    const result = await discoverCompletedWork({
      projectRoot: root,
      limits: { aggregateBytes: 200 },
    });
    expect(result.snapshots).toEqual([]);
    expect(result.diagnostics.map((item) => item.code)).toContain("read.aggregate_too_large");
  });
});
