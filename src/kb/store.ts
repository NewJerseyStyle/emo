import fs from "node:fs";
import path from "node:path";
import { parse, serialize } from "./frontmatter";
import { git, gitOk } from "./git";
import { newId, slug } from "./ids";
import { validate } from "./schema";
import { findSecrets } from "./scrub";
import type { Doc, DocKind, Frontmatter, NewDoc, StoreOptions } from "./types";

const FORMAT_VERSION = 1;
const RESERVED = ["id", "type", "created", "author"];

const KIND_DIR: Record<DocKind, string> = {
  plan: "plans",
  closure: "closures",
  decision: "decisions",
  lesson: "inbox",
};

export interface Store {
  /** Absolute path of the mounted `exp` worktree. */
  readonly root: string;
  readonly branch: string;
  readonly author: string;
  addDoc(input: NewDoc): Doc;
  get(id: string): Doc | null;
  list(kind: DocKind): Doc[];
  /** Pull (rebase) and push `branch` when an `origin` remote exists. */
  sync(): { pulled: boolean; pushed: boolean };
}

function kindOfId(id: string): DocKind | null {
  const prefix = id.split("-", 1)[0];
  return prefix === "plan" || prefix === "closure" || prefix === "decision" || prefix === "lesson"
    ? prefix
    : null;
}

function toDoc(kind: DocKind, relPath: string, content: string): Doc | null {
  const parsed = parse(content);
  if (parsed === null || typeof parsed.frontmatter.id !== "string") return null;
  return { id: parsed.frontmatter.id, kind, path: relPath, ...parsed };
}

function excludeLocally(top: string, pattern: string): void {
  const file = path.resolve(top, git(top, ["rev-parse", "--git-path", "info/exclude"]));
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (current.split("\n").includes(pattern)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${current.endsWith("\n") || current === "" ? "" : "\n"}${pattern}\n`);
}

function mountWorktree(top: string, dir: string, branch: string): void {
  if (fs.existsSync(path.join(dir, ".git"))) return;
  fs.mkdirSync(path.dirname(dir), { recursive: true });

  if (gitOk(top, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])) {
    git(top, ["worktree", "add", dir, branch]);
  } else if (gitOk(top, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`])) {
    git(top, ["worktree", "add", "-b", branch, dir, `origin/${branch}`]);
  } else {
    git(top, ["worktree", "add", "--orphan", "-b", branch, dir]);
    fs.writeFileSync(path.join(dir, "EMO.md"), `# emo knowledge\n\nformat: ${FORMAT_VERSION}\n`);
    git(dir, ["add", "EMO.md"]);
    git(dir, ["commit", "-m", "chore: initialize emo knowledge branch"]);
  }
}

export function openStore(opts: StoreOptions): Store {
  const top = git(opts.repo, ["rev-parse", "--show-toplevel"]);
  const branch = opts.branch ?? "exp";
  const root = path.resolve(opts.dir ?? path.join(top, ".emo", "exp"));
  const author =
    opts.author ?? (gitOk(top, ["config", "user.name"]) ? git(top, ["config", "user.name"]) : "anon");

  if (opts.dir === undefined) excludeLocally(top, ".emo/");
  mountWorktree(top, root, branch);

  const fileFor = (kind: DocKind, id: string): string => `${KIND_DIR[kind]}/${id}.md`;

  const get = (id: string): Doc | null => {
    const kind = kindOfId(id);
    if (kind === null) return null;
    const rel = fileFor(kind, id);
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return null;
    return toDoc(kind, rel, fs.readFileSync(abs, "utf8"));
  };

  const list = (kind: DocKind): Doc[] => {
    const dir = path.join(root, KIND_DIR[kind]);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .flatMap((f) => {
        const doc = toDoc(kind, `${KIND_DIR[kind]}/${f}`, fs.readFileSync(path.join(dir, f), "utf8"));
        return doc === null ? [] : [doc];
      });
  };

  const addDoc = (input: NewDoc): Doc => {
    for (const key of RESERVED) {
      if (key in input.meta) throw new Error(`addDoc: "${key}" is set by the store`);
    }
    const id = newId(input.kind, author);
    const frontmatter: Frontmatter = {
      id,
      type: input.kind,
      ...input.meta,
      created: new Date().toISOString(),
      author: slug(author),
    };

    const errors = validate(input.kind, frontmatter, input.body);
    if (errors.length > 0) throw new Error(`addDoc: invalid ${input.kind}: ${errors.join("; ")}`);

    for (const link of ["plan", "supersedes"] as const) {
      const target = frontmatter[link];
      if (typeof target === "string" && get(target) === null) {
        throw new Error(`addDoc: ${link} "${target}" does not exist in the store`);
      }
    }

    const content = serialize(frontmatter, input.body);
    const secrets = findSecrets(content);
    if (secrets.length > 0) {
      throw new Error(`addDoc: refused, credential-like content found (${secrets.join(", ")})`);
    }

    const rel = fileFor(input.kind, id);
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, { flag: "wx" });
    try {
      git(root, ["add", "--", rel]);
      git(root, ["commit", "-m", `${input.kind}: ${id}`, "--", rel]);
    } catch (err) {
      fs.rmSync(abs, { force: true });
      git(root, ["reset", "-q", "--", rel]);
      throw err;
    }
    return { id, kind: input.kind, path: rel, frontmatter, body: input.body };
  };

  const sync = (): { pulled: boolean; pushed: boolean } => {
    if (!gitOk(root, ["remote", "get-url", "origin"])) return { pulled: false, pushed: false };
    let pulled = false;
    git(root, ["fetch", "origin"]);
    if (gitOk(root, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`])) {
      git(root, ["pull", "--rebase", "origin", branch]);
      pulled = true;
    }
    git(root, ["push", "-u", "origin", branch]);
    return { pulled, pushed: true };
  };

  return { root, branch, author, addDoc, get, list, sync };
}
