import { createHash } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import type { Diagnostic, SourceRef } from "../bridge-types";

export interface ReadBudget {
  readonly limit: number;
  used: number;
  exhausted: boolean;
}

export interface AllowedRoot {
  readonly lexical: string;
  readonly canonical: string;
}

export type BoundedReadResult =
  | { state: "missing" }
  | { state: "rejected"; diagnostic: Diagnostic }
  | {
      state: "present";
      text: string;
      source: SourceRef;
      absolutePath: string;
      containmentRoot: AllowedRoot;
    };

export interface BoundedReadOptions {
  candidatePath: string;
  displayPath: string;
  sourcePath?: string;
  allowedRoots: readonly AllowedRoot[];
  maxBytes: number;
  budget: ReadBudget;
  selector?: string;
  /** Fault boundary used by containment-race regression tests. */
  beforeOpen?: () => void | Promise<void>;
}

const NO_FOLLOW = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
const NON_BLOCK = "O_NONBLOCK" in constants ? constants.O_NONBLOCK : 0;

function diagnostic(code: string, pathValue: string, message: string): Diagnostic {
  return { code, path: pathValue, message };
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function portableRelative(root: string, candidate: string): string {
  return path.relative(root, candidate).split(path.sep).join("/") || ".";
}

async function descriptorCanonicalPath(handle: fs.FileHandle): Promise<string | null> {
  for (const root of ["/proc/self/fd", "/dev/fd"]) {
    try {
      return await fs.realpath(path.join(root, String(handle.fd)));
    } catch (error) {
      const code = errorCode(error);
      if (code !== "ENOENT" && code !== "EINVAL" && code !== "ENOTDIR") throw error;
    }
  }
  return null;
}

export function createReadBudget(limit: number): ReadBudget {
  return { limit, used: 0, exhausted: false };
}

export async function resolveAllowedRoot(root: string): Promise<AllowedRoot | null> {
  const lexical = path.resolve(root);
  try {
    const stat = await fs.stat(lexical);
    if (!stat.isDirectory()) return null;
    return { lexical, canonical: await fs.realpath(lexical) };
  } catch {
    return null;
  }
}

export async function resolveAllowedRoots(
  projectRoot: string,
  additionalRoots: readonly string[],
): Promise<readonly AllowedRoot[]> {
  const roots: AllowedRoot[] = [];
  for (const root of [projectRoot, ...additionalRoots]) {
    const resolved = await resolveAllowedRoot(root);
    if (
      resolved !== null
      && !roots.some((existing) => existing.canonical === resolved.canonical)
    ) {
      roots.push(resolved);
    }
  }
  return roots;
}

function selectRoot(candidate: string, roots: readonly AllowedRoot[]): AllowedRoot | null {
  const ordered = [...roots].sort((left, right) => (
    Math.max(right.lexical.length, right.canonical.length)
    - Math.max(left.lexical.length, left.canonical.length)
  ));
  return ordered.find((root) => (
    isWithin(root.lexical, candidate) || isWithin(root.canonical, candidate)
  )) ?? null;
}

async function rejectSymlinkComponents(
  root: AllowedRoot,
  candidate: string,
): Promise<"ok" | "missing" | "symlink" | "io"> {
  const start = isWithin(root.lexical, candidate) ? root.lexical : root.canonical;
  const relative = path.relative(start, candidate);
  if (relative === "") return "io";

  let current = start;
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) return "symlink";
    } catch (error) {
      if (errorCode(error) === "ENOENT") return "missing";
      return "io";
    }
  }
  return "ok";
}

function makeSource(
  root: AllowedRoot,
  absolutePath: string,
  bytes: Uint8Array,
  sourcePath: string | undefined,
  selector: string | undefined,
): SourceRef {
  const base = sourcePath ?? portableRelative(root.canonical, absolutePath);
  const common = {
    relativePath: base,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength,
  };
  return selector === undefined ? common : { ...common, selector };
}

/**
 * Reads a UTF-8 regular file through a descriptor, never following a symlink.
 * The descriptor is capped by both the per-file and shared aggregate budgets.
 */
