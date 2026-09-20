import type { CompletedWorkSnapshot, SourceRef } from "../../src/bridge-types";
import { computeSnapshotID, sha256Text } from "../../src/snapshot";

function source(relativePath: string, content: string, selector?: string): SourceRef {
  return {
    relativePath,
    ...(selector === undefined ? {} : { selector }),
    sha256: sha256Text(content),
    bytes: Buffer.byteLength(content),
  };
}

export function makeSnapshot(): CompletedWorkSnapshot {
  const plan = "# Plan\n\n- [x] Ship bridge\n";
  const identity: Omit<CompletedWorkSnapshot, "snapshotID"> = {
    version: 1,
    projectID: sha256Text("/project"),
    workID: "work-1",
    workStartedAt: "2026-09-20T12:00:00.000Z",
    planName: "bridge",
    sessionIDs: ["opencode:session-1", "opencode:session-2"],
    completedAt: "2026-09-20T13:00:00.000Z",
    plan: {
      state: "present",
      value: { markdown: plan, total: 1, completed: 1 },
      source: source(".omo/plans/bridge.md", plan),
    },
    goals: [
      {
        state: "present",
        value: {
          id: "goal-1",
          sessionID: "opencode:session-1",
          objective: "Build the bridge",
          status: "complete",
          tokensUsed: 120,
          timeUsedSeconds: 10,
          createdAt: 1,
          updatedAt: 2,
          completedAt: 2,
        },
        source: source(".omo/goal/session-1.json", "goal-1"),
      },
      {
        state: "present",
        value: {
          id: "goal-2",
          sessionID: "opencode:session-2",
          objective: "Verify the bridge",
          status: "complete",
          tokensUsed: 80,
          timeUsedSeconds: 5,
          createdAt: 1,
          updatedAt: 2,
          completedAt: 2,
        },
        source: source(".omo/goal/session-2.json", "goal-2"),
      },
    ],
    notepads: {
      decisions: { state: "present", value: "Use immutable output.", source: source(".omo/notepads/bridge/decisions.md", "Use immutable output.") },
      learnings: { state: "present", value: "", source: source(".omo/notepads/bridge/learnings.md", "") },
      issues: { state: "missing" },
      problems: { state: "missing" },
    },
    ledger: { state: "present", value: "opaque\n", source: source(".omo/ulw-execute/ledger.jsonl", "opaque\n") },
    completion: {
      status: "completed",
      basis: "boulder-and-plan",
      boulder: source(".omo/boulder.json", "boulder", "works.work-1"),
    },
  };
  return { ...identity, snapshotID: computeSnapshotID(identity) };
}
