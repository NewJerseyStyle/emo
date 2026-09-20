import path from "node:path";
import type {
  Artifact,
  ArtifactLimits,
  CompletedWorkSnapshot,
  Diagnostic,
  DiscoveryOptions,
  DiscoveryResult,
  GoalEvidence,
  SourceRef,
} from "../bridge-types";
import { DEFAULT_ARTIFACT_LIMITS } from "../bridge-config";
import { computeSnapshotID, sha256Text } from "../snapshot";
import {
  normalizeBoulder,
  rawSessionID,
  type NormalizedBoulderWork,
  workMatchesSession,
} from "./boulder";
import { parsePlanChecklist } from "./checklist";
import {
  createReadBudget,
  readBoundedText,
  resolveAllowedRoots,
  type AllowedRoot,
  type BoundedReadResult,
  type ReadBudget,
} from "./read";

const NOTE_NAMES = ["decisions", "learnings", "issues", "problems"] as const;
type NoteName = typeof NOTE_NAMES[number];

function mergedLimits(input: Partial<ArtifactLimits> | undefined): ArtifactLimits {
  const limits = { ...DEFAULT_ARTIFACT_LIMITS, ...input };
  for (const key of Object.keys(limits) as (keyof ArtifactLimits)[]) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0) {
      limits[key] = DEFAULT_ARTIFACT_LIMITS[key];
    }
  }
  return limits;
}

