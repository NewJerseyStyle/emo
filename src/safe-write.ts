import fs from "node:fs";
import path from "node:path";
import { assertWritableRootOutsideOmo } from "./bridge-config";

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function ensureDirectory(pathValue: string): void {
  try {
    fs.mkdirSync(pathValue, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stat = fs.lstatSync(pathValue);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("writable path contains a non-directory or symbolic link");
  }
}

/**
 * Create and revalidate a writable directory without following descendant
 * symlinks. Call immediately before publishing a file into the directory.
 */
export function ensureSafeWriteDirectory(
  projectRoot: string,
  writableRoot: string,
  targetDirectory: string,
): string {
  const root = path.resolve(writableRoot);
  const target = path.resolve(targetDirectory);
  if (!isWithin(root, target)) throw new Error("write target escapes its configured root");
  assertWritableRootOutsideOmo(projectRoot, root);
  assertWritableRootOutsideOmo(projectRoot, target);

  const missing: string[] = [];
  let existing = root;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  for (const component of missing) {
    existing = path.join(existing, component);
    ensureDirectory(existing);
  }
  ensureDirectory(root);

  let current = root;
  const relative = path.relative(root, target);
  for (const component of relative === "" ? [] : relative.split(path.sep)) {
    if (component === "" || component === "." || component === "..") {
      throw new Error("write target contains an unsafe path component");
    }
    current = path.join(current, component);
    ensureDirectory(current);
    assertWritableRootOutsideOmo(projectRoot, current);
  }

  const canonicalRoot = fs.realpathSync(root);
  const canonicalTarget = fs.realpathSync(target);
  if (!isWithin(canonicalRoot, canonicalTarget)) {
    throw new Error("write target resolves outside its configured root");
  }
  assertWritableRootOutsideOmo(projectRoot, canonicalTarget);
  return canonicalTarget;
}

export interface AnchoredWriteDirectory {
  readonly canonicalPath: string;
  readonly anchorPath: string;
  assertCurrent(): void;
  close(): void;
}

function descriptorAnchor(fd: number): { anchor: string; canonical: string } | null {
  for (const root of ["/proc/self/fd", "/dev/fd"]) {
    const anchor = path.join(root, String(fd));
    try {
      return { anchor, canonical: fs.realpathSync(anchor) };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "EINVAL" && code !== "ENOTDIR") throw error;
    }
  }
  return null;
}

/**
 * Open a validated directory and keep all subsequent file operations anchored
 * to its descriptor. Platforms without a descriptor path fail before writing.
 */
export function openSafeWriteDirectory(
  projectRoot: string,
  writableRoot: string,
  targetDirectory: string,
): AnchoredWriteDirectory {
  const target = path.resolve(targetDirectory);
  const expectedCanonical = ensureSafeWriteDirectory(projectRoot, writableRoot, target);
  const directoryFlag = "O_DIRECTORY" in fs.constants ? fs.constants.O_DIRECTORY : 0;
  const noFollowFlag = "O_NOFOLLOW" in fs.constants ? fs.constants.O_NOFOLLOW : 0;
  const fd = fs.openSync(target, fs.constants.O_RDONLY | directoryFlag | noFollowFlag);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isDirectory()) throw new Error("write target is not a directory");
    const descriptor = descriptorAnchor(fd);
    if (descriptor === null) throw new Error("descriptor-anchored writes are unavailable");
    if (descriptor.canonical !== expectedCanonical) {
      throw new Error("write directory changed during validation");
    }
    assertWritableRootOutsideOmo(projectRoot, descriptor.canonical);

    return {
      canonicalPath: descriptor.canonical,
      anchorPath: descriptor.anchor,
      assertCurrent(): void {
        const current = fs.lstatSync(target);
        if (current.isSymbolicLink() || !current.isDirectory()) {
          throw new Error("write directory changed during publication");
        }
        if (fs.realpathSync(target) !== descriptor.canonical) {
          throw new Error("write directory changed during publication");
        }
        assertWritableRootOutsideOmo(projectRoot, descriptor.canonical);
      },
      close(): void {
        fs.closeSync(fd);
      },
    };
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}
