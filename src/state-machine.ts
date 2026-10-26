import type {
  CacheCompactionConfig,
  ControllerAction,
  ControllerEvent,
  ControllerState,
} from "./types";

export function initialState(): ControllerState {
  return {
    phase: "idle",
    sessionIdleAt: null,
    lastRequestAt: null,
    lastTypingAt: null,
    heartbeatCount: 0,
    compacted: false,
    contextTokens: 0,
  };
}

export function decide(
  state: ControllerState,
  now: number,
  config: CacheCompactionConfig,
): ControllerAction {
  if (state.compacted || state.phase === "done" || state.phase === "compacting") {
    return { type: "none" };
  }
  if (state.contextTokens < config.minContextTokens) {
    return { type: "none" }; // S6
  }
  switch (state.phase) {
    case "idle":
      if (state.sessionIdleAt !== null && now - state.sessionIdleAt >= config.gracePeriodMs) {
        return { type: "compact" }; // S1
      }
      return { type: "none" };
    case "typing":
      // user gave up typing → compact (S3)
      if (state.lastTypingAt !== null && now - state.lastTypingAt >= config.idleTimeoutMs) {
        return { type: "compact" };
      }
      // near cache expiry while typing → heartbeat (S2)
      if (state.lastRequestAt !== null && now - state.lastRequestAt >= config.heartbeatIntervalMs) {
        if (state.heartbeatCount >= config.maxHeartbeats) {
          return { type: "compact" }; // S7
        }
        return { type: "heartbeat" };
      }
      return { type: "none" };
    case "heartbeat":
      if (state.lastTypingAt !== null && now - state.lastTypingAt >= config.idleTimeoutMs) {
        return { type: "compact" }; // S3 (stop heartbeat)
      }
      return { type: "none" };
    default:
      return { type: "none" };
  }
}

function applyHeartbeatDecision(
  state: ControllerState,
  action: ControllerAction,
  now: number,
): { state: ControllerState; action: ControllerAction } {
  if (action.type === "heartbeat") {
    return {
      state: {
        ...state,
        phase: "heartbeat",
        lastRequestAt: now,
        heartbeatCount: state.heartbeatCount + 1,
      },
      action,
    };
  }
  return { state, action };
}

export function reduce(
  state: ControllerState,
  event: ControllerEvent,
  config: CacheCompactionConfig,
): { state: ControllerState; action: ControllerAction } {
  if (!config.enabled) {
    return { state, action: { type: "none" } };
  }

  switch (event.type) {
    case "session.idle": {
      const next = { ...state, phase: "idle" as const, sessionIdleAt: event.now };
      return applyHeartbeatDecision(next, decide(next, event.now, config), event.now);
    }
    case "prompt.append": {
      const next = { ...state, lastTypingAt: event.now };
      if (state.phase === "idle" || state.phase === "heartbeat") {
        next.phase = "typing";
      }
      return applyHeartbeatDecision(next, decide(next, event.now, config), event.now);
    }
    case "prompt.submit":
      return { state: { ...state, phase: "done" }, action: { type: "none" } };
    case "session.compacted":
      return { state: { ...state, phase: "done", compacted: true }, action: { type: "none" } };
    case "tick":
      return applyHeartbeatDecision(state, decide(state, event.now, config), event.now);
  }
}
