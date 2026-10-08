import { type ActionDefinition, registerComponent } from "@ksp-gonogo/core";
import { ManeuverPlannerComponent } from "./ManeuverPlannerView";
import type { ManeuverPlannerConfig } from "./presets";
import { useManeuverEssentials } from "./useManeuverEssentials";

const maneuverActions = [] as const satisfies readonly ActionDefinition[];

/**
 * The whole-widget append slot below the preview and feasibility check, for
 * alternate transfer strategies such as a porkchop or an optimal-transfer
 * Uplink. Declaration-merged into `SlotRegistry` so the slot carries its exact
 * empty prop shape.
 */
export type ManeuverPlannerSectionsSlotProps = Record<string, never>;

registerComponent<ManeuverPlannerConfig>({
  id: "maneuver-planner",
  name: "Maneuver Planner",
  description:
    "Plan a maneuver node at the next apoapsis or periapsis, to circularise or with a burn of your own, with a preview of the new orbit and a check that your vessel has the Δv for it.",
  tags: ["telemetry", "planning"],
  defaultSize: { w: 10, h: 18 },
  // Seven columns so the preset picker shows its longest label in full.
  minSize: { w: 7, h: 9 },
  commands: [
    "vessel.maneuver.add",
    "vessel.maneuver.update",
    "vessel.maneuver.remove",
  ],
  component: ManeuverPlannerComponent,
  tiny: {
    title: "MANEUVER",
    useEssentials: useManeuverEssentials,
  },
  augmentSlots: ["maneuver-planner.sections"],
  // Apsides, countdowns and period are solved from these elements, so are not declared.
  dataRequirements: [
    "vessel.orbit.sma",
    "vessel.orbit.ecc",
    "vessel.orbit.inc",
    "vessel.orbit.lan",
    "vessel.orbit.argPe",
    "vessel.flight.orbitalSpeed",
    "vessel.orbit.referenceBodyIndex",
    "system.bodies",
    "vessel.identity.parentBodyIndex",
    "vessel.maneuver.nodes",
    "vessel.target",
    "vessel.propulsion",
    "system.frame",
    "dv.summary",
    "dv.stages",
    "vessel.structure",
  ],
  defaultConfig: { defaultPreset: "circularize-apo" },
  actions: maneuverActions,
  pushable: true,
  requires: ["flight"],
});

export { ManeuverPlannerComponent };
