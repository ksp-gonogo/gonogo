import type { ExtensionScene } from "../coverage";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:targeting.camera",
    widgetId: "targeting",
    fixture:
      "packages/components/src/Targeting/__fixtures__/docking-misaligned.json",
    w: 6,
    h: 9,
  },
  {
    id: "planted-slot:targeting.overlay",
    widgetId: "targeting",
    fixture:
      "packages/components/src/Targeting/__fixtures__/docking-misaligned.json",
    w: 6,
    h: 9,
  },
];
