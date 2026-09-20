import fs from "node:fs";
import path from "node:path";
import type { ArtifactLimits, MemoryCapability, MemoryOwner } from "./bridge-types";

export interface BridgeConfig {
  enabled: boolean;
  memoryOwner: MemoryOwner;
  upstreamMemory: MemoryCapability;
  closureEnabled: boolean;
  closureRoot: string;
  stateRoot: string;
  allowedWorktreeRoots: readonly string[];
  limits: ArtifactLimits;
  lockTimeoutMs: number;
  lockLeaseMs: number;
}

export const DEFAULT_ARTIFACT_LIMITS: ArtifactLimits = {
  boulderBytes: 256 * 1024,
  planBytes: 512 * 1024,
  goalBytes: 64 * 1024,
  notepadBytes: 128 * 1024,
  ledgerBytes: 256 * 1024,
  aggregateBytes: 4 * 1024 * 1024,
  maxWorks: 128,
  maxSessionsPerWork: 128,
};

const MEMORY_OWNERS = new Set<MemoryOwner>(["auto", "upstream", "plugin", "off"]);
const MEMORY_CAPABILITIES = new Set<MemoryCapability>(["available", "unavailable", "unknown"]);

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function resolveBridgeConfig(
  projectRoot: string,
  options: Record<string, unknown> | undefined,
): BridgeConfig {
  const raw = options ?? {};
  const memoryOwner = MEMORY_OWNERS.has(raw.memoryOwner as MemoryOwner)
    ? raw.memoryOwner as MemoryOwner
    : "auto";
  const upstreamMemory = MEMORY_CAPABILITIES.has(raw.upstreamMemory as MemoryCapability)
    ? raw.upstreamMemory as MemoryCapability
    : "unknown";
  const limitInput = typeof raw.limits === "object" && raw.limits !== null
    ? raw.limits as Record<string, unknown>
    : {};
  const limits: ArtifactLimits = {
    boulderBytes: positiveInteger(limitInput.boulderBytes, DEFAULT_ARTIFACT_LIMITS.boulderBytes),
    planBytes: positiveInteger(limitInput.planBytes, DEFAULT_ARTIFACT_LIMITS.planBytes),
    goalBytes: positiveInteger(limitInput.goalBytes, DEFAULT_ARTIFACT_LIMITS.goalBytes),
    notepadBytes: positiveInteger(limitInput.notepadBytes, DEFAULT_ARTIFACT_LIMITS.notepadBytes),
    ledgerBytes: positiveInteger(limitInput.ledgerBytes, DEFAULT_ARTIFACT_LIMITS.ledgerBytes),
    aggregateBytes: positiveInteger(limitInput.aggregateBytes, DEFAULT_ARTIFACT_LIMITS.aggregateBytes),
    maxWorks: positiveInteger(limitInput.maxWorks, DEFAULT_ARTIFACT_LIMITS.maxWorks),
    maxSessionsPerWork: positiveInteger(
      limitInput.maxSessionsPerWork,
      DEFAULT_ARTIFACT_LIMITS.maxSessionsPerWork,
    ),
  };

  return {
    enabled: raw.enabled !== false,
    memoryOwner,
    upstreamMemory,
    closureEnabled: raw.closureEnabled === true,
    closureRoot: path.resolve(
      projectRoot,
      typeof raw.closureRoot === "string" ? raw.closureRoot : ".emo/closures",
    ),
    stateRoot: path.resolve(
      projectRoot,
      typeof raw.stateRoot === "string" ? raw.stateRoot : ".emo/state",
    ),
    allowedWorktreeRoots: stringArray(raw.allowedWorktreeRoots).map((root) => path.resolve(projectRoot, root)),
    limits,
    lockTimeoutMs: positiveInteger(raw.lockTimeoutMs, 250),
    lockLeaseMs: positiveInteger(raw.lockLeaseMs, 30_000),
  };
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function canonicalPotential(candidate: string): string {
  let current = path.resolve(candidate);
  const suffix: string[] = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    suffix.unshift(path.basename(current));
    current = parent;
  }
  const canonicalBase = fs.existsSync(current) ? fs.realpathSync(current) : current;
  return path.resolve(canonicalBase, ...suffix);
}

export function assertWritableRootOutsideOmo(projectRoot: string, candidate: string): void {
  const protectedLexical = path.resolve(projectRoot, ".omo");
  const candidateLexical = path.resolve(candidate);
  if (isWithin(protectedLexical, candidateLexical)) {
    throw new Error("writable root must be outside the protected .omo tree");
  }
  const protectedCanonical = canonicalPotential(protectedLexical);
  const candidateCanonical = canonicalPotential(candidateLexical);
  if (isWithin(protectedCanonical, candidateCanonical)) {
    throw new Error("writable root resolves inside the protected .omo tree");
  }
}
