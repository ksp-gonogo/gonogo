import { dispatchActiveCommandTopic } from "@ksp-gonogo/sitrep-client";
import {
  COMMAND_UNDELIVERED,
  classifyCommandRejection,
} from "@ksp-gonogo/sitrep-sdk";
import type {
  CommandFailedEntry,
  CommandLossEntry,
  CommandRefusalEntry,
  CommandUndeliveredEntry,
} from "@ksp-gonogo/ui-kit";
import {
  computePlan,
  isSequence,
  type PlanInputs,
  type PlanResult,
} from "./planning";
import type { PresetId } from "./presets";
import type { NoPlanReason, TriggerFailure } from "./triggerTypes";

const ADD_NODE = "vessel.maneuver.add";

/** What a trigger-fired node is called in every outcome, the same words the planner's own Add node press carries. */
export const TRIGGER_NODE_LABEL = "Add maneuver node";

const TARGET_PRESETS: ReadonlySet<PresetId> = new Set([
  "hohmann-rendezvous-target",
  "match-target-inclination",
  "match-target-plane",
]);

/**
 * Computes a fired trigger's plan against the live orbit and sends each burn
 * as its own node. `onFailure` is called once: at once when no plan could be
 * computed, since nothing was sent, or when every burn has settled and any of
 * them was not taken. It is not called when every burn was taken.
 */
export function fireTriggerPlan(
  triggerId: string,
  inputs: PlanInputs,
  onFailure: (failure: TriggerFailure) => void,
): void {
  const planned = planFor(inputs);
  if ("reason" in planned) {
    onFailure({ kind: "no-plan", reason: planned.reason });
    return;
  }
  dispatchPlan(triggerId, planned.plan, onFailure);
}

function planFor(
  inputs: PlanInputs,
): { plan: PlanResult } | { reason: NoPlanReason } {
  try {
    const plan = computePlan(inputs);
    if (plan) return { plan };
  } catch {
    return { reason: "error" };
  }
  return { reason: noPlanReason(inputs) };
}

/** Which input was missing, as far as the inputs alone can say; anything past that is the plan's own. */
function noPlanReason(i: PlanInputs): NoPlanReason {
  if (!i.currentOrbit || i.currentUT === undefined || !(i.mu > 0)) {
    return "no-orbit";
  }
  if (TARGET_PRESETS.has(i.preset) && i.targetInclinationLive === undefined) {
    return "no-target";
  }
  return "not-computable";
}

function dispatchPlan(
  triggerId: string,
  plan: PlanResult,
  onFailure: (failure: TriggerFailure) => void,
): void {
  const burns = isSequence(plan) ? plan.burns : [plan];
  const refused: CommandRefusalEntry[] = [];
  const lost: CommandLossEntry[] = [];
  const undelivered: CommandUndeliveredEntry[] = [];
  const failed: CommandFailedEntry[] = [];
  const settled = burns.map((b, index) => {
    const dispatch: CommandLossEntry = {
      id: `${triggerId}:${index}`,
      command: ADD_NODE,
      // The burn's own numbers as arguments, so full precision reaches the command.
      args: {
        ut: b.ut,
        prograde: b.prograde,
        normal: b.normal,
        radialOut: b.radial,
      },
      label: TRIGGER_NODE_LABEL,
    };
    const outcome = dispatchActiveCommandTopic(ADD_NODE, dispatch.args);
    // No stream is mounted, so the node never left this machine.
    if (!outcome.routed) {
      undelivered.push(dispatch);
      return Promise.resolve();
    }
    return outcome.settled.then((rejection) => {
      if (rejection === undefined) return;
      const classified = classifyCommandRejection(rejection);
      if (classified.kind === "refused") {
        refused.push({
          ...dispatch,
          errorCode: classified.errorCode,
          detail: classified.detail,
        });
        return;
      }
      if (classified.kind === "lost") {
        lost.push(dispatch);
        return;
      }
      if (classified.code === COMMAND_UNDELIVERED) {
        undelivered.push(dispatch);
        return;
      }
      failed.push(dispatch);
    });
  });
  void Promise.all(settled).then(() => {
    const missed =
      refused.length + lost.length + undelivered.length + failed.length;
    if (missed === 0) return;
    onFailure({ kind: "dispatch", refused, lost, undelivered, failed });
  });
}
