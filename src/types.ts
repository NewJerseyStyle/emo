export type SessionPhase = "idle" | "typing" | "heartbeat" | "compacting" | "done";

export type ControllerEvent =
  | { type: "session.idle"; now: number }
  | { type: "prompt.append"; now: number }
  | { type: "prompt.submit"; now: number }
  | { type: "session.compacted"; now: number }
  | { type: "tick"; now: number };

export type ControllerAction =
  | { type: "none" }
  | { type: "compact" }
  | { type: "heartbeat" };

export interface ControllerState {
  phase: SessionPhase;
  sessionIdleAt: number | null;
  lastRequestAt: number | null;
  lastTypingAt: number | null;
  heartbeatCount: number;
  compacted: boolean;
  contextTokens: number;
}

export interface UlwSignal {
  goalStatus: "active" | "complete" | "paused" | null;
  recentMessages: string[];
}

export interface CacheCompactionConfig {
  enabled: boolean;
  minContextTokens: number;
  heartbeatIntervalMs: number;
  idleTimeoutMs: number;
  gracePeriodMs: number;
  maxHeartbeats: number;
  cacheTtlMs: number;
}
