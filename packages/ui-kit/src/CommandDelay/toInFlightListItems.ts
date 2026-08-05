import type { InFlightListItem } from "./InFlightList";

/**
 * Structural subset of `sitrep-client`'s `InFlightCommand` that this mapping
 * reads. Declared here (not imported) so `@ksp-gonogo/ui-kit` stays the
 * vanilla design system with no dependency back on the telemetry spine: the
 * real `InFlightCommand` satisfies this shape structurally at every call site.
 */
export interface InFlightCommandLike {
  id: string;
  label: string;
  command: string;
  reachEtaSeconds: number | null;
  replyEtaSeconds: number | null;
  predictedPhase: InFlightListItem["phase"];
}

/**
 * The single `InFlightCommand[] -> InFlightListItem[]` adapter every discrete
 * delayed-command widget shares (was copy-pasted verbatim into ActionGroup,
 * ManeuverPlanner, TargetPicker, RoboticsConsole, MechJeb, Navball,
 * ScienceOfficer, RotorTachometer). Which clock a row shows is phase-driven:
 * while `in-transit` the visible effect is the command REACHING the craft, so
 * it counts down to the reach eta; once it has arrived (any later phase) the
 * meaningful wait is the acknowledgement coming back, so it shows the reply
 * eta. `label` falls back to the raw command id when a dispatch carried none.
 */
export function toInFlightListItems(
  items: readonly InFlightCommandLike[],
): InFlightListItem[] {
  return items.map((item) => ({
    id: item.id,
    label: item.label || item.command,
    etaSeconds:
      item.predictedPhase === "in-transit"
        ? item.reachEtaSeconds
        : item.replyEtaSeconds,
    phase: item.predictedPhase,
  }));
}
