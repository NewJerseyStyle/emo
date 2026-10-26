import { describe, expect, it } from "bun:test";
import { isFastPath, routeInput, routeIntent } from "../../src/ba/routing";
import type { ClassifiedInput, IntentAtom, IntentClass, RoutingTarget } from "../../src/ba/types";

const ROUTING_TABLE: ReadonlyArray<readonly [IntentClass, RoutingTarget]> = [
  ["NEW_GOAL", { kind: "pm" }],
  ["NEXT_STEP", { kind: "ulw" }],
  ["CHANGE_REQUEST", { kind: "pm" }],
  ["FEEDBACK", { kind: "pm" }],
  ["BUG_DEBUG", { kind: "pm" }],
  ["QUESTION", { kind: "ba" }],
  ["COMPLAINT", { kind: "ba" }],
  ["CONTEXT_DUMP", { kind: "ba" }],
  ["PREFERENCE", { kind: "ba" }],
  ["PROCESS_FEEDBACK", { kind: "pm" }],
  ["STATUS_INQUIRY", { kind: "ba" }],
  ["CONTINUE", { kind: "ulw" }],
  ["CANCEL_SCOPE", { kind: "pm" }],
  ["META", { kind: "meta" }],
  ["NOISE", { kind: "ignore" }],
];

function atom(type: IntentClass, summary = "s", confidence = 0.9): IntentAtom {
  return { type, summary, confidence };
}

describe("routeIntent", () => {
  it("S1: routes all 15 intent classes to the correct target", () => {
    for (const [type, expected] of ROUTING_TABLE) {
      expect(routeIntent(type)).toEqual(expected);
    }
  });
});

describe("isFastPath", () => {
  it("S1: returns true only for CONTINUE and NEXT_STEP", () => {
    expect(isFastPath("CONTINUE")).toBe(true);
    expect(isFastPath("NEXT_STEP")).toBe(true);
    for (const [type] of ROUTING_TABLE) {
      if (type !== "CONTINUE" && type !== "NEXT_STEP") {
        expect(isFastPath(type)).toBe(false);
      }
    }
  });
});

describe("routeInput", () => {
  it("S2: routes CONTINUE + NEXT_STEP atoms to ulw with needsConfirmation=false", () => {
    const input: ClassifiedInput = {
      intents: [atom("CONTINUE"), atom("NEXT_STEP")],
      needsClarification: false,
    };
    const routed = routeInput(input);
    expect(routed).toHaveLength(2);
    expect(routed[0]).toEqual({
      atom: atom("CONTINUE"),
      target: { kind: "ulw" },
      needsConfirmation: false,
    });
    expect(routed[1]).toEqual({
      atom: atom("NEXT_STEP"),
      target: { kind: "ulw" },
      needsConfirmation: false,
    });
  });

  it("S3: routes a NEW_GOAL atom to pm with needsConfirmation=true", () => {
    const input: ClassifiedInput = {
      intents: [atom("NEW_GOAL", "build a dashboard")],
      needsClarification: false,
    };
    const routed = routeInput(input);
    expect(routed).toHaveLength(1);
    expect(routed[0]).toEqual({
      atom: atom("NEW_GOAL", "build a dashboard"),
      target: { kind: "pm" },
      needsConfirmation: true,
    });
  });

  it("S3: non-fast-path atoms always get needsConfirmation=true", () => {
    const input: ClassifiedInput = {
      intents: [atom("QUESTION"), atom("META"), atom("NOISE")],
      needsClarification: false,
    };
    const routed = routeInput(input);
    for (const r of routed) {
      expect(r.needsConfirmation).toBe(true);
    }
  });
});
