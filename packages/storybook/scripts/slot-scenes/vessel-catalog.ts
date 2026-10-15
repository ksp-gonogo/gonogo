import type { ExtensionScene } from "../coverage";

const FIXTURE =
  "packages/components/src/VesselCatalog/__fixtures__/mixed-fleet.json";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:vessel-catalog.updates",
    widgetId: "vessel-catalog",
    fixture: FIXTURE,
    w: 8,
    h: 10,
  },
];
