import type { ExtensionScene } from "../coverage";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:transfer-window.sections",
    widgetId: "transfer-window",
    fixture:
      "packages/components/src/TransferWindow/__fixtures__/earth-mars-go.json",
    w: 12,
    h: 36,
  },
];
