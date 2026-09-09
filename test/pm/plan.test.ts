import { describe, expect, it } from "bun:test";
import { buildPlan, topologicalSort, validatePlan } from "../../src/pm/plan";
import type { ComplexityLevel, PlannedTask, Task } from "../../src/pm/types";

function task(
  id: string,
  deps: string[] = [],
  complexity: ComplexityLevel = "low",
  docTokens = 100,
  codeTokens = 200,
): Task {
  return { id, title: `task ${id}`, docTokens, codeTokens, complexity, dependencies: deps };
}

function planned(t: Task): PlannedTask {
  return { ...t, estimate: { estimatedTokens: 1, reasoningBudget: 1, confidence: 1 } };
}

describe("validatePlan", () => {
  it("S4: returns an error for a missing dependency reference", () => {
    const tasks = [planned(task("a", ["ghost"]))];
    const errors = validatePlan(tasks);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      taskId: "a",
      message: expect.stringContaining("ghost") as string,
    });
  });

  it("S4: returns an error for a duplicate task id", () => {
    const tasks = [planned(task("a")), planned(task("a"))];
    const errors = validatePlan(tasks);
    expect(errors.some((e) => e.message.includes("duplicate"))).toBe(true);
  });

  it("S4: returns an error for a cycle", () => {
    const tasks = [planned(task("a", ["b"])), planned(task("b", ["a"]))];
    const errors = validatePlan(tasks);
    expect(errors.some((e) => e.message.toLowerCase().includes("cycle"))).toBe(true);
  });

  it("S4: returns an empty array for a valid plan", () => {
    const tasks = [planned(task("a")), planned(task("b", ["a"]))];
    expect(validatePlan(tasks)).toEqual([]);
  });
});

describe("topologicalSort", () => {
  it("S3: orders a dependency chain A→B→C with A before B before C", () => {
    const tasks = [
      planned(task("c", ["b"])),
      planned(task("b", ["a"])),
      planned(task("a")),
    ];
    const sorted = topologicalSort(tasks);
    const ids = sorted.map((t) => t.id);
    expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("b"));
    expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("c"));
  });

  it("S2: independent tasks are all present in some order", () => {
    const tasks = [planned(task("x")), planned(task("y")), planned(task("z"))];
    const sorted = topologicalSort(tasks);
    expect(sorted.map((t) => t.id).sort()).toEqual(["x", "y", "z"]);
  });

  it("S5: throws on a cycle", () => {
    const tasks = [planned(task("a", ["b"])), planned(task("b", ["a"]))];
    expect(() => topologicalSort(tasks)).toThrow();
  });
});

describe("buildPlan", () => {
  it("S2: independent tasks → topological order, totalTokens = sum of estimates", () => {
    const tasks = [task("x", [], "low", 100, 200), task("y", [], "medium", 50, 50)];
    const plan = buildPlan(tasks);
    expect(plan.tasks).toHaveLength(2);
    const expectedTotal =
      (100 + 200 + 2000) + (50 + 50 + 5000);
    expect(plan.totalTokens).toBe(expectedTotal);
  });

  it("S3: dependency chain A→B→C respects order", () => {
    const tasks = [task("c", ["b"]), task("b", ["a"]), task("a")];
    const plan = buildPlan(tasks);
    const ids = plan.tasks.map((t) => t.id);
    expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("b"));
    expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("c"));
  });

  it("S5: throws on a cycle", () => {
    const tasks = [task("a", ["b"]), task("b", ["a"])];
    expect(() => buildPlan(tasks)).toThrow();
  });

  it("S4: throws on a missing dependency reference", () => {
    const tasks = [task("a", ["ghost"])];
    expect(() => buildPlan(tasks)).toThrow();
  });
});
