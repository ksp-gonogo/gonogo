import type { ExtensionScene } from "../coverage";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:maneuver-planner.sections",
    widgetId: "maneuver-planner",
    fixture:
      "packages/components/src/ManeuverPlanner/__fixtures__/kerbin-suborbital-prograde-node.json",
    w: 10,
    h: 20,
  },
];
