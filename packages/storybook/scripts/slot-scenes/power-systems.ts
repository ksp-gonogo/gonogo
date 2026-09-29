import type { ExtensionScene } from "../coverage";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:power-systems.sections",
    widgetId: "power-systems",
    fixture:
      "packages/components/src/PowerSystems/__fixtures__/03-solar-charging-sunlight.json",
    w: 8,
    h: 14,
  },
];
