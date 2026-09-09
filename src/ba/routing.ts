import type {
  ClassifiedInput,
  IntentClass,
  RoutedAtom,
  RoutingTarget,
} from "./types";

/** Map each intent class to its routing target (from the plan). */
export function routeIntent(type: IntentClass): RoutingTarget {
  switch (type) {
    case "NEW_GOAL":
    case "CHANGE_REQUEST":
    case "FEEDBACK":
    case "BUG_DEBUG":
    case "PROCESS_FEEDBACK":
    case "CANCEL_SCOPE":
      return { kind: "pm" };
    case "NEXT_STEP":
    case "CONTINUE":
      return { kind: "ulw" };
    case "QUESTION":
    case "COMPLAINT":
    case "CONTEXT_DUMP":
    case "PREFERENCE":
    case "STATUS_INQUIRY":
      return { kind: "ba" };
    case "META":
      return { kind: "meta" };
    case "NOISE":
      return { kind: "ignore" };
  }
}

/** Fast-path classes proceed without confirmation. */
export function isFastPath(type: IntentClass): boolean {
  return type === "CONTINUE" || type === "NEXT_STEP";
}

/** Route every atom in the classified input to a target. */
export function routeInput(input: ClassifiedInput): RoutedAtom[] {
  return input.intents.map((atom) => ({
    atom,
    target: routeIntent(atom.type),
    needsConfirmation: !isFastPath(atom.type),
  }));
}
