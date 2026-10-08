import type { ExtensionScene } from "../coverage";

export const SCENES: readonly ExtensionScene[] = [
  {
    // One stub row per kerbal aboard, so the tile is tall enough for both.
    id: "planted-slot:science-data.aboard-row",
    widgetId: "science-data",
    fixture:
      "packages/components/src/ScienceData/__fixtures__/kerbin-flight-partial-science.json",
    w: 8,
    h: 16,
  },
];
