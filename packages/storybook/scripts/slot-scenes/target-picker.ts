import type { ExtensionScene } from "../coverage";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:target-picker.sections",
    widgetId: "target-picker",
    fixture:
      "packages/components/src/TargetPicker/__fixtures__/lko-station-target.json",
    w: 6,
    h: 12,
  },
];
