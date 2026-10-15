import type { ExtensionScene } from "../coverage";

const FIXTURE =
  "packages/components/src/FleetRoster/__fixtures__/mixed-fleet.json";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:fleet-roster.updates",
    widgetId: "fleet-roster",
    fixture: FIXTURE,
    w: 8,
    h: 10,
  },
];
