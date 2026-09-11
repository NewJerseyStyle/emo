import path from "node:path";
import type { Plugin as PluginType } from "@opencode-ai/plugin";
import type { ControllerEvent, ControllerState, UlwSignal } from "./types";
import { DEFAULT_CONFIG } from "./config";
import { initialState, reduce } from "./state-machine";
import { extractTaskContext, formatTaskSummary } from "./orchestrator/task-context";
import { detectOmo } from "./orchestrator/omo";
import { classifyWithLLM, extractUserText } from "./orchestrator/classify";
import { routeUserInput } from "./orchestrator/route";
import { detectFourF, sootheMessage } from "./ba/soothe";
import { isUlwSession } from "./ulw-detector";
import { generateTasks } from "./pm/generate";
import { buildPlan } from "./pm/plan";
import {
  slugify,
  writeProjectPlan,
  writeChangeRequest,
  writeClosureFromSession,
  type ProjectContext,
} from "./orchestrator/audit";
import type { HlRepoConfig } from "./hl-repo/types";
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

/** Active project tracked per session for PM documentation + closure. */
interface ActiveProject extends ProjectContext {
  closed: boolean;
}

/** User message signals that the task is complete (explicit closure). */
const COMPLETION_RE = /\b(done|finished|complete|completed|wrap up|wrap-up)\b/i;

