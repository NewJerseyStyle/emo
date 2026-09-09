import { describe, expect, it } from "bun:test";
import { DEFAULT_CONFIG } from "../src/config";
import { decide, initialState, reduce } from "../src/state-machine";
import type { CacheCompactionConfig, ControllerState } from "../src/types";

const cfg: CacheCompactionConfig = {
  enabled: true,
  minContextTokens: 20_000,
  heartbeatIntervalMs: 270_000,
  idleTimeoutMs: 60_000,
  gracePeriodMs: 5_000,
  maxHeartbeats: 3,
  cacheTtlMs: 300_000,
};

function withContext(state: ControllerState, tokens: number): ControllerState {
  return { ...state, contextTokens: tokens };
}

describe("initialState", () => {
  it("returns the canonical empty state shape", () => {
    expect(initialState()).toEqual({
      phase: "idle",
      sessionIdleAt: null,
      lastRequestAt: null,
      lastTypingAt: null,
      heartbeatCount: 0,
      compacted: false,
      contextTokens: 0,
    });
  });
});

describe("reduce / decide", () => {
  it("S1: idle + large context + grace elapsed → compact", () => {
    let { state } = reduce(initialState(), { type: "session.idle", now: 1000 }, cfg);
    state = withContext(state, 50_000);
    const { action } = reduce(state, { type: "tick", now: 1000 + cfg.gracePeriodMs }, cfg);
    expect(action).toEqual({ type: "compact" });
  });

  it("S1: idle + large context + grace NOT elapsed → none", () => {
    let { state } = reduce(initialState(), { type: "session.idle", now: 1000 }, cfg);
    state = withContext(state, 50_000);
    const { action } = reduce(state, { type: "tick", now: 1000 + cfg.gracePeriodMs - 1 }, cfg);
    expect(action).toEqual({ type: "none" });
  });

  it("S2: typing + lastRequestAt old (>= heartbeatInterval) → heartbeat", () => {
    let { state } = reduce(initialState(), { type: "session.idle", now: 0 }, cfg);
    state = withContext(state, 50_000);
    const { state: typing } = reduce(state, { type: "prompt.append", now: 100 }, cfg);
    const now = 100 + cfg.heartbeatIntervalMs;
    const stale = { ...typing, lastTypingAt: now, lastRequestAt: now - cfg.heartbeatIntervalMs };
    const { action } = reduce(stale, { type: "tick", now }, cfg);
    expect(action).toEqual({ type: "heartbeat" });
  });

  it("S3: typing then idleTimeout with no typing → compact", () => {
    let { state } = reduce(initialState(), { type: "session.idle", now: 0 }, cfg);
    state = withContext(state, 50_000);
    const { state: typing } = reduce(state, { type: "prompt.append", now: 100 }, cfg);
    const { action } = reduce(typing, { type: "tick", now: 100 + cfg.idleTimeoutMs }, cfg);
    expect(action).toEqual({ type: "compact" });
  });

  it("S3: heartbeat then idleTimeout with no typing → compact", () => {
    let { state } = reduce(initialState(), { type: "session.idle", now: 0 }, cfg);
    state = withContext(state, 50_000);
    const { state: typing } = reduce(state, { type: "prompt.append", now: 100 }, cfg);
    const heartbeatNow = 100 + cfg.heartbeatIntervalMs;
    const { state: heartbeat } = reduce(
      { ...typing, lastTypingAt: heartbeatNow, lastRequestAt: heartbeatNow - cfg.heartbeatIntervalMs },
      { type: "tick", now: heartbeatNow },
      cfg,
    );
    expect(heartbeat.phase).toBe("heartbeat");
    const { action } = reduce(
      heartbeat,
      { type: "tick", now: heartbeatNow + cfg.idleTimeoutMs },
      cfg,
    );
    expect(action).toEqual({ type: "compact" });
  });

  it("S5: already compacted → none", () => {
    const state = withContext({ ...initialState(), compacted: true }, 50_000);
    const { action } = reduce(state, { type: "tick", now: 999_999 }, cfg);
    expect(action).toEqual({ type: "none" });
  });

  it("S6: contextTokens < minContextTokens → none", () => {
    let { state } = reduce(initialState(), { type: "session.idle", now: 1000 }, cfg);
    state = withContext(state, cfg.minContextTokens - 1);
    const { action } = reduce(state, { type: "tick", now: 1000 + cfg.gracePeriodMs }, cfg);
    expect(action).toEqual({ type: "none" });
  });

  it("S7: heartbeatCount >= maxHeartbeats → compact (force)", () => {
    let { state } = reduce(initialState(), { type: "session.idle", now: 0 }, cfg);
    state = withContext(state, 50_000);
    const { state: typing } = reduce(state, { type: "prompt.append", now: 100 }, cfg);
    const now = 100 + cfg.heartbeatIntervalMs;
    const stale = {
      ...typing,
      lastRequestAt: now - cfg.heartbeatIntervalMs,
      heartbeatCount: cfg.maxHeartbeats,
    };
    const { action } = reduce(stale, { type: "tick", now }, cfg);
    expect(action).toEqual({ type: "compact" });
  });

  it("heartbeat action updates state optimistically (phase, count, lastRequestAt)", () => {
    let { state } = reduce(initialState(), { type: "session.idle", now: 0 }, cfg);
    state = withContext(state, 50_000);
    const { state: typing } = reduce(state, { type: "prompt.append", now: 100 }, cfg);
    const now = 100 + cfg.heartbeatIntervalMs;
    const stale = { ...typing, lastTypingAt: now, lastRequestAt: now - cfg.heartbeatIntervalMs };
    const { state: next, action } = reduce(stale, { type: "tick", now }, cfg);
    expect(action).toEqual({ type: "heartbeat" });
    expect(next.phase).toBe("heartbeat");
    expect(next.heartbeatCount).toBe(stale.heartbeatCount + 1);
    expect(next.lastRequestAt).toBe(now);
  });

  it("prompt.submit → phase done, action none", () => {
    const state = withContext(initialState(), 50_000);
    const { state: next, action } = reduce(state, { type: "prompt.submit", now: 123 }, cfg);
    expect(next.phase).toBe("done");
    expect(action).toEqual({ type: "none" });
  });

  it("session.compacted → phase done, compacted true, action none", () => {
    const state = withContext(initialState(), 50_000);
    const { state: next, action } = reduce(state, { type: "session.compacted", now: 123 }, cfg);
    expect(next.phase).toBe("done");
    expect(next.compacted).toBe(true);
    expect(action).toEqual({ type: "none" });
  });

  it("disabled config → always none, state unchanged", () => {
    const disabled: CacheCompactionConfig = { ...cfg, enabled: false };
    const state = withContext(
      { ...initialState(), sessionIdleAt: 1000, phase: "idle" },
      50_000,
    );
    const { state: next, action } = reduce(state, { type: "tick", now: 999_999 }, disabled);
    expect(action).toEqual({ type: "none" });
    expect(next).toBe(state);
  });

  it("decide returns none for done phase regardless of context", () => {
    const state = withContext({ ...initialState(), phase: "done" }, 50_000);
    expect(decide(state, 999_999, cfg)).toEqual({ type: "none" });
  });
});
