#!/usr/bin/env node
// test/runtime/test-compaction.mjs — verify the task-aware compaction mechanism
// works against a real LLM (InternalQwen) in the no-omo case.
//
// This exercises the core of the compression mechanism: extractTaskContext reads
// a session's conversation history and uses the LLM to produce a structured task
// summary (goal, progress, next_steps, ...). If this works, then when opencode
// compacts a session, the plugin can preserve task understanding and restore it
// on the next message — avoiding the cold-start token spike.
//
// Run inside the runtime container (has the plugin's node_modules + SDK).
import { createOpencodeClient } from "@opencode-ai/sdk";
import { extractTaskContext, formatTaskSummary } from "./dist/orchestrator/task-context.js";

// Connect to the opencode server started by run-test.sh (opencode serve).
const baseUrl = process.env.OPENCODE_BASE_URL || "http://127.0.0.1:4096";
const client = createOpencodeClient({ baseUrl });

async function main() {
  console.log("==> Creating a test session");
  const created = await client.session.create({ body: { title: "compaction-test" } });
  const sessionID = created.data?.id;
  if (!sessionID) {
    console.error("FAIL: could not create session");
    process.exit(1);
  }
  console.log(`==> Session: ${sessionID}`);

  // Send a task-related prompt so there is real conversation to extract from.
  console.log("==> Sending task prompt");
  await client.session.prompt({
    body: {
      parts: [
        {
          type: "text",
          text: "I'm building a REST API for a todo app. I've set up the Express server and the GET /todos endpoint returns a hardcoded list. Next I need to add POST /todos to create new items and persist them to a JSON file. Please help me implement the POST endpoint.",
        },
      ],
    },
    path: { id: sessionID },
  });

  // Give the model a moment to finish.
  await new Promise((r) => setTimeout(r, 3000));

  console.log("==> Reading session messages");
  const msgRes = await client.session.messages({ path: { id: sessionID } });
  const messages = msgRes.data ?? [];
  console.log(`==> Read ${messages.length} messages`);

  console.log("==> Extracting task context via LLM");
  const ctx = await extractTaskContext(client, sessionID);
  if (!ctx) {
    console.error("FAIL: extractTaskContext returned null");
    process.exit(1);
  }

  console.log("==> Extracted task context:");
  console.log(JSON.stringify(ctx, null, 2));

  // Validate the structure.
  let failures = 0;
  if (typeof ctx.goal !== "string" || ctx.goal.length === 0) {
    console.error("FAIL: goal is empty");
    failures++;
  }
  if (!Array.isArray(ctx.progress)) {
    console.error("FAIL: progress is not an array");
    failures++;
  }
  if (!Array.isArray(ctx.next_steps)) {
    console.error("FAIL: next_steps is not an array");
    failures++;
  }

  // The goal should reference the todo API task.
  const goalLower = ctx.goal.toLowerCase();
  if (goalLower.includes("todo") || goalLower.includes("api") || goalLower.includes("endpoint")) {
    console.log("PASS: goal references the task");
  } else {
    console.log(`WARN: goal may not reference the task: "${ctx.goal}"`);
  }

  console.log("");
  console.log("==> Formatted summary:");
  console.log(formatTaskSummary(ctx));

  if (failures > 0) {
    console.error(`\nCOMPACTION TEST FAILED: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\nCOMPACTION TEST PASSED");
}

main().catch((err) => {
  console.error("COMPACTION TEST ERROR:", err);
  process.exit(1);
});
