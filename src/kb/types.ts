/** Document kinds stored on the `exp` branch. */
export type DocKind = "plan" | "closure" | "decision" | "lesson";

export type FrontmatterValue = string | number | boolean | string[];
export type Frontmatter = Record<string, FrontmatterValue>;

export interface Doc {
  id: string;
  kind: DocKind;
  /** Path relative to the store root, forward slashes. */
  path: string;
  frontmatter: Frontmatter;
  body: string;
}

export interface NewDoc {
  kind: DocKind;
  /** Frontmatter fields except the ones the store fills in (id, type, created, author). */
  meta: Frontmatter;
  body: string;
}

export interface StoreOptions {
  /** Path inside the project's working repository (any directory of the repo). */
  repo: string;
  /** Where to mount the `exp` worktree. Default: <repo top-level>/.emo/exp. */
  dir?: string;
  /** Branch holding the knowledge. Default: `exp`. */
  branch?: string;
  /** Author slug stamped into ids and frontmatter. Default: git user.name. */
  author?: string;
}
