import type { ExtensionScene } from "../coverage";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:action-group.subsystem",
    widgetId: "action-group",
    fixture:
      "packages/components/src/ActionGroup/__fixtures__/ag1-parachutes-armed.json",
    w: 6,
    h: 6,
    config: { actionGroupId: "AG1", label: "Chutes" },
  },
];
