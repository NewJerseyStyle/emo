import { DEFAULT_CONFIG } from "../config";
import { initialState, reduce } from "../state-machine";
import type { HlRepoConfig } from "../hl-repo/types";
import { writeClosure } from "./closure";
import type { ClosureInput } from "./types";
import type { ControllerEvent } from "../types";

/**
 * Feed `events` through the P1 reducer (initialState + DEFAULT_CONFIG) and
 * report whether any reduce call yields a `compact` action.
 *
 * `contextTokens` is part of ControllerState but is not carried by any
 * ControllerEvent, so it is supplied explicitly (mirroring how the P1 tests
 * set it via `withContext`). The state is seeded with that value before the
 * first event is reduced.
 */
export function shouldCompact(
  events: ControllerEvent[],
  contextTokens: number,
): boolean {
  let state = { ...initialState(), contextTokens };
  for (const event of events) {
    const { state: next, action } = reduce(state, event, DEFAULT_CONFIG);
    if (action.type === "compact") return true;
    state = next;
  }
  return false;
}

/**
 * When the P1 state machine decides to compact, write the phase closure to the
 * HL repo (git commit). Returns true when a closure was written, false when no
 * compaction was decided.
 */
export function runHandoff(
  events: ControllerEvent[],
  closure: ClosureInput,
  config: HlRepoConfig,
  projectId: string,
  contextTokens: number,
): boolean {
  if (!shouldCompact(events, contextTokens)) return false;
  writeClosure(config, projectId, closure);
  return true;
}
