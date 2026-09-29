import type { ExtensionScene } from "../coverage";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:system-view.overlay",
    widgetId: "system-view",
    fixture:
      "packages/components/src/SystemView/__fixtures__/kerbin-orbit-comms-active.json",
    w: 10,
    h: 12,
  },
];
