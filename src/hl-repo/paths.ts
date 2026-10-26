import path from "node:path";
import type { DocType } from "./types";

/** Directory for a project's docs: <root>/projects/<projectId>. */
export function projectDir(root: string, projectId: string): string {
  return path.join(root, "projects", projectId);
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
      return path.join(root, "skills", `${name}.md`);
    case "project-plan":
      return path.join(projectDir(root, projectId), "project-plan.md");
    case "spec":
      return path.join(projectDir(root, projectId), "spec.md");
    case "ba-memory":
      return path.join(projectDir(root, projectId), "ba-memory.md");
    case "decision":
      return path.join(projectDir(root, projectId), "decisions", `${name}.md`);
    case "change-request":
      return path.join(projectDir(root, projectId), "change-requests", `${name}.md`);
    case "closure":
      return path.join(projectDir(root, projectId), "closures", `${name}.md`);
    case "todo":
      return path.join(projectDir(root, projectId), "todos", `${name}.md`);
    case "feasibility":
      return path.join(projectDir(root, projectId), "feasibility", `${name}.md`);
  }
}
