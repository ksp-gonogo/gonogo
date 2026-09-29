import type { ExtensionScene } from "../coverage";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:orbit-view.overlay",
    widgetId: "orbit-view",
    fixture:
      "packages/components/src/OrbitView/__fixtures__/eccentric-kerbin.json",
    w: 9,
    h: 12,
  },
];
