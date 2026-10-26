import { routeInput } from "../ba/routing";
import type { ClassifiedInput, RoutingTarget } from "../ba/types";
import type { OrchestrationDecision, StageAction } from "./types";

/** Map a routing target to the orchestration stage action. */
function actionFor(target: RoutingTarget): StageAction["action"] {
  switch (target.kind) {
    case "pm":
      return "plan";
    case "ulw":
      return "execute";
    case "ba":
      return "answer";
    case "meta":
      return "meta";
    case "ignore":
      return "ignore";
  }
}

/**
 * Route a classified input to the correct orchestration stages. Thin wrapper
 * over ba/routing: reuses `routeInput` and maps each target to a stage action.
 */
export function routeUserInput(input: ClassifiedInput): OrchestrationDecision {
  const routed = routeInput(input);
  const actions: StageAction[] = routed.map((r) => ({
    atom: r.atom,
    action: actionFor(r.target),
  }));
  const needsConfirmation = routed.some((r) => r.needsConfirmation);
  const fastPath = routed.length > 0 && routed.every((r) => r.target.kind === "ulw");
  return { actions, needsConfirmation, fastPath };
}
