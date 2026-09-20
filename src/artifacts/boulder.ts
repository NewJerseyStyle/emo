import type { ArtifactLimits, Diagnostic, SourceRef } from "../bridge-types";
import { canonicalJson, sha256Text } from "../snapshot";

const RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const SESSION_PREFIX = /^(?:opencode|codex|senpi):/;
const KNOWN_STATUSES = new Set(["active", "paused", "completed", "abandoned"]);

export interface NormalizedBoulderWork {
  readonly workID: string;
  readonly activePlan: string;
  readonly planName: string;
  readonly status: "active" | "paused" | "completed" | "abandoned";
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly sessionIDs: readonly string[];
  readonly worktreePath?: string;
  readonly source: SourceRef;
}

export type BoulderNormalizationResult =
  | { state: "supported"; works: readonly NormalizedBoulderWork[]; diagnostics: readonly Diagnostic[] }
  | { state: "unsupported"; diagnostics: readonly Diagnostic[] };

function diagnostic(code: string, message: string): Diagnostic {
  return { code, path: ".omo/boulder.json", message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validIsoString(value: unknown): value is string {
  return nonemptyString(value) && Number.isFinite(Date.parse(value));
}

export function normalizeSessionID(sessionID: string): string {
  return SESSION_PREFIX.test(sessionID) ? sessionID : `opencode:${sessionID}`;
}

export function rawSessionID(sessionID: string): string {
  return sessionID.replace(SESSION_PREFIX, "");
}

function selectedSource(source: SourceRef, selector: string, value: unknown): SourceRef {
  const canonical = canonicalJson(value);
  return {
    relativePath: source.relativePath,
    selector,
    sha256: sha256Text(canonical),
    bytes: new TextEncoder().encode(canonical).byteLength,
  };
}

function jsonPointerToken(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function normalizeSessions(
  value: unknown,
  limit: number,
): { sessions: readonly string[] } | { error: Diagnostic } {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    return { error: diagnostic("boulder.invalid_sessions", "work session associations are malformed") };
  }
  if (value.length > limit) {
    return { error: diagnostic("boulder.too_many_sessions", "work has too many associated sessions") };
  }
  return { sessions: [...new Set(value.map(normalizeSessionID))].sort() };
}

function normalizeWork(
  value: unknown,
  expectedWorkID: string,
  selector: string,
  source: SourceRef,
  limits: ArtifactLimits,
  requireWorkID: boolean,
): { work: NormalizedBoulderWork } | { error: Diagnostic } {
  if (!isRecord(value)) {
    return { error: diagnostic("boulder.invalid_work", "work record is malformed") };
  }
  if (requireWorkID && value.work_id !== expectedWorkID) {
    return { error: diagnostic("boulder.work_id_mismatch", "work map key does not match its record") };
  }
  if (
    !nonemptyString(value.active_plan)
    || !nonemptyString(value.plan_name)
    || !validIsoString(value.started_at)
    || typeof value.status !== "string"
    || !KNOWN_STATUSES.has(value.status)
  ) {
    return { error: diagnostic("boulder.invalid_work", "work record is incomplete or malformed") };
  }
  if (value.ended_at !== undefined && !validIsoString(value.ended_at)) {
    return { error: diagnostic("boulder.invalid_work", "work completion timestamp is malformed") };
  }
  if (
    value.worktree_path !== undefined
    && value.worktree_path !== null
    && typeof value.worktree_path !== "string"
  ) {
    return { error: diagnostic("boulder.invalid_work", "worktree path is malformed") };
  }

  const sessionResult = normalizeSessions(value.session_ids, limits.maxSessionsPerWork);
  if ("error" in sessionResult) return sessionResult;
  const common = {
    workID: expectedWorkID,
    activePlan: value.active_plan,
    planName: value.plan_name,
    status: value.status as NormalizedBoulderWork["status"],
    startedAt: value.started_at,
    completedAt: typeof value.ended_at === "string" ? value.ended_at : null,
    sessionIDs: sessionResult.sessions,
    source: selectedSource(source, selector, value),
  };
  return typeof value.worktree_path === "string" && value.worktree_path.trim() !== ""
    ? { work: { ...common, worktreePath: value.worktree_path } }
    : { work: common };
}

/** Normalize the selected-work portion of Boulder v2 or its legacy root mirror. */
export function normalizeBoulder(
  text: string,
  source: SourceRef,
  limits: ArtifactLimits,
): BoulderNormalizationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { state: "unsupported", diagnostics: [diagnostic("boulder.malformed_json", "Boulder state is malformed")] };
  }
  if (!isRecord(parsed)) {
    return { state: "unsupported", diagnostics: [diagnostic("boulder.malformed", "Boulder state is malformed")] };
  }

  const hasVersion = Object.hasOwn(parsed, "schema_version");
  if (hasVersion && parsed.schema_version !== 2) {
    return {
      state: "unsupported",
      diagnostics: [diagnostic("boulder.unsupported_version", "Boulder schema version is unsupported")],
    };
  }

  const diagnostics: Diagnostic[] = [];
  const works: NormalizedBoulderWork[] = [];
  if (Object.hasOwn(parsed, "works")) {
    if (!isRecord(parsed.works)) {
      return { state: "unsupported", diagnostics: [diagnostic("boulder.malformed_works", "Boulder work registry is malformed")] };
    }
    const entries = Object.entries(parsed.works);
    if (entries.length > limits.maxWorks) {
      return { state: "unsupported", diagnostics: [diagnostic("boulder.too_many_works", "Boulder work registry exceeds its item limit")] };
    }
    if (entries.some(([key]) => RESERVED_KEYS.has(key))) {
      return { state: "unsupported", diagnostics: [diagnostic("boulder.prototype_key", "Boulder work registry contains a reserved key")] };
    }
    for (const [workID, value] of entries) {
      if (!nonemptyString(workID)) {
        diagnostics.push(diagnostic("boulder.invalid_work", "work record is incomplete or malformed"));
        continue;
      }
      const result = normalizeWork(
        value,
        workID,
        `#/works/${jsonPointerToken(workID)}`,
        source,
        limits,
        true,
      );
      if ("error" in result) diagnostics.push(result.error);
      else works.push(result.work);
    }
    return { state: "supported", works, diagnostics };
  }

  if (hasVersion && parsed.schema_version !== 2) {
    return { state: "unsupported", diagnostics };
  }
  if (!nonemptyString(parsed.plan_name) || !validIsoString(parsed.started_at)) {
    return { state: "supported", works: [], diagnostics: [diagnostic("boulder.invalid_legacy", "legacy Boulder state is incomplete or malformed")] };
  }
  // Keep OMO's legacy projection identity. Snapshot/effect identity also carries
  // started_at, so separate runs of a reused plan cannot collide.
  const workID = `${parsed.plan_name}-legacy`;
  const result = normalizeWork(parsed, workID, "#", source, limits, false);
  if ("error" in result) return { state: "supported", works: [], diagnostics: [result.error] };
  return { state: "supported", works: [result.work], diagnostics: [] };
}

export function workMatchesSession(work: NormalizedBoulderWork, sessionID: string | undefined): boolean {
  return sessionID === undefined || work.sessionIDs.includes(normalizeSessionID(sessionID));
}
