import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CompletedWorkSnapshot } from "../bridge-types";
import { assertWritableRootOutsideOmo } from "../bridge-config";
import { canonicalJson, sha256Text } from "../snapshot";

export type EffectKind = "memory" | "closure";
export type ReceiptOutcome = "written" | "already-written" | "deferred";

export interface EffectReceipt {
  version: 1;
  effectKey: string;
  idempotencyKey: string;
  snapshotID: string;
  effect: EffectKind;
  adapterID: string;
}

export interface ReceiptExecutionOptions {
  projectRoot: string;
  receiptRoot: string;
  snapshot: CompletedWorkSnapshot;
  effect: EffectKind;
  adapterID: string;
  lockTimeoutMs?: number;
  lockLeaseMs?: number;
  /** Fault injection boundary used by focused durability tests. */
  afterEffectBeforeReceipt?(): void;
}

interface LockRecord {
  version: 1;
  effectKey: string;
  ownerToken: string;
  acquiredAt: number;
  leaseExpiresAt: number;
}

const serial = new Map<string, Promise<void>>();

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = serial.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const marker = run.then(() => undefined, () => undefined);
  serial.set(key, marker);
  void marker.finally(() => {
    if (serial.get(key) === marker) serial.delete(key);
  });
  return run;
}

export function deriveEffectKey(
  snapshot: CompletedWorkSnapshot,
  effect: EffectKind,
  adapterID: string,
): string {
  return sha256Text(canonicalJson({
    version: 1,
    projectID: snapshot.projectID,
    workID: snapshot.workID,
    workStartedAt: snapshot.workStartedAt,
    snapshotID: snapshot.snapshotID,
    effect,
    adapterID,
  }));
}

function pathsFor(root: string, effect: EffectKind, effectKey: string): {
  receiptDirectory: string;
  receiptPath: string;
  lockDirectory: string;
  lockPath: string;
  recoveryPath: string;
} {
  const shard = effectKey.slice(0, 2);
  const receiptDirectory = path.join(root, "receipts", effect, shard);
  const lockDirectory = path.join(root, "locks", effect, shard);
  return {
    receiptDirectory,
    receiptPath: path.join(receiptDirectory, `${effectKey}.json`),
    lockDirectory,
    lockPath: path.join(lockDirectory, `${effectKey}.lock`),
    recoveryPath: path.join(lockDirectory, `${effectKey}.recovery`),
  };
}

function readRegularUtf8(filePath: string): string | undefined {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`unsafe state file: ${filePath}`);
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function expectedReceipt(options: ReceiptExecutionOptions, effectKey: string): EffectReceipt {
  return {
    version: 1,
    effectKey,
    idempotencyKey: effectKey,
    snapshotID: options.snapshot.snapshotID,
    effect: options.effect,
    adapterID: options.adapterID,
  };
}

function hasReceipt(receiptPath: string, expected: EffectReceipt): boolean {
  const content = readRegularUtf8(receiptPath);
  if (content === undefined) return false;
  if (content !== `${canonicalJson(expected)}\n`) {
    throw new Error("receipt exists with conflicting or malformed content");
  }
  return true;
}

