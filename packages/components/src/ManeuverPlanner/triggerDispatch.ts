import {
  type DispatchCommandRefusal,
  dispatchActiveCommandTopic,
} from "@ksp-gonogo/sitrep-client";
import type { CommandRefusalEntry } from "@ksp-gonogo/ui-kit";
import { isSequence, type PlanResult } from "./planning";

const ADD_NODE = "vessel.maneuver.add";

/** What a refusal of a trigger-fired node is called, the same words the planner's own Add node press carries. */
export const TRIGGER_NODE_LABEL = "Add maneuver node";

/**
 * Sends each burn of a fired trigger's plan as its own node, and hands
 * `onRefused` every refusal once all of them have settled. It is not called
 * when every burn was taken.
 */
export function dispatchTriggerPlan(
  triggerId: string,
  plan: PlanResult,
  onRefused: (refusals: CommandRefusalEntry[]) => void,
): void {
  const burns = isSequence(plan) ? plan.burns : [plan];
  const settled = burns.map((b, index) => {
    // The burn's own numbers as arguments, so full precision reaches the command.
    const args = {
      ut: b.ut,
      prograde: b.prograde,
      normal: b.normal,
      radialOut: b.radial,
    };
    const outcome = dispatchActiveCommandTopic(ADD_NODE, args);
    if (!outcome.routed) return Promise.resolve(null);
    return outcome.settled.then((refusal) =>
      refusalEntry(`${triggerId}:${index}`, args, refusal),
    );
  });
  void Promise.all(settled).then((all) => {
    const refused = all.filter((r): r is CommandRefusalEntry => r !== null);
    if (refused.length > 0) onRefused(refused);
  });
}

/** A transport failure carries no typed reason, so only a refusal with one becomes an entry. */
function refusalEntry(
  id: string,
  args: unknown,
  refusal: DispatchCommandRefusal | undefined,
): CommandRefusalEntry | null {
  if (refusal?.errorCode === undefined) return null;
  return {
    id,
    command: ADD_NODE,
    args,
    label: TRIGGER_NODE_LABEL,
    errorCode: refusal.errorCode,
    detail: refusal.detail,
  };
}
