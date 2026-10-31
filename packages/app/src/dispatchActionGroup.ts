import {
  actionGroupIdOf,
  actionGroupsFrom,
  buildToggleArgs,
  resolveGroupValue,
  TOGGLE_INVALID,
  toggleCommandFor,
} from "@ksp-gonogo/core";
import {
  type DispatchCommandRefusal,
  dispatchActiveCommandTopic,
  sampleActiveReading,
} from "@ksp-gonogo/sitrep-client";
import type { TopicReading, VesselControl } from "@ksp-gonogo/sitrep-sdk";

/**
 * What came of one action group dispatch: either it went, or the reason it did
 * not, in words the operator's own row can carry.
 */
export type ActionGroupDispatch =
  | { routed: true; settled: Promise<DispatchCommandRefusal | undefined> }
  | { routed: false; refusal: string };

/**
 * Why a toggle had nothing safe to invert, separating the two conditions a
 * bare payload cannot tell apart: a reading that is merely old, and one that
 * never came. Both end in the same refusal, and an operator chasing a group
 * that did not move needs to know which.
 */
function toggleRefusal(
  groupName: string,
  state: TopicReading<VesselControl>["state"],
): string {
  if (state === "held") {
    return `"${groupName}": the vessel.control reading is held, and a toggle needs a current state to invert`;
  }
  if (state === "observed") {
    return `"${groupName}": the vessel reports no state for this group`;
  }
  return `"${groupName}": no vessel.control reading has arrived, so there is nothing to invert`;
}

/**
 * Fire one action group, named by the id a save spells it with, through the
 * same command the ActionGroup widget's pill sends.
 *
 * Resolves the id against the live registry, because the custom half of it is
 * whatever the elected backend reports: an id naming a group this vessel does
 * not have resolves to nothing and dispatches nothing, which is the honest
 * answer for a saved action whose group is gone.
 *
 * The toggle-to-absolute bridge inverts the group's current state, so the read
 * is `sampleActiveReading` rather than `sampleActiveTopic`: the store is
 * hold-last and keeps a released topic's final payload for the life of the
 * epoch, so a bare payload cannot say whether the state it carries is the
 * vessel's now or the one a widget last saw before it unmounted. Only an
 * `observed` reading is inverted. `vessel.control` has no relative form to fall
 * back on (every actuation command in the contract is an absolute set, which is
 * the point of the toggle-to-absolute bridge existing at all), so a held
 * reading refuses.
 *
 * The group names are taken off a held reading too, the same way
 * `useActionGroups` does: "AG1: Solar Panels" is still called that whatever the
 * link is doing. Only the value decays.
 */
export function dispatchActionGroup(
  actionGroupId: string,
): ActionGroupDispatch {
  const reading = sampleActiveReading<VesselControl>("vessel.control");
  const named =
    reading.state === "observed" || reading.state === "held"
      ? reading.value
      : undefined;
  const group = actionGroupsFrom(named?.actionGroups).find(
    (g) => actionGroupIdOf(g) === actionGroupId,
  );
  if (!group) {
    return {
      routed: false,
      refusal: `no action group "${actionGroupId}" on this vessel`,
    };
  }
  const command = toggleCommandFor(group);
  if (command === null) {
    return { routed: false, refusal: `"${group.name}" has no command to fire` };
  }
  const current = reading.state === "observed" ? reading.value : undefined;
  const args = buildToggleArgs(group, resolveGroupValue(group, current));
  if (args === TOGGLE_INVALID) {
    return { routed: false, refusal: toggleRefusal(group.name, reading.state) };
  }
  const outcome = dispatchActiveCommandTopic(command, args);
  return outcome.routed
    ? outcome
    : { routed: false, refusal: "no telemetry stream carried the command" };
}
