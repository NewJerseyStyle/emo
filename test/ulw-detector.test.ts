import { describe, expect, it } from "bun:test";
import { isUlwSession } from "../src/ulw-detector";
import type { UlwSignal } from "../src/types";

describe("isUlwSession", () => {
  it("S4: returns false for a non-ULW signal (no goal, no keyword)", () => {
    const signal: UlwSignal = { goalStatus: null, recentMessages: ["hello world"] };
    expect(isUlwSession(signal)).toBe(false);
  });

  it("S4: returns false for empty recent messages with no goal", () => {
    const signal: UlwSignal = { goalStatus: null, recentMessages: [] };
    expect(isUlwSession(signal)).toBe(false);
  });

  it("S4: returns true when goalStatus is active", () => {
    const signal: UlwSignal = { goalStatus: "active", recentMessages: [] };
    expect(isUlwSession(signal)).toBe(true);
  });

  it("S4: returns true when goalStatus is complete", () => {
    const signal: UlwSignal = { goalStatus: "complete", recentMessages: [] };
    expect(isUlwSession(signal)).toBe(true);
  });

  it("S4: returns true when goalStatus is paused", () => {
    const signal: UlwSignal = { goalStatus: "paused", recentMessages: [] };
    expect(isUlwSession(signal)).toBe(true);
  });

  it("S4: returns true when a message contains 'ulw'", () => {
    const signal: UlwSignal = { goalStatus: null, recentMessages: ["running ulw loop now"] };
    expect(isUlwSession(signal)).toBe(true);
  });

  it("S4: returns true when a message contains 'ultrawork'", () => {
    const signal: UlwSignal = { goalStatus: null, recentMessages: ["ultrawork session"] };
    expect(isUlwSession(signal)).toBe(true);
  });

  it("S4: returns true when a message contains 'ULW-LOOP' (case-insensitive)", () => {
    const signal: UlwSignal = { goalStatus: null, recentMessages: ["ULW-LOOP active"] };
    expect(isUlwSession(signal)).toBe(true);
  });

  it("S4: does not match 'ulw' as a substring of a longer word", () => {
    const signal: UlwSignal = { goalStatus: null, recentMessages: ["mulwark"] };
    expect(isUlwSession(signal)).toBe(false);
  });
});
