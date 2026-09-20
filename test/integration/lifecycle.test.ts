import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pluginEntry from "../../src/index";
import {
  copyFixture,
  createHostileClient,
  findFiles,
  hashTree,
  makeReadOnlyTree,
  makeWritableTree,
  type PluginModule,
  pluginInput,
} from "./helpers";

const roots: string[] = [];

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    makeWritableTree(root);
    fs.chmodSync(root, 0o755);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function loadPlugin(
  root: string,
  client: unknown,
): Promise<NonNullable<Awaited<ReturnType<PluginModule["server"]>>["event"]>> {
  const plugin = pluginEntry as PluginModule;
  const hooks = await plugin.server(pluginInput(root, client), {
    enabled: true,
    closureEnabled: true,
    closureRoot: path.join(root, ".emo", "closures"),
    stateRoot: path.join(root, ".emo", "state"),
    memoryOwner: "upstream",
    upstreamMemory: "available",
  });
  if (!hooks.event) throw new Error("plugin did not register an event hook");
  return hooks.event;
}

describe("completed OMO lifecycle integration", () => {
  it("processes only the associated completed v2 work and never mutates .omo", async () => {
    const root = tempRoot("emo-v2-lifecycle-");
    copyFixture("v2-concurrent", root);
    const omoRoot = path.join(root, ".omo");
    makeReadOnlyTree(omoRoot);
    const before = hashTree(omoRoot);
    const hostile = createHostileClient();
    const event = await loadPlugin(root, hostile.client);

    await event({
      event: { type: "session.idle", properties: { sessionID: "active-session" } },
    });
    expect(findFiles(path.join(root, ".emo", "closures"), ".md")).toEqual([]);

    await event({
      event: { type: "session.idle", properties: { sessionID: "completed-session" } },
    });
    const firstClosures = findFiles(path.join(root, ".emo", "closures"), ".md");
    expect(firstClosures).toHaveLength(1);
    const firstBytes = fs.readFileSync(firstClosures[0]!, "utf8");
    expect(firstBytes).toContain("completed-work");
    expect(firstBytes).toContain("not measured");
    expect(firstBytes).not.toContain("tokens_saved");

    await event({
      event: { type: "session.compacted", properties: { sessionID: "completed-session" } },
    });

    const restartedEvent = await loadPlugin(root, hostile.client);
    await restartedEvent({
      event: { type: "session.idle", properties: { sessionID: "completed-session" } },
    });

    expect(findFiles(path.join(root, ".emo", "closures"), ".md")).toEqual(firstClosures);
    expect(fs.readFileSync(firstClosures[0]!, "utf8")).toBe(firstBytes);
    expect(hashTree(omoRoot)).toBe(before);
    expect(hostile.calls).toEqual([]);
  });

  it("processes a completed legacy record through the same plugin hook", async () => {
    const root = tempRoot("emo-legacy-lifecycle-");
    copyFixture("legacy-completed", root);
    const omoRoot = path.join(root, ".omo");
    const before = hashTree(omoRoot);
    const hostile = createHostileClient();
    const event = await loadPlugin(root, hostile.client);

    await event({
      event: { type: "session.compacted", properties: { sessionID: "legacy-session" } },
    });

    const closures = findFiles(path.join(root, ".emo", "closures"), ".md");
    expect(closures).toHaveLength(1);
    expect(fs.readFileSync(closures[0]!, "utf8")).toContain("legacy");
    expect(hashTree(omoRoot)).toBe(before);
    expect(hostile.calls).toEqual([]);
  });
});
