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

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "maneuver-planner.sections": ManeuverPlannerSectionsSlotProps;
  }
}

registerComponent<ManeuverPlannerConfig>({
  id: "maneuver-planner",
  name: "Maneuver Planner",
  description:
    "Plan maneuver nodes: circularise / custom ΔV at next apsis, with live preview + feasibility check against vessel ΔV.",
  tags: ["telemetry", "planning"],
  defaultSize: { w: 10, h: 18 },
  minSize: { w: 3, h: 4 },
  component: ManeuverPlannerComponent,
  tiny: {
    title: "MANEUVER",
    // Seven columns so the preset picker shows its longest label in full.
    bodyMinSize: { w: 7, h: 9 },
    useEssentials: useManeuverEssentials,
  },
  augmentSlots: ["maneuver-planner.sections"],
  /*
   * Apsides, countdowns and period are solved from these elements, so are not
   * declared. `vessel.target` is not declared either: with nothing targeted the
   * wire tombstones it, and a badge would mark the whole panel NO DATA.
   */
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
    "dv.stages",
  ],
  defaultConfig: { defaultPreset: "circularize-apo" },
  actions: maneuverActions,
  pushable: true,
  requires: ["flight"],
});

export { ManeuverPlannerComponent };
