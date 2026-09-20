import { createHash } from "node:crypto";
import type { CompletedWorkSnapshot } from "./bridge-types";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function computeSnapshotID(
  snapshot: Omit<CompletedWorkSnapshot, "snapshotID">,
): string {
  return sha256Text(JSON.stringify(canonicalize(snapshot)));
}

export function validateCompletedWorkSnapshot(snapshot: CompletedWorkSnapshot): string[] {
  const errors: string[] = [];
  if (snapshot.version !== 1) errors.push("unsupported snapshot version");
  for (const [label, value] of [
    ["projectID", snapshot.projectID],
    ["workID", snapshot.workID],
    ["workStartedAt", snapshot.workStartedAt],
    ["planName", snapshot.planName],
  ] as const) {
    if (typeof value !== "string" || value.trim() === "") errors.push(`${label} is required`);
  }
  if (snapshot.completion?.status !== "completed") errors.push("completion status must be completed");
  if (snapshot.completion?.basis !== "boulder-and-plan") errors.push("invalid completion basis");
  if (snapshot.plan.state !== "present") {
    errors.push("completed snapshot requires plan evidence");
  } else if (snapshot.plan.value.total <= 0 || snapshot.plan.value.completed !== snapshot.plan.value.total) {
    errors.push("completed snapshot requires a non-empty complete checklist");
  }
  if (!Array.isArray(snapshot.sessionIDs) || snapshot.sessionIDs.some((id) => typeof id !== "string")) {
    errors.push("sessionIDs must be strings");
  }
  const { snapshotID: _snapshotID, ...identity } = snapshot;
  const expected = computeSnapshotID(identity);
  if (snapshot.snapshotID !== expected) errors.push("snapshotID does not match content");
  return errors;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
