import { describe, expect, it } from "bun:test";
import { estimateTask, estimateTasks } from "../../src/pm/estimate";
import type { ComplexityLevel, Task } from "../../src/pm/types";

function task(
  id: string,
  complexity: ComplexityLevel,
  docTokens = 100,
  codeTokens = 200,
): Task {
  return { id, title: `task ${id}`, docTokens, codeTokens, complexity, dependencies: [] };
}

describe("estimateTask", () => {
  it("S1: low complexity → reasoningBudget 2000, confidence 0.9", () => {
    const t = task("a", "low", 100, 200);
    const est = estimateTask(t);
    expect(est.reasoningBudget).toBe(2000);
    expect(est.confidence).toBe(0.9);
    expect(est.estimatedTokens).toBe(100 + 200 + 2000);
  });

  it("S1: medium complexity → reasoningBudget 5000, confidence 0.7", () => {
    const t = task("a", "medium", 100, 200);
    const est = estimateTask(t);
    expect(est.reasoningBudget).toBe(5000);
    expect(est.confidence).toBe(0.7);
    expect(est.estimatedTokens).toBe(100 + 200 + 5000);
  });

  it("S1: high complexity → reasoningBudget 10000, confidence 0.5", () => {
    const t = task("a", "high", 100, 200);
    const est = estimateTask(t);
    expect(est.reasoningBudget).toBe(10000);
    expect(est.confidence).toBe(0.5);
    expect(est.estimatedTokens).toBe(100 + 200 + 10000);
  });
});

describe("estimateTasks", () => {
  it("S1: maps every task to a PlannedTask with its estimate", () => {
    const tasks = [task("a", "low"), task("b", "medium"), task("c", "high")];
    const planned = estimateTasks(tasks);
    expect(planned).toHaveLength(3);
    expect(planned[0]).toEqual({ ...tasks[0], estimate: estimateTask(tasks[0]) });
    expect(planned[1]).toEqual({ ...tasks[1], estimate: estimateTask(tasks[1]) });
    expect(planned[2]).toEqual({ ...tasks[2], estimate: estimateTask(tasks[2]) });
  });
});
