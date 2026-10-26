export type DocType =
  | "project-plan"
  | "spec"
  | "ba-memory"
  | "decision"
  | "change-request"
  | "closure"
  | "todo"
  | "feasibility"
  | "index"
  | "skill";

export interface HlRepoConfig {
  /** Absolute path to the shared repository root (the "memory layer"). */
  root: string;
  /** Optional remote repo URL for server mode. When set, push() targets it. */
  remote?: string;
  /** Whether push() should actually run when a remote is configured. */
  autoPush: boolean;
}

export interface ParsedDoc {
  /** Parsed YAML-ish frontmatter block (key: value lines). */
  frontmatter: Record<string, unknown>;
  /** The markdown body after the closing `---` delimiter. */
  body: string;
}

/** Typed view of the known frontmatter fields across doc types. */
export interface DocMeta {
  title?: string;
  status?: string;
  phase?: string;
  tokens_saved?: number;
  supersedes?: string;
  date?: string;
}
