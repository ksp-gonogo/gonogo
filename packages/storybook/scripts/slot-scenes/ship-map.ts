import type { ExtensionScene } from "../coverage";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:ship-map.overlay",
    widgetId: "ship-map",
    fixture:
      "packages/components/src/ShipMap/__fixtures__/probe/fuel-tank-bars-only.json",
    w: 8,
    h: 10,
  },
];
