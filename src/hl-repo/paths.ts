import path from "node:path";
import type { DocType } from "./types";

const SAFE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** True when a value is safe to use as one filesystem path segment. */
export function isSafePathSegment(value: string): boolean {
  return SAFE_SEGMENT_RE.test(value);
}

function requireSafePathSegment(value: string | undefined, label: string): string {
  if (value === undefined || !isSafePathSegment(value)) {
    throw new Error(
      `${label} must be 1-128 characters using only letters, numbers, dot, underscore, or dash`,
    );
  }
  return value;
}

/** Directory for a project's docs: <root>/projects/<projectId>. */
export function projectDir(root: string, projectId: string): string {
  return path.join(root, "projects", requireSafePathSegment(projectId, "projectId"));
}

/**
 * Resolve the file path for a doc.
 * - `index` lives at <root>/index.md and ignores projectId.
 * - `skill` lives at <root>/skills/<name>.md and ignores projectId.
 * - `project-plan`/`spec`/`ba-memory` are fixed files under the project dir.
 * - `decision`/`change-request`/`closure`/`todo` are named files under a
 *   subdirectory of the project dir and require `name`.
 */
export function docPath(
  root: string,
  projectId: string,
  docType: DocType,
  name?: string,
): string {
  switch (docType) {
    case "index":
      return path.join(root, "index.md");
    case "skill":
      return path.join(root, "skills", `${requireSafePathSegment(name, "skill name")}.md`);
    case "project-plan":
      return path.join(projectDir(root, projectId), "project-plan.md");
    case "spec":
      return path.join(projectDir(root, projectId), "spec.md");
    case "ba-memory":
      return path.join(projectDir(root, projectId), "ba-memory.md");
    case "decision":
      return path.join(
        projectDir(root, projectId),
        "decisions",
        `${requireSafePathSegment(name, "decision name")}.md`,
      );
    case "change-request":
      return path.join(
        projectDir(root, projectId),
        "change-requests",
        `${requireSafePathSegment(name, "change-request name")}.md`,
      );
    case "closure":
      return path.join(
        projectDir(root, projectId),
        "closures",
        `${requireSafePathSegment(name, "closure name")}.md`,
      );
    case "todo":
      return path.join(
        projectDir(root, projectId),
        "todos",
        `${requireSafePathSegment(name, "todo name")}.md`,
      );
    case "feasibility":
      return path.join(
        projectDir(root, projectId),
        "feasibility",
        `${requireSafePathSegment(name, "feasibility name")}.md`,
      );
  }
}
