import fs from "node:fs";
import path from "node:path";
import { gitCommit, gitInit, gitPush, isGitRepo } from "./git";
import { docPath } from "./paths";
import { parseFrontmatter, validateFrontmatter } from "./schema";
import type { DocType, HlRepoConfig, ParsedDoc } from "./types";

const INDEX_CONTENT = "# HL Catalog\n";

/**
 * Create the repo structure (projects/skills/index.md), git init if needed,
 * and make an initial commit. Idempotent.
 */
export function ensureRepo(config: HlRepoConfig): void {
  fs.mkdirSync(path.join(config.root, "projects"), { recursive: true });
  fs.mkdirSync(path.join(config.root, "skills"), { recursive: true });
  const indexPath = path.join(config.root, "index.md");
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, INDEX_CONTENT);
  }
  if (!isGitRepo(config.root)) {
    gitInit(config.root);
  }
  gitCommit(config.root, "chore: initialize hl repo");
}

/** Read and parse a doc, or null when it does not exist. */
export function readDoc(
  config: HlRepoConfig,
  projectId: string,
  docType: DocType,
  name?: string,
): ParsedDoc | null {
  const filePath = docPath(config.root, projectId, docType, name);
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, "utf8");
  return parseFrontmatter(content);
}

/**
 * Validate frontmatter, write the doc file, and commit it. Throws on invalid
 * frontmatter or when the content has no frontmatter block.
 */
export function writeDoc(
  config: HlRepoConfig,
  projectId: string,
  docType: DocType,
  content: string,
  name?: string,
): void {
  const parsed = parseFrontmatter(content);
  if (parsed === null) {
    throw new Error(`writeDoc: content for ${docType} has no frontmatter block`);
  }
  const errors = validateFrontmatter(docType, parsed.frontmatter);
  if (errors.length > 0) {
    throw new Error(`writeDoc: invalid frontmatter for ${docType}: ${errors.join("; ")}`);
  }

  const filePath = docPath(config.root, projectId, docType, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  gitCommit(config.root, `${docType}${name ? `: ${name}` : ""}`);
}

/** Push to the configured remote when autoPush is enabled. */
export function push(config: HlRepoConfig): void {
  if (config.remote !== undefined && config.autoPush) {
    gitPush(config.root);
  }
}
