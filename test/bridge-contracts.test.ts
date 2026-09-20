import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertWritableRootOutsideOmo, resolveBridgeConfig } from "../src/bridge-config";
import type { CompletedWorkSnapshot, SourceRef } from "../src/bridge-types";
import { computeSnapshotID, validateCompletedWorkSnapshot } from "../src/snapshot";

const roots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "emo-contract-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function source(relativePath: string): SourceRef {
  return { relativePath, sha256: "a".repeat(64), bytes: 1 };
}

function validSnapshot(): CompletedWorkSnapshot {
  const identity: Omit<CompletedWorkSnapshot, "snapshotID"> = {
    version: 1,
    projectID: "p".repeat(64),
    workID: "work-1",
    workStartedAt: "2026-09-20T00:00:00.000Z",
    planName: "plan-1",
    sessionIDs: ["opencode:session-1"],
    completedAt: "2026-09-20T01:00:00.000Z",
    plan: {
      state: "present",
      value: { markdown: "- [x] done", total: 1, completed: 1 },
      source: source(".omo/plans/plan-1.md"),
    },
    goals: [],
    notepads: {
      decisions: { state: "missing" },
      learnings: { state: "missing" },
      issues: { state: "missing" },
      problems: { state: "missing" },
    },
    ledger: { state: "missing" },
    completion: {
      status: "completed",
      basis: "boulder-and-plan",
      boulder: { ...source(".omo/boulder.json"), selector: "works.work-1" },
    },
  };
  return { ...identity, snapshotID: computeSnapshotID(identity) };
}

describe("resolveBridgeConfig", () => {
  it("defaults to conservative memory ownership and disabled closure", () => {
    const root = tempRoot();
    const config = resolveBridgeConfig(root, undefined);
    expect(config.memoryOwner).toBe("auto");
    expect(config.upstreamMemory).toBe("unknown");
    expect(config.closureEnabled).toBe(false);
    expect(fs.existsSync(path.join(root, ".emo"))).toBe(false);
  });
});

describe("assertWritableRootOutsideOmo", () => {
  it("rejects direct, nested, and symlinked .omo destinations", () => {
    const root = tempRoot();
    const omo = path.join(root, ".omo");
    fs.mkdirSync(omo);
    const alias = path.join(root, "omo-alias");
    fs.symlinkSync(omo, alias);

    expect(() => assertWritableRootOutsideOmo(root, omo)).toThrow();
    expect(() => assertWritableRootOutsideOmo(root, path.join(omo, "receipts"))).toThrow();
    expect(() => assertWritableRootOutsideOmo(root, path.join(alias, "receipts"))).toThrow();
    expect(() => assertWritableRootOutsideOmo(root, path.join(root, ".emo", "receipts"))).not.toThrow();
  });
});

describe("snapshot identity", () => {
  it("accepts matching deterministic content and rejects mutation", () => {
    const snapshot = validSnapshot();
    expect(validateCompletedWorkSnapshot(snapshot)).toEqual([]);
    const mutated = { ...snapshot, workID: "other" };
    expect(validateCompletedWorkSnapshot(mutated)).toContain("snapshotID does not match content");
  });

  it("rejects empty or incomplete plans", () => {
    const snapshot = validSnapshot();
    const invalid = {
      ...snapshot,
      plan: { ...snapshot.plan, value: { markdown: "", total: 0, completed: 0 } },
    } as CompletedWorkSnapshot;
    expect(validateCompletedWorkSnapshot(invalid)).toContain(
      "completed snapshot requires a non-empty complete checklist",
    );
  });
});
