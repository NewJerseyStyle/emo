import type { IntentAtom } from "../ba/types";

/** A routed atom paired with the orchestration stage it should enter. */
export type StageAction = {
  atom: IntentAtom;
  action: "plan" | "execute" | "answer" | "meta" | "ignore";
};

/** The orchestration decision for a classified user input. */
export interface OrchestrationDecision {
  actions: StageAction[];
  /** True when any atom needs user confirmation before proceeding. */
  needsConfirmation: boolean;
  /** True when every atom is a fast-path ulw (execute) atom. */
  fastPath: boolean;
}

/** A single Lessons Learned entry (what / why / differently). */
export interface Lesson {
  what: string;
  why: string;
  differently: string;
}

/** Inputs required to build and write a phase closure document. */
export interface ClosureInput {
  phase: string;
  tokensSaved: number;
  /** Optional id of the phase this closure supersedes. */
  supersedes?: string;
  summary: string;
  estimatedTokens: number;
  actualTokens: number;
  deliverables: string[];
  issues: string[];
  risks: string[];
  lessons: Lesson[];
  value: string;
  handover: string;
}
