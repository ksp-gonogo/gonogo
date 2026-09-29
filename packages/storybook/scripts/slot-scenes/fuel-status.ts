import type { ExtensionScene } from "../coverage";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:fuel-status.sections",
    widgetId: "fuel-status",
    fixture:
      "packages/components/src/FuelStatus/__fixtures__/lander-monoprop-only.json",
    w: 8,
    h: 16,
  },
];
