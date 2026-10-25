import type { Store } from "../kb";
import type { OmoSession, RunResult } from "./omo";

export interface WorkItemResult {
  run: RunResult;
  /** Id of the closure written during this work item, or null if none was. */
  closureId: string | null;
  planId: string | null;
  newLessons: string[];
  /** How many reminders the runner had to send before a closure appeared. */
  nudges: number;
  /** Problems found by re-validating the store after the run (empty when clean). */
  problems: { path: string; errors: string[] }[];
}

const NUDGE =
  "The work is not recorded yet. Follow the emo-closure skill now: write any lessons with `emo lesson add`, " +
  "then write the closure with `emo close --plan <plan-id> ...` (find the plan id with `emo list plan`). " +
  "Do not say it is done until `emo list closure` shows the new closure.";

const ids = (store: Store, kind: "closure" | "lesson" | "plan"): Set<string> =>
  new Set(store.list(kind).map((d) => d.id));

/**
 * Run one unit of work (one ulw-loop run = one plan item) and make sure it leaves a closure.
 * The agent's own word is not enough: the runner checks the store and reminds the agent.
 */
export async function runWorkItem(opts: {
  omo: OmoSession;
  store: Store;
  task: string;
  /** Reminders allowed when no closure was written. Default 2. */
  maxNudges?: number;
}): Promise<WorkItemResult> {
  const { omo, store } = opts;
  const closuresBefore = ids(store, "closure");
  const lessonsBefore = ids(store, "lesson");
  const plansBefore = ids(store, "plan");

  let run = await omo.prompt(opts.task);
  let nudges = 0;
  const newClosure = (): string | null => [...ids(store, "closure")].find((id) => !closuresBefore.has(id)) ?? null;

  while (newClosure() === null && run.error === null && nudges < (opts.maxNudges ?? 2)) {
    nudges++;
    run = await omo.prompt(NUDGE);
  }

  const closureId = newClosure();
  const closurePlan = closureId === null ? null : (store.get(closureId)?.frontmatter.plan ?? null);
  const newPlans = [...ids(store, "plan")].filter((id) => !plansBefore.has(id));
  return {
    run,
    closureId,
    planId: typeof closurePlan === "string" ? closurePlan : (newPlans.at(-1) ?? null),
    newLessons: [...ids(store, "lesson")].filter((id) => !lessonsBefore.has(id)),
    nudges,
    problems: store.validateAll(),
  };
}
