import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deriveEffectKey, executeEffectWithReceipt } from "../../src/processing/receipts";
import { makeSnapshot } from "./fixture";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "emo-receipts-"));
  roots.push(root);
  return root;
}

describe("effect receipts", () => {
  it("serializes repeated in-process calls and publishes one success receipt", async () => {
    const projectRoot = temporaryRoot();
    const receiptRoot = path.join(projectRoot, "state");
    const snapshot = makeSnapshot();
    let calls = 0;
    const options = {
      projectRoot,
      receiptRoot,
      snapshot,
      effect: "memory" as const,
      adapterID: "memory/v1",
    };
    const outcomes = await Promise.all(Array.from({ length: 8 }, () =>
      executeEffectWithReceipt(options, async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
      })));
    expect(calls).toBe(1);
    expect(outcomes.filter((outcome) => outcome === "written")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "already-written")).toHaveLength(7);
  });

  it("does not receipt a failed effect and retries with the same key", async () => {
    const projectRoot = temporaryRoot();
    const receiptRoot = path.join(projectRoot, "state");
    const snapshot = makeSnapshot();
    const keys: string[] = [];
    await expect(executeEffectWithReceipt({
      projectRoot, receiptRoot, snapshot, effect: "memory", adapterID: "memory/v1",
    }, async (key) => {
      keys.push(key);
      throw new Error("failed");
    })).rejects.toThrow("failed");
    const outcome = await executeEffectWithReceipt({
      projectRoot, receiptRoot, snapshot, effect: "memory", adapterID: "memory/v1",
    }, async (key) => { keys.push(key); });
    expect(outcome).toBe("written");
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it("replays safely after success followed by interruption before receipt", async () => {
    const projectRoot = temporaryRoot();
    const receiptRoot = path.join(projectRoot, "state");
    const snapshot = makeSnapshot();
    let calls = 0;
    await expect(executeEffectWithReceipt({
      projectRoot,
      receiptRoot,
      snapshot,
      effect: "closure",
      adapterID: "closure/v1",
      afterEffectBeforeReceipt: () => { throw new Error("interrupted"); },
    }, async () => { calls += 1; })).rejects.toThrow("interrupted");
    expect(await executeEffectWithReceipt({
      projectRoot, receiptRoot, snapshot, effect: "closure", adapterID: "closure/v1",
    }, async () => { calls += 1; })).toBe("written");
    expect(calls).toBe(2);
  });

  it("defers on a live lock and recovers an expired owner-token lease", async () => {
    const projectRoot = temporaryRoot();
    const receiptRoot = path.join(projectRoot, "state");
    const snapshot = makeSnapshot();
    const key = deriveEffectKey(snapshot, "memory", "memory/v1");
    const lockDirectory = path.join(receiptRoot, "locks", "memory", key.slice(0, 2));
    const lockPath = path.join(lockDirectory, `${key}.lock`);
    fs.mkdirSync(lockDirectory, { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({
      version: 1, effectKey: key, ownerToken: "live", acquiredAt: Date.now(), leaseExpiresAt: Date.now() + 60_000,
    }));
    let calls = 0;
    expect(await executeEffectWithReceipt({
      projectRoot, receiptRoot, snapshot, effect: "memory", adapterID: "memory/v1", lockTimeoutMs: 20,
    }, async () => { calls += 1; })).toBe("deferred");
    expect(calls).toBe(0);
    fs.writeFileSync(lockPath, JSON.stringify({
      version: 1, effectKey: key, ownerToken: "stale", acquiredAt: 0, leaseExpiresAt: 0,
    }));
    expect(await executeEffectWithReceipt({
      projectRoot, receiptRoot, snapshot, effect: "memory", adapterID: "memory/v1", lockTimeoutMs: 100,
    }, async () => { calls += 1; })).toBe("written");
    expect(calls).toBe(1);
  });

  it("serializes the effect across separate processes", async () => {
    const projectRoot = temporaryRoot();
    const receiptRoot = path.join(projectRoot, "state");
    const snapshotPath = path.join(projectRoot, "snapshot.json");
    const effectLog = path.join(projectRoot, "effects.log");
    fs.writeFileSync(snapshotPath, JSON.stringify(makeSnapshot()));
    const worker = path.join(import.meta.dir, "concurrency-worker.ts");
    const command = [process.execPath, worker, snapshotPath, projectRoot, receiptRoot, effectLog];
    const children = [Bun.spawn(command), Bun.spawn(command), Bun.spawn(command)];
    const exits = await Promise.all(children.map((child) => child.exited));
    expect(exits).toEqual([0, 0, 0]);
    expect(fs.readFileSync(effectLog, "utf8").trim().split("\n")).toEqual(["promoted"]);
  });

  it("rejects protected receipt roots without mutating .omo", async () => {
    const projectRoot = temporaryRoot();
    const omo = path.join(projectRoot, ".omo");
    fs.mkdirSync(omo);
    const before = fs.readdirSync(omo);
    await expect(executeEffectWithReceipt({
      projectRoot,
      receiptRoot: path.join(omo, "state"),
      snapshot: makeSnapshot(),
      effect: "memory",
      adapterID: "memory/v1",
    }, async () => undefined)).rejects.toThrow();
    expect(fs.readdirSync(omo)).toEqual(before);
  });
});