const server: PluginType = async (input, options) => {
  const { client } = input;
  console.log("[cache-compaction] plugin server loaded");
  const states = new Map<string, ControllerState>();
  let currentSessionId: string | null = null;
  // Re-entrancy guard: our own client.session.prompt calls create new
  // messages that re-trigger chat.message. Skip while we are the initiator.
  let busy = false;
  // Lazy omo detection: resolved on the first chat.message, never at plugin
  // init (config.get during init deadlocks the server). Cached after first call.
  let omoPresent: boolean | null = null;
  const getOmoPresent = async (): Promise<boolean> => {
    if (omoPresent === null) {
      omoPresent = await Promise.race([
        detectOmo(client),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
      ]);
      console.log(`[cache-compaction] omo present: ${omoPresent}`);
    }
    return omoPresent;
  };

  // HL repo config, read from plugin options (opencode.json plugin entry).
  const hlConfig: HlRepoConfig = {
    root: (options?.hlRepoRoot as string | undefined) ?? path.join(input.directory, ".hl"),
    autoPush: options?.hlAutoPush === true,
    ...(options?.hlRemote !== undefined ? { remote: options.hlRemote as string } : {}),
  };

  // Per-session active projects, pending ULW closure timers, and the number
  // of keep-alive heartbeats already sent during a ULW pass-back.
  const activeProjects = new Map<string, ActiveProject>();
  const closureTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const ulwHeartbeatCounts = new Map<string, number>();

  const cancelClosureTimer = (sessionId: string): void => {
    const t = closureTimers.get(sessionId);
    if (t) {
      clearTimeout(t);
      closureTimers.delete(sessionId);
    }
    ulwHeartbeatCounts.delete(sessionId);
  };

  /** Send a keep-alive heartbeat so the provider cache stays warm. */
  const sendHeartbeat = async (sessionId: string): Promise<void> => {
    busy = true;
    try {
      await client.session.prompt({
        body: { system: "[heartbeat] keep-alive", parts: [], noReply: true },
        path: { id: sessionId },
      });
    } catch (err) {
      console.warn(
        `[cache-compaction] heartbeat failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      busy = false;
    }
  };

  /** Build a ULW signal from the session's recent messages. */
  const getUlwSignal = async (sessionId: string): Promise<UlwSignal> => {
    try {
      const msgRes = await client.session.messages({ path: { id: sessionId } });
      const messages = msgRes.data ?? [];
      const recentMessages = messages
        .slice(-10)
        .map((m) => extractUserText(m.parts))
        .filter((t) => t !== "");
      return { goalStatus: null, recentMessages };
    } catch {
      return { goalStatus: null, recentMessages: [] };
    }
  };

  /**
   * Plan a new goal: LLM-decompose into tasks, write spec + project-plan to
   * the HL repo, and register the active project for later closure.
   */
  const handleNewGoal = async (sessionId: string, goalSummary: string): Promise<void> => {
    const projectId = slugify(goalSummary);
    const tasks = await generateTasks(client, goalSummary);
    if (!tasks) {
      console.warn("[cache-compaction] PM: no tasks generated, skipping plan");
      return;
    }
    try {
      const totalTokens = writeProjectPlan(hlConfig, projectId, goalSummary, tasks);
      activeProjects.set(sessionId, { projectId, goal: goalSummary, totalTokens, closed: false });
      console.log(
        `[cache-compaction] PM: project "${projectId}" planned (${tasks.length} tasks, ${totalTokens} tokens)`,
      );
    } catch (err) {
      console.warn(
        `[cache-compaction] PM: plan write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  /** Log a change request to the HL repo for the active project. */
  const handleChangeRequest = (sessionId: string, summary: string): void => {
    const project = activeProjects.get(sessionId);
    if (!project) {
      console.warn("[cache-compaction] PM: change request ignored (no active project)");
      return;
    }
    try {
      writeChangeRequest(hlConfig, project.projectId, summary);
      console.log(`[cache-compaction] PM: change request logged for "${project.projectId}"`);
    } catch (err) {
      console.warn(
        `[cache-compaction] PM: change request write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  /** Write the closure doc for a session's active project. */
  const writeClosure = async (sessionId: string, reason: string): Promise<void> => {
    const project = activeProjects.get(sessionId);
    if (!project || project.closed) return;
    cancelClosureTimer(sessionId);
    busy = true;
    try {
      const ok = await writeClosureFromSession(client, hlConfig, sessionId, project);
      if (ok) {
        project.closed = true;
        console.log(`[cache-compaction] PM: closure written for "${project.projectId}" (${reason})`);
      }
    } catch (err) {
      console.warn(
        `[cache-compaction] PM: closure write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      busy = false;
    }
  };

  /**
   * ULW pass-back handling: when the agent finishes work and passes control
   * back to the user (waiting for the next instruction), keep the session
   * alive with heartbeats so the user can return. If the user never returns
   * (heartbeats exhausted), write the closure doc before the provider cache
   * expires — so the finished work is documented even if the user is away.
   */
  const scheduleUlwClosure = async (sessionId: string): Promise<void> => {
    const project = activeProjects.get(sessionId);
    if (!project || project.closed) return;
    if (closureTimers.has(sessionId)) return;
    const signal = await getUlwSignal(sessionId);
    if (!isUlwSession(signal)) return;
    armClosureTimer(sessionId);
  };

  const armClosureTimer = (sessionId: string): void => {
    const project = activeProjects.get(sessionId);
    if (!project || project.closed) return;
    const heartbeats = ulwHeartbeatCounts.get(sessionId) ?? 0;
    const timer = setTimeout(() => {
      closureTimers.delete(sessionId);
      if (project.closed) return;
      if (heartbeats < DEFAULT_CONFIG.maxHeartbeats) {
        ulwHeartbeatCounts.set(sessionId, heartbeats + 1);
        sendHeartbeat(sessionId).catch(() => {});
        armClosureTimer(sessionId);
      } else {
        writeClosure(sessionId, "ulw no input").catch(() => {});
      }
    }, DEFAULT_CONFIG.heartbeatIntervalMs);
    closureTimers.set(sessionId, timer);
  };

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
          scheduleUlwClosure(currentSessionId).catch(() => {});
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
            cancelClosureTimer(currentSessionId);
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
      cancelClosureTimer(sessionID);

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
      if (await getOmoPresent()) {
        busy = true;
        try {
          const classified = await classifyWithLLM(client, text);
          if (classified) {
            const decision = routeUserInput(classified);
            console.log(
              `[cache-compaction] BA decision: ${JSON.stringify(decision.actions.map((a) => a.action))}`,
            );
            // PM documentation: plan new goals, log change requests.
            for (const action of decision.actions) {
              if (action.action === "plan" && action.atom.type === "NEW_GOAL") {
                await handleNewGoal(sessionID, action.atom.summary);
              } else if (action.action === "plan" && action.atom.type === "CHANGE_REQUEST") {
                handleChangeRequest(sessionID, action.atom.summary);
              }
            }
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
        // Explicit completion signal → write the closure doc.
        if (COMPLETION_RE.test(text)) {
          await writeClosure(sessionID, "explicit done");
        }
      }
    },
  };
};

// opencode loads plugins as a default export object with a `server` function
// (PluginModule format). A bare named export is not picked up by the loader.
export default { id: "cache-aware-opencode-cache-compaction", server };