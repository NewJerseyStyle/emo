import type { Plugin as PluginType } from "@opencode-ai/plugin";
import type { ControllerEvent, ControllerState } from "./types";
import { DEFAULT_CONFIG } from "./config";
import { initialState, reduce } from "./state-machine";
import { extractTaskContext, formatTaskSummary } from "./orchestrator/task-context";
import { detectOmo } from "./orchestrator/omo";
import { classifyWithLLM, extractUserText } from "./orchestrator/classify";
import { routeUserInput } from "./orchestrator/route";
import { detectFourF, sootheMessage } from "./ba/soothe";
import type { OpencodeClient } from "@opencode-ai/sdk";

export { DEFAULT_CONFIG } from "./config";
export { initialState, reduce } from "./state-machine";
export { isUlwSession } from "./ulw-detector";
export * from "./hl-repo";
export * from "./ba";
export * from "./pm";
export * from "./orchestrator";

/** In-memory storage for task context extracted after compaction. */
const taskContextStore = new Map<string, string>();

const server: PluginType = async (input) => {
  const { client } = input;
  console.log("[cache-compaction] plugin server loaded");
  // BA orchestration + HL repo writes are active only when omo is installed.
  const omoPresent = await detectOmo(client);
  console.log(`[cache-compaction] omo present: ${omoPresent}`);
  const states = new Map<string, ControllerState>();
  let currentSessionId: string | null = null;
  // Re-entrancy guard: our own client.session.prompt calls create new
  // messages that re-trigger chat.message. Skip while we are the initiator.
  let busy = false;

  const handle = (sessionId: string, event: ControllerEvent): void => {
    const state = states.get(sessionId) ?? initialState();
    const { state: next, action } = reduce(state, event, DEFAULT_CONFIG);
    states.set(sessionId, next);
    if (action.type !== "none") {
      console.log(`[cache-compaction] session ${sessionId} action=${action.type}`);
    }
  };

  /**
   * Extract and store task context from the session's conversation history.
   * Called after session.compacted to preserve what was being worked on.
   */
  const storeTaskContext = async (
    client: OpencodeClient,
    sessionID: string,
  ): Promise<void> => {
    const ctx = await extractTaskContext(client, sessionID);
    if (!ctx) {
      console.log("[cache-compaction] no task context extracted");
      return;
    }
    const summary = formatTaskSummary(ctx);
    taskContextStore.set(sessionID, summary);
    console.log(
      `[cache-compaction] task context stored: goal="${ctx.goal.slice(0, 60)}..."`,
    );
  };

  return {
    event: async ({ event }) => {
      switch (event.type) {
        case "session.idle": {
          currentSessionId = event.properties.sessionID;
          handle(currentSessionId, { type: "session.idle", now: Date.now() });
          break;
        }
        case "session.compacted": {
          const sessionId = event.properties.sessionID;
          currentSessionId = sessionId;
          handle(sessionId, { type: "session.compacted", now: Date.now() });
          // Extract task context from recent messages to preserve
          // in-progress work across compaction boundaries.
          try {
            await storeTaskContext(client, sessionId);
          } catch (err) {
            console.warn(
              `[cache-compaction] task context extraction failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          break;
        }
        case "tui.prompt.append": {
          if (currentSessionId !== null) {
            handle(currentSessionId, { type: "prompt.append", now: Date.now() });
          }
          break;
        }
        default:
          break;
      }
    },
    "chat.message": async ({ sessionID }, { parts }) => {
      currentSessionId = sessionID;
      handle(sessionID, { type: "prompt.submit", now: Date.now() });

      // Skip messages we initiated ourselves.
      if (busy) return;

      const text = parts
        .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join("\n")
        .trim();
      if (!text) return;

      // Check if we have stored task context from a prior compaction.
      // If so, inject it as system context before any further processing.
      const storedContext = taskContextStore.get(sessionID);
      if (storedContext) {
        taskContextStore.delete(sessionID);
        console.log("[cache-compaction] restoring task context for session");
        // Send the context as a system message to the session, noReply=true
        // so the model absorbs it without generating a visible response.
        busy = true;
        try {
          await client.session.prompt({
            body: {
              system: storedContext,
              parts: [],
              noReply: true,
            },
            path: { id: sessionID },
          });
        } catch (err) {
          console.warn(
            `[cache-compaction] context restore failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        } finally {
          busy = false;
        }
      }

      // BA orchestration: only when omo is installed.
      if (omoPresent) {
        busy = true;
        try {
          const classified = await classifyWithLLM(client, text);
          if (classified) {
            const decision = routeUserInput(classified);
            console.log(
              `[cache-compaction] BA decision: ${JSON.stringify(decision.actions.map((a) => a.action))}`,
            );
            const f = detectFourF(text);
            if (f) {
              console.log(
                `[cache-compaction] BA soothe (${f}): ${sootheMessage(f)}`,
              );
            }
          } else {
            console.log("[cache-compaction] BA classification returned no result");
          }
        } catch (err) {
          console.warn(
            `[cache-compaction] BA classification error: ${err instanceof Error ? err.message : String(err)}`,
          );
        } finally {
          busy = false;
        }
      }
    },
  };
};

// opencode loads plugins as a default export object with a `server` function
// (PluginModule format). A bare named export is not picked up by the loader.
export default { id: "cache-aware-opencode-cache-compaction", server };