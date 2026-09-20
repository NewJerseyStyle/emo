import path from "node:path";
import type {
  Artifact,
  ClosureExporter,
  CompletedWorkSnapshot,
  Diagnostic,
  EffectStatus,
  GoalEvidence,
  ProcessingOptions,
  ProcessingResult,
  SourceRef,
} from "../bridge-types";
import { assertWritableRootOutsideOmo } from "../bridge-config";
import { validateCompletedWorkSnapshot } from "../snapshot";
import { validateClosureExporterRoot } from "../export/closure";
import { executeEffectWithReceipt } from "./receipts";

const SHA256 = /^[a-f0-9]{64}$/;
const PLAN_BYTES = 512 * 1024;
const GOAL_BYTES = 64 * 1024;
const NOTEPAD_BYTES = 128 * 1024;
const LEDGER_BYTES = 256 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === "string" && Buffer.byteLength(value) <= maximum && (allowEmpty || value.trim() !== "");
}

function validSource(value: unknown): value is SourceRef {
  if (!isRecord(value)) return false;
  if (!isBoundedString(value.relativePath, 4096) || path.isAbsolute(value.relativePath)) return false;
  const segments = value.relativePath.replaceAll("\\", "/").split("/");
  if (segments.includes("..") || segments.includes("") || /[\0\r\n]/.test(value.relativePath)) return false;
  if (value.selector !== undefined && (!isBoundedString(value.selector, 4096, true) || /[\0\r\n]/.test(value.selector))) {
    return false;
  }
  return typeof value.sha256 === "string" && SHA256.test(value.sha256)
    && typeof value.bytes === "number" && Number.isSafeInteger(value.bytes) && value.bytes >= 0;
}

function validArtifact<T>(
  value: unknown,
  validateValue: (candidate: unknown) => candidate is T,
): value is Artifact<T> {
  if (!isRecord(value)) return false;
  if (value.state === "missing") return Object.keys(value).length === 1;
  return value.state === "present" && validateValue(value.value) && validSource(value.source);
}

function validGoal(value: unknown): value is GoalEvidence {
  if (!isRecord(value)) return false;
  return isBoundedString(value.id, 4096)
    && isBoundedString(value.sessionID, 4096)
    && isBoundedString(value.objective, GOAL_BYTES, true)
    && (value.status === "active" || value.status === "paused" || value.status === "complete")
    && typeof value.tokensUsed === "number" && Number.isSafeInteger(value.tokensUsed) && value.tokensUsed >= 0
    && typeof value.timeUsedSeconds === "number" && Number.isFinite(value.timeUsedSeconds) && value.timeUsedSeconds >= 0
    && typeof value.createdAt === "number" && Number.isFinite(value.createdAt) && value.createdAt >= 0
    && typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) && value.updatedAt >= 0
    && (value.completedAt === undefined
      || (typeof value.completedAt === "number" && Number.isFinite(value.completedAt) && value.completedAt >= 0));
}

