import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as pluginEntry from "../../src/index";
import {
  copyFixture,
  createHostileClient,
  hashTree,
  type PluginModule,
  pluginInput,
} from "../integration/helpers";

const roots: string[] = [];

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.chmodSync(root, 0o755);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("OpenCode plugin host contract", () => {
  it("default-exports one stable object-form plugin and no utility exports", () => {
    expect(Object.keys(pluginEntry)).toEqual(["default"]);
    const plugin = pluginEntry.default as PluginModule;
    expect(Object.keys(plugin).sort()).toEqual(["id", "server"]);
    expect(plugin.id).toBe("cache-aware-opencode-cache-compaction");
    expect(typeof plugin.server).toBe("function");
  });

  it("initializes once with caller options and does not touch the OpenCode client", async () => {
    const root = tempRoot("emo-host-contract-");
    copyFixture("absent", root);
    const hostile = createHostileClient();
    const plugin = pluginEntry.default as PluginModule;

    const hooks = await plugin.server(pluginInput(root, hostile.client), {
      enabled: true,
      closureEnabled: true,
      closureRoot: path.join(root, "caller-closures"),
      stateRoot: path.join(root, "caller-state"),
      memoryOwner: "auto",
      upstreamMemory: "unknown",
    });

    expect(typeof hooks.event).toBe("function");
    expect(hostile.calls).toEqual([]);
    expect(fs.existsSync(path.join(root, "caller-closures"))).toBe(false);
    expect(fs.existsSync(path.join(root, "caller-state"))).toBe(false);
  });
});

describe("no-OMO lifecycle hooks", () => {
  it("are a true no-op with no client calls or filesystem writes", async () => {
    const root = tempRoot("emo-no-omo-");
    copyFixture("absent", root);
    const hostile = createHostileClient();
    const plugin = pluginEntry.default as PluginModule;
    const before = hashTree(root);

    const hooks = await plugin.server(pluginInput(root, hostile.client), {
      enabled: true,
      closureEnabled: true,
      closureRoot: path.join(root, ".emo", "closures"),
      stateRoot: path.join(root, ".emo", "state"),
      memoryOwner: "plugin",
      upstreamMemory: "unavailable",
    });
    if (!hooks.event) throw new Error("plugin did not register an event hook");

    await hooks.event({
      event: { type: "session.idle", properties: { sessionID: "missing-session" } },
    });
    await hooks.event({
      event: { type: "session.compacted", properties: { sessionID: "missing-session" } },
    });

    expect(hostile.calls).toEqual([]);
    expect(hashTree(root)).toBe(before);
    expect(fs.existsSync(path.join(root, ".omo"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".emo"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".hl"))).toBe(false);
  });
});
