import type { ExtensionScene } from "../coverage";

const FIXTURE =
  "packages/components/src/Experiments/__fixtures__/instruments-holding-data.json";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:experiments.instrument",
    widgetId: "experiments",
    fixture: FIXTURE,
    w: 6,
    h: 10,
  },
  {
    id: "planted-slot:experiments.actions",
    widgetId: "experiments",
    fixture: FIXTURE,
    w: 10,
    h: 8,
  },
];
