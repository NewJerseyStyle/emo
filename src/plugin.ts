import type { Plugin as PluginType } from "@opencode-ai/plugin";
import { discoverCompletedWork } from "./artifacts";
import { resolveBridgeConfig } from "./bridge-config";
import type { BridgeDependencies, ClosureExporter, Diagnostic } from "./bridge-types";
import { createClosureExporter } from "./export/closure";
import { processCompletedWork } from "./processing/process";

export const PLUGIN_ID = "cache-aware-opencode-cache-compaction";

export interface KnowledgeBridgePluginModule {
  id: string;
  server: PluginType;
}

function eventSessionID(event: { properties?: unknown }): string | undefined {
  const properties = event.properties;
  if (typeof properties !== "object" || properties === null) return undefined;
  const sessionID = (properties as { sessionID?: unknown }).sessionID;
  return typeof sessionID === "string" && sessionID !== "" ? sessionID : undefined;
}

function memoryEffectEnabled(
  dependencies: BridgeDependencies,
  memoryOwner: "auto" | "upstream" | "plugin" | "off",
  upstreamMemory: "available" | "unavailable" | "unknown",
): boolean {
  if (dependencies.memorySink === undefined) return false;
  return memoryOwner === "plugin"
    || (memoryOwner === "auto" && upstreamMemory === "unavailable");
}

export function createKnowledgeBridgePlugin(
  dependencies: BridgeDependencies = {},
): KnowledgeBridgePluginModule {
  const server: PluginType = async (input, rawOptions) => {
    const options = rawOptions as Record<string, unknown> | undefined;
    const config = resolveBridgeConfig(input.directory, options);
    if (!config.enabled) return {};

    const emittedDiagnostics = new Set<string>();
    const emit = (diagnostic: Diagnostic): void => {
      const key = `${diagnostic.code}\0${diagnostic.path ?? ""}`;
      if (emittedDiagnostics.has(key)) return;
      emittedDiagnostics.add(key);
      console.warn(`[emo-bridge] ${diagnostic.code}`);
    };

    if (config.memoryOwner === "plugin" && dependencies.memorySink === undefined) {
      emit({ code: "memory-sink-missing", message: "plugin memory ownership requires a sink" });
    }

    let closureExporter: ClosureExporter | undefined;
    if (config.closureEnabled) {
      try {
        closureExporter = createClosureExporter({
          root: config.closureRoot,
          projectRoot: input.directory,
        });
      } catch {
        emit({ code: "closure-root-invalid", message: "closure root is not writable" });
      }
    }

    const hasMemoryEffect = memoryEffectEnabled(
      dependencies,
      config.memoryOwner,
      config.upstreamMemory,
    );
    if (closureExporter === undefined && !hasMemoryEffect) return {};

    const inspect = async (sessionID: string): Promise<void> => {
      try {
        const discovered = await discoverCompletedWork({
          projectRoot: input.directory,
          sessionID,
          allowedWorktreeRoots: config.allowedWorktreeRoots,
          limits: config.limits,
        });
        discovered.diagnostics.forEach(emit);
        for (const snapshot of discovered.snapshots) {
          const result = await processCompletedWork(snapshot, {
            projectRoot: input.directory,
            memoryOwner: config.memoryOwner,
            upstreamMemory: config.upstreamMemory,
            ...(dependencies.memorySink === undefined ? {} : { memorySink: dependencies.memorySink }),
            ...(closureExporter === undefined ? {} : { closureExporter }),
            receiptRoot: config.stateRoot,
            lockTimeoutMs: config.lockTimeoutMs,
            lockLeaseMs: config.lockLeaseMs,
          });
          result.diagnostics.forEach(emit);
        }
      } catch {
        emit({ code: "lifecycle-scan-failed", message: "completed-work scan failed" });
      }
    };

    return {
      event: async ({ event }) => {
        if (event.type !== "session.idle" && event.type !== "session.compacted") return;
        const sessionID = eventSessionID(event);
        if (sessionID !== undefined) await inspect(sessionID);
      },
    };
  };

  return { id: PLUGIN_ID, server };
}