function fsyncDirectory(directory: string): void {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function writeNoReplace(finalPath: string, content: string): void {
  const directory = path.dirname(finalPath);
  const tempPath = path.join(directory, `.${path.basename(finalPath)}.${process.pid}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(tempPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeFileSync(fd, content, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    try {
      fs.linkSync(tempPath, finalPath);
      fsyncDirectory(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (readRegularUtf8(finalPath) !== content) throw new Error("state path already exists with conflicting content");
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try {
      fs.unlinkSync(tempPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function parseLock(content: string | undefined): LockRecord | undefined {
  if (content === undefined) return undefined;
  try {
    const value = JSON.parse(content) as Partial<LockRecord>;
    if (
      value.version !== 1
      || typeof value.effectKey !== "string"
      || typeof value.ownerToken !== "string"
      || typeof value.acquiredAt !== "number"
      || typeof value.leaseExpiresAt !== "number"
    ) return undefined;
    return value as LockRecord;
  } catch {
    return undefined;
  }
}

function createLock(lockPath: string, record: LockRecord): boolean {
  let fd: number;
  try {
    fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    fs.writeFileSync(fd, canonicalJson(record), "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fsyncDirectory(path.dirname(lockPath));
  return true;
}

function acquireRecoveryMutex(recoveryPath: string, ownerToken: string): boolean {
  try {
    const fd = fs.openSync(recoveryPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    try {
      fs.writeFileSync(fd, ownerToken, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

function releaseRecoveryMutex(recoveryPath: string, ownerToken: string): void {
  if (readRegularUtf8(recoveryPath) !== ownerToken) return;
  try {
    fs.unlinkSync(recoveryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function lockAgeFallback(lockPath: string, leaseMs: number): boolean {
  try {
    return fs.lstatSync(lockPath).mtimeMs + leaseMs <= Date.now();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function recoverStaleLock(
  lockPath: string,
  recoveryPath: string,
  effectKey: string,
  leaseMs: number,
): boolean {
  const recoveryToken = randomUUID();
  if (!acquireRecoveryMutex(recoveryPath, recoveryToken)) return false;
  let quarantine: string | undefined;
  try {
    const content = readRegularUtf8(lockPath);
    if (content === undefined) return true;
    const record = parseLock(content);
    const stale = record === undefined
      ? lockAgeFallback(lockPath, leaseMs)
      : record.effectKey === effectKey && record.leaseExpiresAt <= Date.now();
    if (!stale) return false;
    quarantine = `${lockPath}.stale.${randomUUID()}`;
    try {
      fs.renameSync(lockPath, quarantine);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      throw error;
    }
    return true;
  } finally {
    if (quarantine !== undefined) {
      try {
        fs.unlinkSync(quarantine);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    releaseRecoveryMutex(recoveryPath, recoveryToken);
  }
}

async function acquireLock(
  lockPath: string,
  recoveryPath: string,
  effectKey: string,
  timeoutMs: number,
  leaseMs: number,
): Promise<LockRecord | undefined> {
  const deadline = Date.now() + timeoutMs;
  const ownerToken = randomUUID();
  do {
    const now = Date.now();
    const record: LockRecord = {
      version: 1,
      effectKey,
      ownerToken,
      acquiredAt: now,
      leaseExpiresAt: now + leaseMs,
    };
    if (createLock(lockPath, record)) return record;
    recoverStaleLock(lockPath, recoveryPath, effectKey, leaseMs);
    if (Date.now() >= deadline) return undefined;
    await delay(Math.min(10, Math.max(1, deadline - Date.now())));
  } while (Date.now() <= deadline);
  return undefined;
}

function releaseLock(lockPath: string, recoveryPath: string, record: LockRecord): void {
  const recoveryToken = randomUUID();
  if (!acquireRecoveryMutex(recoveryPath, recoveryToken)) return;
  try {
    const current = parseLock(readRegularUtf8(lockPath));
    if (current?.ownerToken !== record.ownerToken || current.effectKey !== record.effectKey) return;
    try {
      fs.unlinkSync(lockPath);
      fsyncDirectory(path.dirname(lockPath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  } finally {
    releaseRecoveryMutex(recoveryPath, recoveryToken);
  }
}

function startLeaseRenewal(lockPath: string, record: LockRecord, leaseMs: number): () => void {
  const interval = setInterval(() => {
    try {
      const current = parseLock(readRegularUtf8(lockPath));
      if (current?.ownerToken !== record.ownerToken || current.effectKey !== record.effectKey) return;
      const renewed: LockRecord = { ...current, leaseExpiresAt: Date.now() + leaseMs };
      const content = canonicalJson(renewed);
      const fd = fs.openSync(lockPath, fs.constants.O_RDWR);
      try {
        fs.writeSync(fd, content, 0, "utf8");
        fs.ftruncateSync(fd, Buffer.byteLength(content));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      // Loss of the lease is handled by the idempotency key and receipt retry.
    }
  }, Math.max(10, Math.floor(leaseMs / 3)));
  interval.unref?.();
  return () => clearInterval(interval);
}

/**
 * Execute one idempotent effect and publish its success receipt. The callback
 * can be replayed after interruption and therefore must honor the supplied key.
 */
export async function executeEffectWithReceipt(
  options: ReceiptExecutionOptions,
  effect: (idempotencyKey: string) => Promise<void>,
): Promise<ReceiptOutcome> {
  assertWritableRootOutsideOmo(options.projectRoot, options.receiptRoot);
  if (options.adapterID.trim() === "" || Buffer.byteLength(options.adapterID) > 1024
    || /[\0\r\n]/.test(options.adapterID)) throw new Error("adapter id is invalid");
  const root = path.resolve(options.receiptRoot);
  const effectKey = deriveEffectKey(options.snapshot, options.effect, options.adapterID);
  const serialKey = `${root}\0${effectKey}`;
  const expected = expectedReceipt(options, effectKey);
  const locations = pathsFor(root, options.effect, effectKey);
  const timeoutMs = options.lockTimeoutMs ?? 250;
  const leaseMs = options.lockLeaseMs ?? 30_000;

  return serialize(serialKey, async () => {
    if (hasReceipt(locations.receiptPath, expected)) return "already-written";
    fs.mkdirSync(locations.receiptDirectory, { recursive: true, mode: 0o700 });
    fs.mkdirSync(locations.lockDirectory, { recursive: true, mode: 0o700 });
    if (hasReceipt(locations.receiptPath, expected)) return "already-written";
    const lock = await acquireLock(
      locations.lockPath,
      locations.recoveryPath,
      effectKey,
      Math.max(0, timeoutMs),
      Math.max(30, leaseMs),
    );
    if (lock === undefined) return "deferred";
    const stopRenewal = startLeaseRenewal(locations.lockPath, lock, Math.max(30, leaseMs));
    try {
      if (hasReceipt(locations.receiptPath, expected)) return "already-written";
      await effect(effectKey);
      options.afterEffectBeforeReceipt?.();
      writeNoReplace(locations.receiptPath, `${canonicalJson(expected)}\n`);
      return "written";
    } finally {
      stopRenewal();
      releaseLock(locations.lockPath, locations.recoveryPath, lock);
    }
  });
}
