import fs from "node:fs";
import path from "node:path";
import { ensureRepo, readDoc, writeDoc } from "../hl-repo";
import { docPath, projectDir } from "../hl-repo/paths";
import type { HlRepoConfig } from "../hl-repo/types";
import type { FeasibilityReport } from "../pm/feasibility";
import { slugify } from "./audit";

/** Match a `- [ ] <id>: <title>` line in a project-plan doc. */
const TASK_LINE_RE = /^- \[ \] (\S+): /;

/**
 * Write an Architecture Decision Record (ADR) to the project's decisions/
 * directory. Records a decision with status + date frontmatter, optionally
 * superseding an earlier decision (supersession chain).
 */
export function writeDecision(
  config: HlRepoConfig,
  projectId: string,
  summary: string,
  supersedes?: string,
): void {
  ensureRepo(config);
  const name = slugify(summary).slice(0, 40) || "decision";
  const date = new Date().toISOString().slice(0, 10);
  const supersedesLine = supersedes === undefined ? "" : `supersedes: "${supersedes}"\n`;
  const content = `---
status: "accepted"
date: "${date}"
${supersedesLine}---
# Decision

${summary}
`;
  writeDoc(config, projectId, "decision", content, name);
}

/**
 * Append an entry to the project's ba-memory.md living document (BA working
 * memory: preferences, assumptions, open questions, usage observations).
 * Creates the doc with frontmatter when it does not yet exist.
 */
export function updateBaMemory(
  config: HlRepoConfig,
  projectId: string,
  entry: string,
): void {
  ensureRepo(config);
  const filePath = docPath(config.root, projectId, "ba-memory");
  const date = new Date().toISOString().slice(0, 10);
  let content: string;
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf8");
    content = `${existing.replace(/\s*$/, "")}\n\n## ${date}\n\n${entry}\n`;
  } else {
    content = `---
title: "${projectId}"
status: "active"
---
# ${projectId} BA Memory

## ${date}

${entry}
`;
  }
  writeDoc(config, projectId, "ba-memory", content);
}

/**
 * Schedule the next uncompleted task from the project plan (NEXT_STEP).
 * Reads project-plan.md, finds the first `- [ ] <id>: ...` line, writes a
 * todo doc for it, and returns the task id. Returns null when there is no
 * plan or no uncompleted task remains.
 */
export function scheduleNextTask(
  config: HlRepoConfig,
  projectId: string,
): string | null {
  const planPath = docPath(config.root, projectId, "project-plan");
  if (!fs.existsSync(planPath)) return null;
  const plan = fs.readFileSync(planPath, "utf8");
  for (const line of plan.split("\n")) {
    const match = TASK_LINE_RE.exec(line);
    if (match === null || match[1] === undefined) continue;
    const taskId = match[1];
    const existing = readDoc(config, projectId, "todo", taskId);
    if (existing !== null) {
      const status = existing.frontmatter.status;
      if (status === "completed" || status === "cancelled") {
        continue;
      }
      return taskId;
    }
    const date = new Date().toISOString().slice(0, 10);
    const content = `---
status: "in-progress"
date: "${date}"
---
# Task: ${taskId}

Scheduled as the next task from the project plan.
`;
    writeDoc(config, projectId, "todo", content, taskId);
    return taskId;
  }
  return null;
}

/**
 * Load the concatenated content of all prior closures for a project. Used by
 * the PM to carry lessons/decisions from earlier phases into new planning.
 * Returns an empty string when there are no closures.
 */
export function loadPriorClosures(
  config: HlRepoConfig,
  projectId: string,
): string {
  const dir = path.join(projectDir(config.root, projectId), "closures");
  if (!fs.existsSync(dir)) return "";
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  return files
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
    .join("\n\n");
}

/** Write a PM feasibility assessment to the project's feasibility/ dir. */
export function writeFeasibility(
  config: HlRepoConfig,
  projectId: string,
  report: FeasibilityReport,
): void {
  ensureRepo(config);
  const name = slugify(report.recommendation).slice(0, 40) || "feasibility";
  const date = new Date().toISOString().slice(0, 10);
  const bullet = (items: string[]): string =>
    items.length === 0 ? "- none" : items.map((item) => `- ${item}`).join("\n");
  const content = `---
status: "${report.assessment}"
date: "${date}"
---
# Feasibility

## Assessment

${report.assessment}

## Risks

${bullet(report.risks)}

## Uncertainties

${bullet(report.uncertainties)}

## Recommendation

${report.recommendation}
`;
  writeDoc(config, projectId, "feasibility", content, name);
}
