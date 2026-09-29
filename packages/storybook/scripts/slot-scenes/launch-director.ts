import type { ExtensionScene } from "../coverage";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:launch-director.preflight",
    widgetId: "launch-director",
    fixture:
      "packages/components/src/LaunchDirector/__fixtures__/pad-occupied.json",
    w: 7,
    h: 14,
  },
  {
    id: "planted-slot:launch-director.pad",
    widgetId: "launch-director",
    fixture:
      "packages/components/src/LaunchDirector/__fixtures__/pad-occupied.json",
    w: 7,
    h: 10,
  },
];
