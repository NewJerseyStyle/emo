import { describe, expect, test } from "bun:test";
import { DEFAULT_ARTIFACT_LIMITS } from "../../src/bridge-config";
import type { SourceRef } from "../../src/bridge-types";
import { normalizeBoulder, normalizeSessionID, workMatchesSession } from "../../src/artifacts/boulder";

const source: SourceRef = {
  relativePath: ".omo/boulder.json",
  sha256: "a".repeat(64),
  bytes: 1,
};

function work(overrides: Record<string, unknown> = {}) {
  return {
    work_id: "w1",
    active_plan: ".omo/plans/one.md",
    plan_name: "one",
    status: "completed",
    started_at: "2026-09-20T00:00:00.000Z",
    session_ids: ["session-a", "codex:session-b", "senpi:session-c"],
    ...overrides,
  };
}

describe("normalizeBoulder", () => {
  test("uses v2 works authoritatively and ignores the root mirror", () => {
    const result = normalizeBoulder(JSON.stringify({
      schema_version: 2,
      works: { w1: work({ worktree_path: null }) },
      active_plan: ".omo/plans/mirror.md",
      plan_name: "mirror",
      status: "completed",
      started_at: "2026-09-19T00:00:00.000Z",
      session_ids: ["mirror-session"],
    }), source, DEFAULT_ARTIFACT_LIMITS);

    expect(result.state).toBe("supported");
    if (result.state !== "supported") return;
    expect(result.works).toHaveLength(1);
    expect(result.works[0]?.planName).toBe("one");
    expect(result.works[0]?.sessionIDs).toEqual([
      "codex:session-b",
      "opencode:session-a",
      "senpi:session-c",
    ]);
    expect(result.works[0]?.source.selector).toBe("#/works/w1");
    expect(result.works[0]?.worktreePath).toBeUndefined();
  });

  test("normalizes legacy identity compatibly while start time remains separate", () => {
    const result = normalizeBoulder(JSON.stringify({
      active_plan: ".omo/plans/reused.md",
      plan_name: "reused",
      status: "completed",
      started_at: "2026-09-20T01:00:00.000Z",
      session_ids: ["s1"],
    }), source, DEFAULT_ARTIFACT_LIMITS);
    expect(result.state).toBe("supported");
    if (result.state !== "supported") return;
    expect(result.works[0]?.workID).toBe("reused-legacy");
    expect(result.works[0]?.startedAt).toBe("2026-09-20T01:00:00.000Z");
    expect(result.works[0]?.source.selector).toBe("#");
  });

  test("skips mismatched work map entries", () => {
    const result = normalizeBoulder(JSON.stringify({
      schema_version: 2,
      works: { w1: work({ work_id: "other" }) },
    }), source, DEFAULT_ARTIFACT_LIMITS);
    expect(result.state).toBe("supported");
    if (result.state !== "supported") return;
    expect(result.works).toEqual([]);
    expect(result.diagnostics.map((item) => item.code)).toContain("boulder.work_id_mismatch");
  });

  test("rejects unknown schema versions and prototype keys", () => {
    expect(normalizeBoulder('{"schema_version":3}', source, DEFAULT_ARTIFACT_LIMITS).state).toBe("unsupported");
    const missingWorks = normalizeBoulder(
      JSON.stringify({
        schema_version: 2,
        active_plan: ".omo/plans/p.md",
        plan_name: "p",
        status: "completed",
        started_at: "2026-09-20T00:00:00.000Z",
        session_ids: ["s1"],
      }),
      source,
      DEFAULT_ARTIFACT_LIMITS,
    );
    expect(missingWorks.state).toBe("unsupported");
    const polluted = normalizeBoulder(
      '{"schema_version":2,"works":{"__proto__":{"work_id":"__proto__"}}}',
      source,
      DEFAULT_ARTIFACT_LIMITS,
    );
    expect(polluted.state).toBe("unsupported");
  });
});

describe("session matching", () => {
  test("normalizes bare IDs to OpenCode while preserving known harnesses", () => {
    expect(normalizeSessionID("s1")).toBe("opencode:s1");
    expect(normalizeSessionID("codex:s1")).toBe("codex:s1");
  });

  test("matches only associated normalized sessions", () => {
    const result = normalizeBoulder(JSON.stringify({ schema_version: 2, works: { w1: work() } }), source, DEFAULT_ARTIFACT_LIMITS);
    if (result.state !== "supported" || result.works[0] === undefined) throw new Error("fixture failed");
    expect(workMatchesSession(result.works[0], "session-a")).toBe(true);
    expect(workMatchesSession(result.works[0], "session-b")).toBe(false);
    expect(workMatchesSession(result.works[0], "codex:session-b")).toBe(true);
  });
});