export async function readBoundedText(options: BoundedReadOptions): Promise<BoundedReadResult> {
  const candidate = path.resolve(options.candidatePath);
  const root = selectRoot(candidate, options.allowedRoots);
  if (root === null) {
    return {
      state: "rejected",
      diagnostic: diagnostic("read.unsafe_path", options.displayPath, "artifact path is outside an allowed root"),
    };
  }

  const componentState = await rejectSymlinkComponents(root, candidate);
  if (componentState === "missing") return { state: "missing" };
  if (componentState === "symlink") {
    return {
      state: "rejected",
      diagnostic: diagnostic("read.symlink", options.displayPath, "artifact path contains a symbolic link"),
    };
  }
  if (componentState === "io") {
    return {
      state: "rejected",
      diagnostic: diagnostic("read.io", options.displayPath, "artifact metadata could not be read"),
    };
  }

  let canonical: string;
  try {
    canonical = await fs.realpath(candidate);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { state: "missing" };
    return {
      state: "rejected",
      diagnostic: diagnostic("read.io", options.displayPath, "artifact path could not be resolved"),
    };
  }
  if (!isWithin(root.canonical, canonical)) {
    return {
      state: "rejected",
      diagnostic: diagnostic("read.unsafe_path", options.displayPath, "artifact path escapes its allowed root"),
    };
  }
  try {
    const before = await fs.lstat(candidate);
    if (!before.isFile() || before.isSymbolicLink()) {
      return {
        state: "rejected",
        diagnostic: diagnostic("read.not_regular", options.displayPath, "artifact is not a regular file"),
      };
    }
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { state: "missing" };
    return {
      state: "rejected",
      diagnostic: diagnostic("read.io", options.displayPath, "artifact metadata could not be read"),
    };
  }
  await options.beforeOpen?.();
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(candidate, constants.O_RDONLY | NO_FOLLOW | NON_BLOCK);
    const stat = await handle.stat();
    if (!stat.isFile()) {
      return {
        state: "rejected",
        diagnostic: diagnostic("read.not_regular", options.displayPath, "artifact is not a regular file"),
      };
    }
    const openedCanonical = await descriptorCanonicalPath(handle);
    if (openedCanonical !== null) {
      if (!isWithin(root.canonical, openedCanonical)) {
        return {
          state: "rejected",
          diagnostic: diagnostic("read.unsafe_path", options.displayPath, "opened artifact escapes its allowed root"),
        };
      }
      canonical = openedCanonical;
    } else {
      const current = await fs.lstat(candidate);
      const currentCanonical = await fs.realpath(candidate);
      if (
        current.isSymbolicLink()
        || !current.isFile()
        || current.dev !== stat.dev
        || current.ino !== stat.ino
        || !isWithin(root.canonical, currentCanonical)
      ) {
        return {
          state: "rejected",
          diagnostic: diagnostic("read.changed_path", options.displayPath, "artifact path changed during validation"),
        };
      }
      canonical = currentCanonical;
    }

    if (stat.size > options.maxBytes) {
      return {
        state: "rejected",
        diagnostic: diagnostic("read.too_large", options.displayPath, "artifact exceeds its byte limit"),
      };
    }

    const aggregateRemaining = Math.max(0, options.budget.limit - options.budget.used);
    if (stat.size > aggregateRemaining) {
      options.budget.exhausted = true;
      return {
        state: "rejected",
        diagnostic: diagnostic("read.aggregate_too_large", options.displayPath, "artifact aggregate byte limit was exceeded"),
      };
    }

    const cap = Math.min(options.maxBytes, aggregateRemaining);
    const bytes = new Uint8Array(cap + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    options.budget.used += offset;

    if (offset > aggregateRemaining) {
      options.budget.exhausted = true;
      return {
        state: "rejected",
        diagnostic: diagnostic("read.aggregate_too_large", options.displayPath, "artifact aggregate byte limit was exceeded"),
      };
    }
    if (offset > options.maxBytes) {
      return {
        state: "rejected",
        diagnostic: diagnostic("read.too_large", options.displayPath, "artifact exceeds its byte limit"),
      };
    }

    const exact = bytes.subarray(0, offset);
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(exact);
    } catch {
      return {
        state: "rejected",
        diagnostic: diagnostic("read.invalid_utf8", options.displayPath, "artifact is not valid UTF-8"),
      };
    }
    return {
      state: "present",
      text,
      source: makeSource(root, canonical, exact, options.sourcePath, options.selector),
      absolutePath: canonical,
      containmentRoot: root,
    };
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") return { state: "missing" };
    if (code === "ELOOP") {
      return {
        state: "rejected",
        diagnostic: diagnostic("read.symlink", options.displayPath, "artifact path contains a symbolic link"),
      };
    }
    return {
      state: "rejected",
      diagnostic: diagnostic("read.io", options.displayPath, "artifact could not be read"),
    };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
