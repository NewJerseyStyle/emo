import { describe, expect, it } from "bun:test";
import { routeUserInput } from "../../src/orchestrator/route";
import type { ClassifiedInput, IntentAtom, IntentClass } from "../../src/ba/types";

function atom(type: IntentClass, summary = "s", confidence = 0.9): IntentAtom {
  return { type, summary, confidence };
}

function input(intents: IntentAtom[]): ClassifiedInput {
  return { intents, needsClarification: false };
}

describe("routeUserInput", () => {
  it("S1: NEW_GOAL atom routes to plan, needsConfirmation=true, fastPath=false", () => {
    const decision = routeUserInput(input([atom("NEW_GOAL", "build a dashboard")]));

    expect(decision.actions).toEqual([
      { atom: atom("NEW_GOAL", "build a dashboard"), action: "plan" },
    ]);
    expect(decision.needsConfirmation).toBe(true);
    expect(decision.fastPath).toBe(false);
  });

  it("S2: CONTINUE atom routes to execute, needsConfirmation=false, fastPath=true", () => {
    const decision = routeUserInput(input([atom("CONTINUE", "keep going")]));

    expect(decision.actions).toEqual([
      { atom: atom("CONTINUE", "keep going"), action: "execute" },
    ]);
    expect(decision.needsConfirmation).toBe(false);
    expect(decision.fastPath).toBe(true);
  });

  it("S3: mixed COMPLAINT + NEW_GOAL includes answer and plan, needsConfirmation=true", () => {
    const decision = routeUserInput(
      input([atom("COMPLAINT", "this is slow"), atom("NEW_GOAL", "add export")]),
    );

    const actions = decision.actions.map((a) => a.action);
    expect(actions).toContain("answer");
    expect(actions).toContain("plan");
    expect(decision.needsConfirmation).toBe(true);
    expect(decision.fastPath).toBe(false);
  });
});
