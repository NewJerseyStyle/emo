import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ClosureExporter, CompletedWorkSnapshot } from "../bridge-types";
import { assertWritableRootOutsideOmo } from "../bridge-config";
import { sha256Text } from "../snapshot";

export interface ClosurePublicationHooks {
  beforeLink?(): void;
  afterLink?(): void;
}

export interface ClosureExporterOptions {
  root: string;
  /** Optional eager boundary check. Processing also checks against its project root. */
  projectRoot?: string;
  /** Test-only fault boundary hooks. */
  publicationHooks?: ClosurePublicationHooks;
}

interface BuiltinClosureExporter extends ClosureExporter {
  readonly closureRoot: string;
  validateRoot(projectRoot: string): void;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function renderArtifact(label: string, artifact: CompletedWorkSnapshot["notepads"]["decisions"]): string[] {
  if (artifact.state === "missing") return [`## ${label}`, "", "Not recorded."];
  return [
    `## ${label}`,
    "",
    artifact.value === "" ? "Present, but empty." : artifact.value,
    "",
    `Source: \`${artifact.source.relativePath}\` (${artifact.source.bytes} bytes, SHA-256 \`${artifact.source.sha256}\`)`,
  ];
}

/** Deterministic, snapshot-only Markdown. It never estimates savings or invents usage. */
export function renderClosure(snapshot: CompletedWorkSnapshot): string {
  const measuredGoals = snapshot.goals.filter(
    (goal): goal is Extract<(typeof snapshot.goals)[number], { state: "present" }> => goal.state === "present",
  );
  const sessions = snapshot.sessionIDs.length === 0
    ? "- None recorded"
    : snapshot.sessionIDs.map((sessionID) => `- \`${sessionID}\``).join("\n");
  const goals = measuredGoals.length === 0
    ? "No associated goal evidence was recorded."
    : measuredGoals.map((goal) => [
      `### ${goal.value.id}`,
      "",
      `- Session: \`${goal.value.sessionID}\``,
      `- Status: ${goal.value.status}`,
      `- Tokens used: ${goal.value.tokensUsed}`,
      `- Time used: ${goal.value.timeUsedSeconds} seconds`,
      "",
      goal.value.objective,
      "",
      `Source: \`${goal.source.relativePath}\` (${goal.source.bytes} bytes, SHA-256 \`${goal.source.sha256}\`)`,
    ].join("\n")).join("\n\n");
  const plan = snapshot.plan.state === "present" ? snapshot.plan.value : undefined;
  const planSection = plan === undefined
    ? "Plan evidence is missing."
    : [
      `Checklist: ${plan.completed}/${plan.total} complete`,
      "",
      plan.markdown,
      "",
      `Source: \`${snapshot.plan.state === "present" ? snapshot.plan.source.relativePath : ""}\` (${snapshot.plan.state === "present" ? snapshot.plan.source.bytes : 0} bytes, SHA-256 \`${snapshot.plan.state === "present" ? snapshot.plan.source.sha256 : ""}\`)`,
    ].join("\n");
  const ledger = snapshot.ledger.state === "missing"
    ? "Not recorded."
    : [
      snapshot.ledger.value === "" ? "Present, but empty." : snapshot.ledger.value,
      "",
      `Source: \`${snapshot.ledger.source.relativePath}\` (${snapshot.ledger.source.bytes} bytes, SHA-256 \`${snapshot.ledger.source.sha256}\`)`,
    ].join("\n");

  return [
    "---",
    "format: emo-completed-work/v1",
    `project_id: ${yamlString(snapshot.projectID)}`,
    `work_id: ${yamlString(snapshot.workID)}`,
    `work_started_at: ${yamlString(snapshot.workStartedAt)}`,
    `snapshot_id: ${yamlString(snapshot.snapshotID)}`,
    "completion_basis: boulder-and-plan",
    `completed_at: ${snapshot.completedAt === null ? "null" : yamlString(snapshot.completedAt)}`,
    "---",
    "",
    `# Completed work: ${snapshot.planName}`,
    "",
    "This report is a deterministic rendering of normalized completed-work evidence.",
    "",
    "## Completion",
    "",
    `- Status: ${snapshot.completion.status}`,
    `- Basis: ${snapshot.completion.basis}`,
    `- Boulder source: \`${snapshot.completion.boulder.relativePath}\`${snapshot.completion.boulder.selector === undefined ? "" : ` (${snapshot.completion.boulder.selector})`}`,
    `- Boulder digest: SHA-256 \`${snapshot.completion.boulder.sha256}\``,
    "",
    "## Scoped usage",
    "",
    "- Tokens used: not measured",
    "- Time used: not measured",
    "",
    "No token-savings measurement is asserted by this report.",
    "",
    "## Associated sessions",
    "",
    sessions,
    "",
    "## Goal evidence",
    "",
    goals,
    "",
    "## Plan evidence",
    "",
    planSection,
    "",
    ...renderArtifact("Decisions", snapshot.notepads.decisions),
    "",
    ...renderArtifact("Learnings", snapshot.notepads.learnings),
    "",
    ...renderArtifact("Issues", snapshot.notepads.issues),
    "",
    ...renderArtifact("Problems", snapshot.notepads.problems),
    "",
    "## Opaque execution ledger",
    "",
    ledger,
    "",
  ].join("\n");
}

function digestPath(snapshot: CompletedWorkSnapshot): string[] {
  return [
    sha256Text(snapshot.projectID),
    `${sha256Text(snapshot.workID)}-${sha256Text(snapshot.workStartedAt)}`,
    `${snapshot.snapshotID}.md`,
  ];
}

function compareExisting(finalPath: string, expected: Buffer, expectedDigest: string): void {
  const stat = fs.lstatSync(finalPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expected.byteLength) {
    throw new Error("closure path already exists with conflicting content");
  }
  const actual = fs.readFileSync(finalPath);
  if (sha256Text(actual.toString("utf8")) !== expectedDigest || !actual.equals(expected)) {
    throw new Error("closure path already exists with conflicting content");
  }
}

function publishNoReplace(
  finalPath: string,
  bytes: Buffer,
  digest: string,
  hooks: ClosurePublicationHooks | undefined,
): void {
  const directory = path.dirname(finalPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const tempPath = path.join(
    directory,
    `.${path.basename(finalPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let fd: number | undefined;
  try {
    fd = fs.openSync(tempPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    hooks?.beforeLink?.();
    try {
      fs.linkSync(tempPath, finalPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      compareExisting(finalPath, bytes, digest);
      return;
    }
    hooks?.afterLink?.();
    const directoryFd = fs.openSync(directory, fs.constants.O_RDONLY);
    try {
      fs.fsyncSync(directoryFd);
    } finally {
      fs.closeSync(directoryFd);
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try {
      fs.unlinkSync(tempPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function containsOmoSegment(candidate: string): boolean {
  const lexical = path.resolve(candidate).split(path.sep).includes(".omo");
  if (lexical) return true;
  let existing = path.resolve(candidate);
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  return fs.existsSync(existing) && fs.realpathSync(existing).split(path.sep).includes(".omo");
}

export function createClosureExporter(options: ClosureExporterOptions): ClosureExporter {
  const root = path.resolve(options.root);
  if (options.projectRoot !== undefined) assertWritableRootOutsideOmo(options.projectRoot, root);
  if (containsOmoSegment(root)) throw new Error("closure root must be outside every .omo tree");

  const exporter: BuiltinClosureExporter = {
    id: `emo-deterministic-closure/v1:${sha256Text(root)}`,
    closureRoot: root,
    validateRoot(projectRoot: string): void {
      assertWritableRootOutsideOmo(projectRoot, root);
    },
    async export(snapshot): Promise<{ path: string; sha256: string }> {
      const content = renderClosure(snapshot);
      const bytes = Buffer.from(content, "utf8");
      const digest = sha256Text(content);
      const finalPath = path.join(root, ...digestPath(snapshot));
      publishNoReplace(finalPath, bytes, digest, options.publicationHooks);
      return { path: finalPath, sha256: digest };
    },
  };
  return exporter;
}

/** Validate the built-in exporter's private output boundary before any effect starts. */
export function validateClosureExporterRoot(exporter: ClosureExporter, projectRoot: string): void {
  const candidate = exporter as Partial<BuiltinClosureExporter>;
  candidate.validateRoot?.(projectRoot);
}