function validateRuntimeSnapshot(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["snapshot must be an object"];
  if (value.version !== 1) errors.push("unsupported snapshot version");
  for (const name of ["projectID", "workID", "workStartedAt", "snapshotID", "planName"] as const) {
    if (!isBoundedString(value[name], name === "snapshotID" ? 64 : 4096)) errors.push(`${name} is invalid`);
  }
  if (typeof value.snapshotID === "string" && !SHA256.test(value.snapshotID)) errors.push("snapshotID is invalid");
  if (value.completedAt !== null && !isBoundedString(value.completedAt, 4096)) errors.push("completedAt is invalid");
  if (!Array.isArray(value.sessionIDs) || value.sessionIDs.length > 128
    || value.sessionIDs.some((item) => !isBoundedString(item, 4096))) {
    errors.push("sessionIDs are invalid");
  } else if (new Set(value.sessionIDs).size !== value.sessionIDs.length) {
    errors.push("sessionIDs contain duplicates");
  }
  const validPlanValue = (candidate: unknown): candidate is { markdown: string; total: number; completed: number } =>
    isRecord(candidate)
    && isBoundedString(candidate.markdown, PLAN_BYTES, true)
    && typeof candidate.total === "number" && Number.isSafeInteger(candidate.total) && candidate.total > 0
    && typeof candidate.completed === "number" && Number.isSafeInteger(candidate.completed)
    && candidate.completed === candidate.total;
  if (!validArtifact(value.plan, validPlanValue) || value.plan.state !== "present") errors.push("plan is invalid");
  if (!Array.isArray(value.goals) || value.goals.length > 128
    || value.goals.some((goal) => !validArtifact(goal, validGoal))) {
    errors.push("goals are invalid");
  } else if (Array.isArray(value.sessionIDs)) {
    const sessions = new Set(value.sessionIDs.filter((item): item is string => typeof item === "string"));
    if (value.goals.some((goal) => goal.state === "present" && !sessions.has(goal.value.sessionID))) {
      errors.push("goal session is not associated with the work");
    }
  }
  const notepadValue = (candidate: unknown): candidate is string => isBoundedString(candidate, NOTEPAD_BYTES, true);
  if (!isRecord(value.notepads)) {
    errors.push("notepads are invalid");
  } else {
    for (const name of ["decisions", "learnings", "issues", "problems"] as const) {
      if (!validArtifact(value.notepads[name], notepadValue)) errors.push(`${name} notepad is invalid`);
    }
  }
  const ledgerValue = (candidate: unknown): candidate is string => isBoundedString(candidate, LEDGER_BYTES, true);
  if (!validArtifact(value.ledger, ledgerValue)) errors.push("ledger is invalid");
  if (!isRecord(value.completion)
    || value.completion.status !== "completed"
    || value.completion.basis !== "boulder-and-plan"
    || !validSource(value.completion.boulder)) {
    errors.push("completion evidence is invalid");
  }
  if (errors.length === 0) {
    try {
      errors.push(...validateCompletedWorkSnapshot(value as unknown as CompletedWorkSnapshot));
    } catch {
      errors.push("snapshot validation failed");
    }
  }
  return errors;
}

function diagnostic(code: string, message: string): Diagnostic {
  return { code, message };
}

interface EffectPlan {
  status?: EffectStatus;
  adapter?: ClosureExporter | ProcessingOptions["memorySink"];
}

function memoryPlan(options: ProcessingOptions, diagnostics: Diagnostic[]): EffectPlan {
  if (!["auto", "upstream", "plugin", "off"].includes(options.memoryOwner)) {
    diagnostics.push(diagnostic("memory-owner-invalid", "memory promotion was skipped because ownership is invalid"));
    return { status: "disabled" };
  }
  if (options.memoryOwner === "off") return { status: "disabled" };
  if (options.memoryOwner === "upstream") return { status: "delegated-upstream" };
  if (options.memoryOwner === "auto") {
    if (options.upstreamMemory === "available") return { status: "delegated-upstream" };
    if (options.upstreamMemory === "unknown") {
      diagnostics.push(diagnostic(
        "memory-ownership-unknown",
        "memory promotion was skipped because upstream capability is unknown",
      ));
      return { status: "disabled" };
    }
  }
  if (options.memoryOwner === "auto" && options.upstreamMemory !== "unavailable") {
      diagnostics.push(diagnostic("memory-capability-invalid", "memory promotion was skipped because capability is invalid"));
      return { status: "disabled" };
  }
  if (options.memorySink === undefined) {
    diagnostics.push(diagnostic(
      "memory-sink-missing",
      "plugin memory promotion requires an injected idempotent sink",
    ));
    return { status: "disabled" };
  }
  return { adapter: options.memorySink };
}

async function runMemory(
  snapshot: CompletedWorkSnapshot,
  options: ProcessingOptions,
  diagnostics: Diagnostic[],
): Promise<EffectStatus> {
  const plan = memoryPlan(options, diagnostics);
  if (plan.status !== undefined) return plan.status;
  const sink = plan.adapter as NonNullable<ProcessingOptions["memorySink"]>;
  try {
    return await executeEffectWithReceipt({
      projectRoot: options.projectRoot,
      receiptRoot: options.receiptRoot,
      snapshot,
      effect: "memory",
      adapterID: sink.id,
      ...(options.lockTimeoutMs === undefined ? {} : { lockTimeoutMs: options.lockTimeoutMs }),
      ...(options.lockLeaseMs === undefined ? {} : { lockLeaseMs: options.lockLeaseMs }),
    }, async (idempotencyKey) => sink.promote(snapshot, { idempotencyKey }));
  } catch {
    diagnostics.push(diagnostic("memory-effect-failed", "memory promotion failed and remains retryable"));
    return "failed";
  }
}

