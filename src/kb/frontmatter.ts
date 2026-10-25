import type { Frontmatter, FrontmatterValue } from "./types";

const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const PLAIN_RE = /^[A-Za-z0-9_./@+-][A-Za-z0-9_ ./@+-]*$/;

function formatScalar(value: string | number | boolean): string {
  if (typeof value !== "string") return String(value);
  const needsQuote =
    value === "" ||
    value === "true" ||
    value === "false" ||
    NUMBER_RE.test(value) ||
    !PLAIN_RE.test(value) ||
    value !== value.trim();
  return needsQuote ? JSON.stringify(value) : value;
}

function parseScalar(raw: string): string | number | boolean {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (NUMBER_RE.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

function parseArray(inner: string): string[] {
  const items: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i] as string;
    if (ch === "\\" && inQuote) {
      current += ch + (inner[++i] ?? "");
    } else if (ch === '"') {
      inQuote = !inQuote;
      current += ch;
    } else if (ch === "," && !inQuote) {
      items.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim() !== "" || items.length > 0) items.push(current);
  return items.map((item) => String(parseScalar(item)));
}

function parseValue(raw: string): FrontmatterValue {
  const value = raw.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    return parseArray(value.slice(1, -1));
  }
  return parseScalar(value);
}

/** Serialize frontmatter + body. Keys keep insertion order. */
export function serialize(frontmatter: Frontmatter, body: string): string {
  const lines = Object.entries(frontmatter).map(([key, value]) =>
    Array.isArray(value)
      ? `${key}: [${value.map((v) => formatScalar(v)).join(", ")}]`
      : `${key}: ${formatScalar(value)}`,
  );
  const trimmed = body.replace(/^\n+/, "");
  return `---\n${lines.join("\n")}\n---\n\n${trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`}`;
}

/** Parse a document; null when it has no leading frontmatter block. */
export function parse(content: string): { frontmatter: Frontmatter; body: string } | null {
  const text = content.replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;

  const frontmatter: Frontmatter = {};
  for (const line of text.slice(4, end).split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    if (key === "") continue;
    frontmatter[key] = parseValue(trimmed.slice(colon + 1));
  }
  const body = text.slice(end + 4).replace(/^\n+/, "");
  return { frontmatter, body };
}
