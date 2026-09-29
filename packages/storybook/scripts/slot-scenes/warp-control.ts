import type { ExtensionScene } from "../coverage";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:warp-control.stepper",
    widgetId: "warp-control",
    fixture:
      "packages/components/src/WarpControl/__fixtures__/rails-warp-1000x.json",
    w: 8,
    h: 6,
  },
];
