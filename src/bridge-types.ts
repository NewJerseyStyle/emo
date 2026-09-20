export type MemoryOwner = "auto" | "upstream" | "plugin" | "off";
export type MemoryCapability = "available" | "unavailable" | "unknown";

export interface SourceRef {
  relativePath: string;
  selector?: string;
  sha256: string;
  bytes: number;
}

export type Artifact<T> =
  | { state: "missing" }
  | { state: "present"; value: T; source: SourceRef };

export interface GoalEvidence {
  id: string;
  sessionID: string;
  objective: string;
  status: "active" | "paused" | "complete";
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface PlanEvidence {
  markdown: string;
  total: number;
  completed: number;
}

export interface CompletedWorkSnapshot {
  version: 1;
  projectID: string;
  workID: string;
  workStartedAt: string;
  snapshotID: string;
  planName: string;
  sessionIDs: readonly string[];
  completedAt: string | null;
  plan: Artifact<PlanEvidence>;
  goals: readonly Artifact<GoalEvidence>[];
  notepads: {
    decisions: Artifact<string>;
    learnings: Artifact<string>;
    issues: Artifact<string>;
    problems: Artifact<string>;
  };
  ledger: Artifact<string>;
  completion: {
    status: "completed";
    basis: "boulder-and-plan";
    boulder: SourceRef;
  };
}

export interface Diagnostic {
  code: string;
  path?: string;
  message: string;
}

export interface ArtifactLimits {
  boulderBytes: number;
  planBytes: number;
  goalBytes: number;
  notepadBytes: number;
  ledgerBytes: number;
  aggregateBytes: number;
  maxWorks: number;
  maxSessionsPerWork: number;
}

export interface DiscoveryOptions {
  projectRoot: string;
  sessionID?: string;
  allowedWorktreeRoots?: readonly string[];
  limits?: Partial<ArtifactLimits>;
}

export interface DiscoveryResult {
  presence: "absent" | "present" | "unsupported";
  snapshots: readonly CompletedWorkSnapshot[];
  diagnostics: readonly Diagnostic[];
}

export interface MemorySink {
  id: string;
  promote(
    snapshot: CompletedWorkSnapshot,
    context: { idempotencyKey: string },
  ): Promise<void>;
}

export interface ClosureExporter {
  id: string;
  export(
    snapshot: CompletedWorkSnapshot,
    context: { idempotencyKey: string; projectRoot: string },
  ): Promise<{ path: string; sha256: string }>;
}

export type EffectStatus =
  | "disabled"
  | "delegated-upstream"
  | "written"
  | "already-written"
  | "deferred"
  | "failed";

export interface ProcessingOptions {
  projectRoot: string;
  memoryOwner: MemoryOwner;
  upstreamMemory: MemoryCapability;
  memorySink?: MemorySink;
  closureExporter?: ClosureExporter;
  receiptRoot: string;
  lockTimeoutMs?: number;
  lockLeaseMs?: number;
}

export interface ProcessingResult {
  snapshotID: string;
  memory: EffectStatus;
  closure: EffectStatus;
  diagnostics: readonly Diagnostic[];
}

export interface BridgeDependencies {
  memorySink?: MemorySink;
}
