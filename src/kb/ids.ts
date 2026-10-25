import { randomBytes } from "node:crypto";
import type { DocKind } from "./types";

/** Turn an arbitrary name into a safe, short id segment. */
export function slug(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
  return s === "" ? "anon" : s;
}

/**
 * Sortable, collision-resistant id: `<kind>-<utc yyyymmddThhmmss>-<author>-<rand4>`.
 * Two writers practically never produce the same id, so documents never share a path.
 */
export function newId(
  kind: DocKind,
  author: string,
  now: Date = new Date(),
  rand: string = randomBytes(2).toString("hex"),
): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
  return `${kind}-${stamp}-${slug(author)}-${rand}`;
}

const ID_RE = /^(plan|closure|decision|lesson)-\d{8}T\d{6}-[a-z0-9-]+-[0-9a-f]{4}$/;

export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}
