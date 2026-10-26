import type { ComplexityLevel, PlannedTask, Task, TokenEstimate } from "./types";

/** Reasoning budget per complexity level (analogous to PM man-days). */
const REASONING_BUDGET: Record<ComplexityLevel, number> = {
  low: 2000,
  medium: 5000,
  high: 10000,
};

/** Confidence per complexity level (higher complexity → lower confidence). */
const CONFIDENCE: Record<ComplexityLevel, number> = {
  low: 0.9,
  medium: 0.7,
  high: 0.5,
};

/**
 * Estimate the token cost of a single task.
 * estimatedTokens = docTokens + codeTokens + reasoningBudget(complexity).
 */
export function estimateTask(task: Task): TokenEstimate {
  const reasoningBudget = REASONING_BUDGET[task.complexity];
  return {
    estimatedTokens: task.docTokens + task.codeTokens + reasoningBudget,
    reasoningBudget,
    confidence: CONFIDENCE[task.complexity],
  };
}

/** Map every task to a PlannedTask carrying its token estimate. */
export function estimateTasks(tasks: Task[]): PlannedTask[] {
  return tasks.map((t) => ({ ...t, estimate: estimateTask(t) }));
}