function diagnostic(code: string, pathValue: string, message: string): Diagnostic {
  return { code, path: pathValue, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasTraversal(value: string): boolean {
  return value.split(/[\\/]+/).includes("..");
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sourcePath(root: string, candidate: string): string {
  return path.relative(root, candidate).split(path.sep).join("/") || ".";
}

function present<T>(value: T, source: SourceRef): Artifact<T> {
  return { state: "present", value, source };
}

const MISSING = { state: "missing" } as const;

function goalEvidence(
  value: unknown,
  rawSession: string,
  normalizedSession: string,
): GoalEvidence | null {
  if (!isRecord(value)) return null;
  const numericKeys = ["tokensUsed", "timeUsedSeconds", "createdAt", "updatedAt"] as const;
  if (
    typeof value.id !== "string"
    || value.sessionID !== rawSession
    || typeof value.objective !== "string"
    || value.objective.trim().length === 0
    || value.objective.length > 2000
    || (value.status !== "active" && value.status !== "paused" && value.status !== "complete")
    || numericKeys.some((key) => (
      typeof value[key] !== "number"
      || !Number.isFinite(value[key])
      || value[key] < 0
    ))
    || (
      value.completedAt !== undefined
      && (
        typeof value.completedAt !== "number"
        || !Number.isFinite(value.completedAt)
        || value.completedAt < 0
      )
    )
  ) return null;

  const common: GoalEvidence = {
    id: value.id,
    sessionID: normalizedSession,
    objective: value.objective,
    status: value.status,
    tokensUsed: value.tokensUsed as number,
    timeUsedSeconds: value.timeUsedSeconds as number,
    createdAt: value.createdAt as number,
    updatedAt: value.updatedAt as number,
  };
  return typeof value.completedAt === "number"
    ? { ...common, completedAt: value.completedAt }
    : common;
}

function deduplicateDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const result: Diagnostic[] = [];
  for (const item of diagnostics) {
    const key = `${item.code}\0${item.path ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

function worktreeRoot(
  work: NormalizedBoulderWork,
  projectRoot: string,
  explicitRoots: readonly AllowedRoot[],
): string | null {
  if (work.worktreePath === undefined) return projectRoot;
  if (hasTraversal(work.worktreePath)) return null;
  const candidate = path.resolve(projectRoot, work.worktreePath);
  const authorized = explicitRoots.find((root) => (
    isWithin(root.lexical, candidate) || isWithin(root.canonical, candidate)
  ));
  return authorized === undefined ? null : candidate;
}

function planCandidates(
  work: NormalizedBoulderWork,
  projectRoot: string,
  explicitRoots: readonly AllowedRoot[],
): readonly string[] | null {
  if (hasTraversal(work.activePlan)) return null;
  const projectCandidate = path.resolve(projectRoot, work.activePlan);
  if (work.worktreePath === undefined) return [projectCandidate];

  const base = worktreeRoot(work, projectRoot, explicitRoots);
  if (base === null) return null;
  const relativePlan = path.relative(projectRoot, projectCandidate);
  if (
    relativePlan === ""
    || relativePlan.startsWith("..")
    || path.isAbsolute(relativePlan)
  ) return [projectCandidate];

  const worktreeCandidate = path.resolve(base, relativePlan);
  return worktreeCandidate === projectCandidate
    ? [projectCandidate]
    : [worktreeCandidate, projectCandidate];
}

interface DiscoveryContext {
  readonly projectRoot: string;
  readonly roots: readonly AllowedRoot[];
  readonly explicitRoots: readonly AllowedRoot[];
  readonly limits: ArtifactLimits;
  readonly budget: ReadBudget;
  readonly diagnostics: Diagnostic[];
  readonly cache: Map<string, Promise<BoundedReadResult>>;
}

function addRejected(
  context: DiscoveryContext,
  result: BoundedReadResult,
): result is Extract<BoundedReadResult, { state: "rejected" }> {
  if (result.state !== "rejected") return false;
  context.diagnostics.push(result.diagnostic);
  return true;
}

function cachedRead(
  context: DiscoveryContext,
  candidatePath: string,
  displayPath: string,
  maxBytes: number,
  explicitSourcePath?: string,
): Promise<BoundedReadResult> {
  const key = `${path.resolve(candidatePath)}\0${maxBytes}\0${explicitSourcePath ?? ""}`;
  let result = context.cache.get(key);
  if (result === undefined) {
    result = readBoundedText({
      candidatePath,
      displayPath,
      ...(explicitSourcePath === undefined ? {} : { sourcePath: explicitSourcePath }),
      allowedRoots: context.roots,
      maxBytes,
      budget: context.budget,
    });
    context.cache.set(key, result);
  }
  return result;
}

async function readGoal(
  context: DiscoveryContext,
  normalizedSession: string,
): Promise<Artifact<GoalEvidence> | null> {
  const rawSession = rawSessionID(normalizedSession);
  const candidate = path.join(
    context.projectRoot,
    ".omo",
    "goal",
    `${encodeURIComponent(rawSession)}.json`,
  );
  const result = await cachedRead(
    context,
    candidate,
    ".omo/goal/<session>.json",
    context.limits.goalBytes,
    sourcePath(context.projectRoot, candidate),
  );
  if (result.state === "missing") return MISSING;
  if (addRejected(context, result)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text) as unknown;
  } catch {
    context.diagnostics.push(diagnostic("goal.malformed_json", ".omo/goal/<session>.json", "goal evidence is malformed"));
    return null;
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !("goal" in parsed)) {
    context.diagnostics.push(diagnostic("goal.unsupported", ".omo/goal/<session>.json", "goal evidence is unsupported or malformed"));
    return null;
  }
  if (parsed.goal === null) return MISSING;
  const value = goalEvidence(parsed.goal, rawSession, normalizedSession);
  if (value === null) {
    context.diagnostics.push(diagnostic("goal.invalid", ".omo/goal/<session>.json", "goal evidence is invalid"));
    return null;
  }
  return present(value, result.source);
}

async function readNote(
  context: DiscoveryContext,
  work: NormalizedBoulderWork,
  name: NoteName,
): Promise<Artifact<string> | null> {
  if (hasTraversal(work.planName)) {
    context.diagnostics.push(diagnostic("notepad.unsafe_plan_name", `.omo/notepads/<plan>/${name}.md`, "notepad plan name is unsafe"));
    return null;
  }
  const candidate = path.resolve(context.projectRoot, ".omo", "notepads", work.planName, `${name}.md`);
  const result = await cachedRead(
    context,
    candidate,
    `.omo/notepads/<plan>/${name}.md`,
    context.limits.notepadBytes,
    sourcePath(context.projectRoot, candidate),
  );
  if (result.state === "missing") return MISSING;
  if (addRejected(context, result)) return null;
  return present(result.text, result.source);
}

async function readLedger(context: DiscoveryContext): Promise<Artifact<string> | null> {
  const candidate = path.join(context.projectRoot, ".omo", "ulw-execute", "ledger.jsonl");
  const result = await cachedRead(
    context,
    candidate,
    ".omo/ulw-execute/ledger.jsonl",
    context.limits.ledgerBytes,
    ".omo/ulw-execute/ledger.jsonl",
  );
  if (result.state === "missing") return MISSING;
  if (addRejected(context, result)) return null;
  return present(result.text, result.source);
}

async function snapshotForWork(
  context: DiscoveryContext,
  projectID: string,
  work: NormalizedBoulderWork,
  ledger: Artifact<string>,
): Promise<CompletedWorkSnapshot | null> {
  const candidates = planCandidates(work, context.projectRoot, context.explicitRoots);
  if (candidates === null) {
    context.diagnostics.push(diagnostic("plan.unsafe_path", "active_plan", "plan path is unsafe or its worktree is not authorized"));
    return null;
  }
  let planResult: Extract<BoundedReadResult, { state: "present" }> | undefined;
  for (const candidate of candidates) {
    const result = await cachedRead(context, candidate, "active_plan", context.limits.planBytes);
    if (result.state === "missing") continue;
    if (addRejected(context, result)) return null;
    planResult = result;
    break;
  }
  if (planResult === undefined) {
    context.diagnostics.push(diagnostic("plan.missing", "active_plan", "completed work plan is missing"));
    return null;
  }

  const plan = parsePlanChecklist(planResult.text);
  if (plan.total <= 0 || plan.completed !== plan.total) return null;

  const goals: Artifact<GoalEvidence>[] = [];
  for (const sessionID of work.sessionIDs) {
    const goal = await readGoal(context, sessionID);
    if (goal === null) return null;
    goals.push(goal);
  }

  const notes = {} as Record<NoteName, Artifact<string>>;
  for (const name of NOTE_NAMES) {
    const note = await readNote(context, work, name);
    if (note === null) return null;
    notes[name] = note;
  }

  const identity: Omit<CompletedWorkSnapshot, "snapshotID"> = {
    version: 1,
    projectID,
    workID: work.workID,
    workStartedAt: work.startedAt,
    planName: work.planName,
    sessionIDs: work.sessionIDs,
    completedAt: work.completedAt,
    plan: present(plan, planResult.source),
    goals,
    notepads: {
      decisions: notes.decisions,
      learnings: notes.learnings,
      issues: notes.issues,
      problems: notes.problems,
    },
    ledger,
    completion: {
      status: "completed",
      basis: "boulder-and-plan",
      boulder: work.source,
    },
  };
  return { ...identity, snapshotID: computeSnapshotID(identity) };
}

/** Discover strictly completed OMO work without mutating OMO or project state. */
export async function discoverCompletedWork(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const projectRoot = path.resolve(options.projectRoot);
  const limits = mergedLimits(options.limits);
  const projectRoots = await resolveAllowedRoots(projectRoot, []);
  if (projectRoots.length === 0) {
    return {
      presence: "absent",
      snapshots: [],
      diagnostics: [diagnostic("project.missing", ".", "project root is unavailable")],
    };
  }
  const explicitRoots = (
    await Promise.all((options.allowedWorktreeRoots ?? []).map(async (root) => (
      resolveAllowedRoots(path.resolve(projectRoot, root), [])
    )))
  ).flat();
  const roots = await resolveAllowedRoots(
    projectRoot,
    explicitRoots.map((root) => root.lexical),
  );
  const context: DiscoveryContext = {
    projectRoot,
    roots,
    explicitRoots,
    limits,
    budget: createReadBudget(limits.aggregateBytes),
    diagnostics: [],
    cache: new Map(),
  };

  const boulderPath = path.join(projectRoot, ".omo", "boulder.json");
  const boulderResult = await readBoundedText({
    candidatePath: boulderPath,
    displayPath: ".omo/boulder.json",
    sourcePath: ".omo/boulder.json",
    allowedRoots: projectRoots,
    maxBytes: limits.boulderBytes,
    budget: context.budget,
  });
  if (boulderResult.state === "missing") {
    return { presence: "absent", snapshots: [], diagnostics: [] };
  }
  if (boulderResult.state === "rejected") {
    return { presence: "unsupported", snapshots: [], diagnostics: [boulderResult.diagnostic] };
  }

  const boulder = normalizeBoulder(boulderResult.text, boulderResult.source, limits);
  context.diagnostics.push(...boulder.diagnostics);
  if (boulder.state === "unsupported") {
    return {
      presence: "unsupported",
      snapshots: [],
      diagnostics: deduplicateDiagnostics(context.diagnostics),
    };
  }

  const candidates = boulder.works
    .filter((work) => work.status === "completed" && workMatchesSession(work, options.sessionID))
    .sort((left, right) => (
      left.workID.localeCompare(right.workID) || left.startedAt.localeCompare(right.startedAt)
    ));
  if (candidates.length === 0) {
    return {
      presence: "present",
      snapshots: [],
      diagnostics: deduplicateDiagnostics(context.diagnostics),
    };
  }

  const ledger = await readLedger(context);
  if (ledger === null) {
    return {
      presence: "present",
      snapshots: [],
      diagnostics: deduplicateDiagnostics(context.diagnostics),
    };
  }

  const projectID = sha256Text(projectRoots[0]?.canonical ?? projectRoot);
  const snapshots: CompletedWorkSnapshot[] = [];
  for (const work of candidates) {
    const snapshot = await snapshotForWork(context, projectID, work, ledger);
    if (snapshot !== null) snapshots.push(snapshot);
  }
  return {
    presence: "present",
    snapshots,
    diagnostics: deduplicateDiagnostics(context.diagnostics),
  };
}
