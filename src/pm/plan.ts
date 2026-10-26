import { estimateTasks } from "./estimate";
import type { Plan, PlanError, PlannedTask, Task } from "./types";

/**
 * Validate a set of planned tasks. Returns an empty array when valid, or a
 * PlanError per problem found: missing dependency reference, duplicate id,
 * or a dependency cycle.
 */
export function validatePlan(tasks: PlannedTask[]): PlanError[] {
  const errors: PlanError[] = [];
  const ids = new Set<string>();
  const seen = new Set<string>();

  for (const t of tasks) {
    if (seen.has(t.id)) {
      errors.push({ taskId: t.id, message: `duplicate task id: ${t.id}` });
    }
    seen.add(t.id);
    ids.add(t.id);
  }

  for (const t of tasks) {
    for (const dep of t.dependencies) {
      if (!ids.has(dep)) {
        errors.push({
          taskId: t.id,
          message: `missing dependency reference: ${dep}`,
        });
      }
    }
  }

  if (hasCycle(tasks)) {
    errors.push({ taskId: tasks[0]?.id ?? "", message: "dependency cycle detected" });
  }

  return errors;
}

/** Detect a cycle in the dependency graph via Kahn's algorithm. */
function hasCycle(tasks: PlannedTask[]): boolean {
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const t of tasks) {
    indegree.set(t.id, 0);
    dependents.set(t.id, []);
  }
  for (const t of tasks) {
    for (const dep of t.dependencies) {
      if (!indegree.has(dep)) continue;
      indegree.set(t.id, (indegree.get(t.id) ?? 0) + 1);
      dependents.get(dep)?.push(t.id);
    }
  }
  const queue = tasks.filter((t) => (indegree.get(t.id) ?? 0) === 0).map((t) => t.id);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift() as string;
    visited += 1;
    for (const next of dependents.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  return visited !== tasks.length;
}

/**
 * Order tasks so every dependency precedes its dependents (Kahn's
 * algorithm). Throws when the graph contains a cycle.
 */
export function topologicalSort(tasks: PlannedTask[]): PlannedTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const t of tasks) {
    indegree.set(t.id, 0);
    dependents.set(t.id, []);
  }
  for (const t of tasks) {
    for (const dep of t.dependencies) {
      if (!byId.has(dep)) continue;
      indegree.set(t.id, (indegree.get(t.id) ?? 0) + 1);
      dependents.get(dep)?.push(t.id);
    }
  }
  const queue = tasks.filter((t) => (indegree.get(t.id) ?? 0) === 0).map((t) => t.id);
  const order: PlannedTask[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const task = byId.get(id);
    if (task !== undefined) order.push(task);
    for (const next of dependents.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  if (order.length !== tasks.length) {
    throw new Error("topologicalSort: dependency cycle detected");
  }
  return order;
}

/**
 * Build a validated, topologically-sorted plan: estimate every task, validate
 * (throwing on any error), sort by dependencies, and sum total tokens.
 */
export function buildPlan(tasks: Task[]): Plan {
  const planned = estimateTasks(tasks);
  const errors = validatePlan(planned);
  if (errors.length > 0) {
    const detail = errors.map((e) => `${e.taskId}: ${e.message}`).join("; ");
    throw new Error(`buildPlan: invalid plan — ${detail}`);
  }
  const sorted = topologicalSort(planned);
  const totalTokens = sorted.reduce((sum, t) => sum + t.estimate.estimatedTokens, 0);
  return { tasks: sorted, totalTokens };
}
