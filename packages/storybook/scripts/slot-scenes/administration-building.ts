import type { ExtensionScene } from "../coverage";

const FIXTURE =
  "packages/components/scripts/probe/slot-fixtures/administration-building.screen-body.json";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:administration-building.screens",
    widgetId: "administration-building",
    fixture: FIXTURE,
    w: 6,
    h: 14,
  },
  {
    id: "planted-slot:administration-building.screen-body",
    widgetId: "administration-building",
    fixture: FIXTURE,
    w: 6,
    h: 14,
  },
];