async function runClosure(
  snapshot: CompletedWorkSnapshot,
  options: ProcessingOptions,
  diagnostics: Diagnostic[],
): Promise<EffectStatus> {
  const exporter = options.closureExporter;
  if (exporter === undefined) return "disabled";
  try {
    validateClosureExporterRoot(exporter, options.projectRoot);
  } catch {
    diagnostics.push(diagnostic("closure-root-invalid", "closure output root is not an allowed writable boundary"));
    return "failed";
  }
  try {
    return await executeEffectWithReceipt({
      projectRoot: options.projectRoot,
      receiptRoot: options.receiptRoot,
      snapshot,
      effect: "closure",
      adapterID: exporter.id,
      ...(options.lockTimeoutMs === undefined ? {} : { lockTimeoutMs: options.lockTimeoutMs }),
      ...(options.lockLeaseMs === undefined ? {} : { lockLeaseMs: options.lockLeaseMs }),
    }, async (idempotencyKey) => {
      const result = await exporter.export(snapshot, { idempotencyKey });
      if (!isBoundedString(result.path, 32 * 1024) || !SHA256.test(result.sha256)) {
        throw new Error("closure exporter returned an invalid publication result");
      }
    });
  } catch {
    diagnostics.push(diagnostic("closure-effect-failed", "closure export failed and remains retryable"));
    return "failed";
  }
}

/** Validate and independently process memory promotion and closure export. */
export async function processCompletedWork(
  snapshot: CompletedWorkSnapshot,
  options: ProcessingOptions,
): Promise<ProcessingResult> {
  const diagnostics: Diagnostic[] = [];
  const closureDisabled = options.closureExporter === undefined;
  const errors = validateRuntimeSnapshot(snapshot);
  if (errors.length !== 0) {
    const memory = memoryPlan(options, diagnostics);
    diagnostics.push(diagnostic("snapshot-invalid", "completed-work snapshot failed public validation"));
    return {
      snapshotID: isRecord(snapshot) && typeof snapshot.snapshotID === "string" ? snapshot.snapshotID : "invalid",
      memory: memory.status ?? "failed",
      closure: closureDisabled ? "disabled" : "failed",
      diagnostics,
    };
  }

  if (closureDisabled) {
    const noEffectDiagnostics: Diagnostic[] = [];
    const noEffectMemory = memoryPlan(options, noEffectDiagnostics);
    if (noEffectMemory.status !== undefined) {
      diagnostics.push(...noEffectDiagnostics);
      return {
        snapshotID: snapshot.snapshotID,
        memory: noEffectMemory.status,
        closure: "disabled",
        diagnostics,
      };
    }
  }
  try {
    assertWritableRootOutsideOmo(options.projectRoot, options.receiptRoot);
  } catch {
    const memory = memoryPlan(options, diagnostics);
    diagnostics.push(diagnostic("receipt-root-invalid", "receipt root is not an allowed writable boundary"));
    return {
      snapshotID: snapshot.snapshotID,
      memory: memory.status ?? "failed",
      closure: closureDisabled ? "disabled" : "failed",
      diagnostics,
    };
  }

  // Effects share no success state: one can be retried without replaying the other.
  const memoryDiagnostics: Diagnostic[] = [];
  const closureDiagnostics: Diagnostic[] = [];
  const [memoryStatus, closureStatus] = await Promise.all([
    runMemory(snapshot, options, memoryDiagnostics),
    runClosure(snapshot, options, closureDiagnostics),
  ]);
  diagnostics.push(...memoryDiagnostics, ...closureDiagnostics);
  return {
    snapshotID: snapshot.snapshotID,
    memory: memoryStatus,
    closure: closureStatus,
    diagnostics,
  };
}
