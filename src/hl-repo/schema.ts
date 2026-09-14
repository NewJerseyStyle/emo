import type { DocType, ParsedDoc } from "./types";

const NUMBER_RE = /^-?\d+(\.\d+)?$/;

function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (NUMBER_RE.test(value)) return Number(value);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseValue(raw: string): unknown {
  const value = raw.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1);
    if (inner.trim() === "") return [];
    return inner.split(",").map((item) => parseScalar(item));
  }
  return parseScalar(value);
}

/**
 * Parse a `---\n...\n---` YAML-ish frontmatter block from markdown content.
 * Supports string/number/boolean/array values. Returns null when the content
 * has no leading frontmatter block.
 */
export function parseFrontmatter(content: string): ParsedDoc | null {
  if (!content.startsWith("---\n")) return null;

  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) return null;

  const fmBlock = content.slice(4, endIndex);
  let body = content.slice(endIndex + 4);
  if (body.startsWith("\n")) {
    body = body.slice(1);
  }

  const frontmatter: Record<string, unknown> = {};
  for (const line of fmBlock.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;
    const key = trimmed.slice(0, colonIndex).trim();
    const rawValue = trimmed.slice(colonIndex + 1).trim();
    if (key === "") continue;
    frontmatter[key] = parseValue(rawValue);
  }

  return { frontmatter, body };
}

function requireString(fm: Record<string, unknown>, key: string, errors: string[]): void {
  if (typeof fm[key] !== "string") {
    errors.push(`${key} must be a string`);
  }
}

function requireNumber(fm: Record<string, unknown>, key: string, errors: string[]): void {
  if (typeof fm[key] !== "number") {
    errors.push(`${key} must be a number`);
  }
}

/**
 * Validate frontmatter for a doc type. Returns a list of error strings;
 * an empty list means valid.
 */
export function validateFrontmatter(
  docType: DocType,
  fm: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  switch (docType) {
    case "closure":
      requireString(fm, "phase", errors);
      requireNumber(fm, "tokens_saved", errors);
      break;
    case "decision":
      requireString(fm, "status", errors);
      requireString(fm, "date", errors);
      break;
    case "feasibility":
      requireString(fm, "status", errors);
      requireString(fm, "date", errors);
      break;
    case "change-request":
      requireString(fm, "status", errors);
      requireString(fm, "date", errors);
      break;
    case "project-plan":
      requireString(fm, "status", errors);
      break;
    default:
      break;
  }
  return errors;
}
