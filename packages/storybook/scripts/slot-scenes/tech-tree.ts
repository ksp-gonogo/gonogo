import type { ExtensionScene } from "../coverage";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:tech-tree.sections",
    widgetId: "tech-tree",
    fixture:
      "packages/components/src/TechTree/__fixtures__/small-career-detail.json",
    w: 8,
    h: 15,
  },
];
