/** PM (Project Manager) planning and token-estimation types. */

/**
 * Task complexity derived from the MHC (Model of Hierarchical Complexity)
 * scale: low = concrete/abstract (8-9), medium = formal/systematic (10-11),
 * high = metasystematic/paradigmatic (12-13).
 */
export type ComplexityLevel = "low" | "medium" | "high";

/** A concrete development task planned by the PM. */
export interface Task {
  id: string;
  title: string;
  /** Estimated documentation tokens (spec, comments, prose). */
  docTokens: number;
  /** Estimated code tokens (implementation). */
  codeTokens: number;
  complexity: ComplexityLevel;
  /** Ids of tasks that must complete before this one. */
  dependencies: string[];
}

/** Token-cost estimate for a single task. */
export interface TokenEstimate {
  /** Total estimated tokens = docTokens + codeTokens + reasoningBudget. */
  estimatedTokens: number;
  /** Tokens reserved for reasoning/planning at this complexity. */
  reasoningBudget: number;
  /** Model confidence in the estimate, 0-1. */
  confidence: number;
}

/** A task paired with its token estimate. */
export interface PlannedTask extends Task {
  estimate: TokenEstimate;
}

/** A validated, topologically-sorted plan. */
export interface Plan {
  tasks: PlannedTask[];
  /** Sum of every task's estimatedTokens. */
  totalTokens: number;
}

/** A validation failure found in a task set. */
export interface PlanError {
  taskId: string;
  message: string;
}
