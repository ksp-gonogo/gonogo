import type { ExtensionScene } from "../coverage";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:space-center-status.sections",
    widgetId: "space-center-status",
    fixture:
      "packages/components/src/SpaceCenterStatus/__fixtures__/mid-career-mixed.json",
    w: 8,
    h: 15,
  },
];
