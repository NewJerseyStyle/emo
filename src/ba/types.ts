/** BA (Business Analyst) taxonomy and routing types. */

/** The 15 atomic intent classes the BA recognizes. */
export type IntentClass =
  | "NEW_GOAL"
  | "NEXT_STEP"
  | "CHANGE_REQUEST"
  | "FEEDBACK"
  | "BUG_DEBUG"
  | "QUESTION"
  | "COMPLAINT"
  | "CONTEXT_DUMP"
  | "PREFERENCE"
  | "PROCESS_FEEDBACK"
  | "STATUS_INQUIRY"
  | "CONTINUE"
  | "CANCEL_SCOPE"
  | "META"
  | "NOISE";

/** A single atomic intent decomposed from the user's input. */
export interface IntentAtom {
  type: IntentClass;
  summary: string;
  /** Model confidence in this classification, 0-1. */
  confidence: number;
}

/** The BA's structured classification of a user message. */
export interface ClassifiedInput {
  intents: IntentAtom[];
  needsClarification: boolean;
  guidance?: string;
}

/** Where a routed atom should be dispatched. */
export type RoutingTarget =
  | { kind: "pm" }
  | { kind: "ulw" }
  | { kind: "ba" }
  | { kind: "meta" }
  | { kind: "ignore" };

/** An atom paired with its routing decision. */
export interface RoutedAtom {
  atom: IntentAtom;
  target: RoutingTarget;
  needsConfirmation: boolean;
}

/** The 4F stress response the BA may detect in user text. */
export type FourF = "fight" | "flight" | "freeze" | "fawn" | null;

/** Output language for BA-generated text (soothing, etc.). */
export type Language = "zh-TW" | "en";
