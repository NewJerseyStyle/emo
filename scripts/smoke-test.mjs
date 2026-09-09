// scripts/smoke-test.mjs — integration smoke test for the opencode plugin.
// Loads the built plugin and feeds realistic opencode events to verify it
// does not crash and does not run away (bounded behavior) under normal and
// adversarial scenarios.
//
// Usage: node scripts/smoke-test.mjs   (after `bun run build`)
import pluginModule from "../dist/index.js";

// opencode loads the plugin via its default export (PluginModule { server }).
const Plugin = pluginModule.server;

// Minimal mock client. The plugin only needs config.get, session.create and
// session.prompt; return inert values so the smoke test exercises the wiring
// without a live opencode server or LLM.
function mockClient() {
  return {
    config: {
      get: async () => ({ data: { plugin: [] } }),
    },
    session: {
      create: async () => ({ data: { id: "mock-ba" } }),
      prompt: async () => ({ data: { parts: [] } }),
    },
  };
}

let failures = 0;

function pass(name) {
  console.log(`PASS: ${name}`);
}

function fail(name, err) {
  failures += 1;
  console.error(`FAIL: ${name} — ${err instanceof Error ? err.message : String(err)}`);
}

async function expectNoThrow(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (err) {
    fail(name, err);
  }
}

async function main() {
  // 1. Plugin factory loads without throwing.
  let plugin;
  await expectNoThrow("plugin factory loads", async () => {
    plugin = await Plugin({ client: mockClient() });
  });

  // 2. Normal session lifecycle.
  await expectNoThrow("session.idle", () =>
    plugin.event({ event: { id: "1", type: "session.idle", properties: { sessionID: "s1" } } }),
  );
  await expectNoThrow("tui.prompt.append (no sessionID)", () =>
    plugin.event({ event: { type: "tui.prompt.append", properties: { text: "hello" } } }),
  );
  await expectNoThrow("chat.message", () =>
    plugin["chat.message"]({ sessionID: "s1" }, { message: {}, parts: [] }),
  );
  await expectNoThrow("session.compacted", () =>
    plugin.event({ event: { id: "2", type: "session.compacted", properties: { sessionID: "s1" } } }),
  );

  // 3. Unknown / unrelated event types must be ignored, not crash.
  await expectNoThrow("unknown event ignored", () =>
    plugin.event({ event: { id: "3", type: "some.unknown.event", properties: {} } }),
  );
  await expectNoThrow("workspace.ready ignored", () =>
    plugin.event({ event: { id: "4", type: "workspace.ready", properties: { name: "x" } } }),
  );

  // 4. Runaway check: many rapid events across many sessions must complete
  //    quickly and without unbounded growth / exceptions.
  await expectNoThrow("1000 rapid events (no runaway)", async () => {
    for (let i = 0; i < 1000; i++) {
      const sid = `s${i % 10}`;
      await plugin.event({ event: { id: `x${i}`, type: "session.idle", properties: { sessionID: sid } } });
      await plugin.event({ event: { type: "tui.prompt.append", properties: { text: "x" } } });
      await plugin["chat.message"]({ sessionID: sid }, { message: {}, parts: [] });
    }
  });

  // 5. Fresh plugin instance: chat.message before any session.idle
  //    (currentSessionId is null — must not crash).
  await expectNoThrow("chat.message with fresh plugin", async () => {
    const p2 = await Plugin({ client: mockClient() });
    await p2["chat.message"]({ sessionID: "s2" }, { message: {}, parts: [] });
  });

  // 6. dispose is optional; call it if present.
  await expectNoThrow("dispose", async () => {
    if (typeof plugin.dispose === "function") await plugin.dispose();
  });

  if (failures > 0) {
    console.error(`\nSMOKE TEST FAILED: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\nSMOKE TEST PASSED");
}

main().catch((err) => {
  console.error("SMOKE TEST FAILED:", err);
  process.exit(1);
});
