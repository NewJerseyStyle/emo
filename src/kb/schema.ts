import type { DocKind, Frontmatter } from "./types";

const PLAN_STATUS = ["draft", "confirmed", "done", "dropped"];
const DECISION_STATUS = ["proposed", "accepted", "superseded"];

function str(fm: Frontmatter, key: string, errors: string[]): void {
  const value = fm[key];
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${key} must be a non-empty string`);
  }
}

function oneOf(fm: Frontmatter, key: string, allowed: string[], errors: string[]): void {
  const value = fm[key];
  if (typeof value !== "string" || !allowed.includes(value)) {
    errors.push(`${key} must be one of ${allowed.join("|")}`);
  }
}

/** Body must contain a non-empty section under each `## <heading>`. */
function requireSections(body: string, headings: string[], errors: string[]): void {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  for (const heading of headings) {
    const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
    let filled = false;
    if (start !== -1) {
      for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i] as string;
        if (line.startsWith("## ")) break;
        if (line.trim() !== "") {
          filled = true;
          break;
        }
      }
    }
    if (!filled) errors.push(`body needs a non-empty "## ${heading}" section`);
  }
}

/** Errors for a complete document; empty list means valid. */
export function validate(kind: DocKind, fm: Frontmatter, body: string): string[] {
  const errors: string[] = [];
  str(fm, "id", errors);
  str(fm, "created", errors);
  str(fm, "author", errors);
  if (fm.type !== kind) errors.push(`type must be "${kind}"`);

  switch (kind) {
    case "plan":
      str(fm, "goal", errors);
      oneOf(fm, "status", PLAN_STATUS, errors);
      break;
    case "closure":
      str(fm, "plan", errors);
      str(fm, "outcome", errors);
      requireSections(body, ["Plan vs actual", "Lessons"], errors);
      break;
    case "decision":
      str(fm, "title", errors);
      oneOf(fm, "status", DECISION_STATUS, errors);
      break;
    case "lesson":
      str(fm, "title", errors);
      requireSections(body, ["What happened", "Why", "Do differently"], errors);
      break;
  }
  return errors;
}
