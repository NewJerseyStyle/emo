import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ClosureExporter, MemoryCapability, MemoryOwner, MemorySink } from "../../src/bridge-types";
import { processCompletedWork } from "../../src/processing/process";
import { sha256Text } from "../../src/snapshot";
import { makeSnapshot } from "./fixture";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "emo-process-"));
  roots.push(root);
  return root;
}

function options(root: string, owner: MemoryOwner, capability: MemoryCapability, sink?: MemorySink) {
  return {
    projectRoot: root,
    receiptRoot: path.join(root, "state"),
    memoryOwner: owner,
    upstreamMemory: capability,
    ...(sink === undefined ? {} : { memorySink: sink }),
  };
}

describe("completed-work processing", () => {
  it("implements the complete conservative memory ownership matrix", async () => {
    const cases: Array<[MemoryOwner, MemoryCapability, boolean, string]> = [
      ["off", "unavailable", true, "disabled"],
      ["upstream", "unavailable", true, "delegated-upstream"],
      ["plugin", "available", true, "written"],
      ["plugin", "unavailable", false, "disabled"],
      ["auto", "available", true, "delegated-upstream"],
      ["auto", "unknown", true, "disabled"],
      ["auto", "unavailable", true, "written"],
      ["auto", "unavailable", false, "disabled"],
    ];
    for (const [owner, capability, withSink, expected] of cases) {
      const root = temporaryRoot();
      let calls = 0;
      const sink: MemorySink | undefined = withSink ? {
        id: "sink/v1",
        promote: async () => { calls += 1; },
      } : undefined;
      const result = await processCompletedWork(makeSnapshot(), options(root, owner, capability, sink));
      expect(result.memory).toBe(expected);
      expect(calls).toBe(expected === "written" ? 1 : 0);
    }
  });

  it("uses effect-specific receipts on repeated calls", async () => {
    const root = temporaryRoot();
    let memoryCalls = 0;
    let closureCalls = 0;
    const sink: MemorySink = { id: "sink/v1", promote: async () => { memoryCalls += 1; } };
    const exporter: ClosureExporter = {
      id: "closure/v1",
      export: async () => {
        closureCalls += 1;
        return { path: path.join(root, "closure.md"), sha256: sha256Text("closure") };
      },
    };
    const processing = { ...options(root, "plugin" as const, "unavailable" as const, sink), closureExporter: exporter };
    const first = await processCompletedWork(makeSnapshot(), processing);
    const second = await processCompletedWork(makeSnapshot(), processing);
    expect(first.memory).toBe("written");
    expect(first.closure).toBe("written");
    expect(second.memory).toBe("already-written");
    expect(second.closure).toBe("already-written");
    expect([memoryCalls, closureCalls]).toEqual([1, 1]);
  });

  it("preserves partial success and retries only the failed effect", async () => {
    const root = temporaryRoot();
    let memoryCalls = 0;
    let closureCalls = 0;
    let failClosure = true;
    const sink: MemorySink = { id: "sink/v1", promote: async () => { memoryCalls += 1; } };
    const exporter: ClosureExporter = {
      id: "closure/v1",
      export: async () => {
        closureCalls += 1;
        if (failClosure) throw new Error("temporary");
        return { path: path.join(root, "closure.md"), sha256: sha256Text("closure") };
      },
    };
    const processing = { ...options(root, "plugin" as const, "unavailable" as const, sink), closureExporter: exporter };
    const first = await processCompletedWork(makeSnapshot(), processing);
    expect(first.memory).toBe("written");
    expect(first.closure).toBe("failed");
    failClosure = false;
    const second = await processCompletedWork(makeSnapshot(), processing);
    expect(second.memory).toBe("already-written");
    expect(second.closure).toBe("written");
    expect([memoryCalls, closureCalls]).toEqual([1, 2]);
  });

  it("rejects malformed public snapshots without invoking effects or creating state", async () => {
    const root = temporaryRoot();
    let calls = 0;
    const sink: MemorySink = { id: "sink/v1", promote: async () => { calls += 1; } };
    const invalid = { ...makeSnapshot(), workID: "tampered" };
    const result = await processCompletedWork(invalid, options(root, "plugin", "unavailable", sink));
    expect(result.memory).toBe("failed");
    expect(result.diagnostics.map((item) => item.code)).toContain("snapshot-invalid");
    expect(calls).toBe(0);
    expect(fs.existsSync(path.join(root, "state"))).toBeFalse();
  });

  it("rejects direct, nested, and symlink-aliased protected state roots", async () => {
    const projectRoot = temporaryRoot();
    const omo = path.join(projectRoot, ".omo");
    fs.mkdirSync(omo);
    const alias = path.join(projectRoot, "state-alias");
    fs.symlinkSync(omo, alias);
    const sink: MemorySink = { id: "sink/v1", promote: async () => { throw new Error("must not run"); } };
    for (const receiptRoot of [omo, path.join(omo, "state"), path.join(alias, "state")]) {
      const result = await processCompletedWork(makeSnapshot(), {
        projectRoot,
        receiptRoot,
        memoryOwner: "plugin",
        upstreamMemory: "unavailable",
        memorySink: sink,
      });
      expect(result.memory).toBe("failed");
      expect(result.diagnostics.map((item) => item.code)).toContain("receipt-root-invalid");
    }
    expect(fs.readdirSync(omo)).toEqual([]);
  });
});
