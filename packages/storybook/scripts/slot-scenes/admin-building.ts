import type { ExtensionScene } from "../coverage";

const FIXTURE =
  "packages/components/scripts/probe/slot-fixtures/admin-building.screen-body.json";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:admin-building.screens",
    widgetId: "admin-building",
    fixture: FIXTURE,
    w: 6,
    h: 14,
  },
  {
    id: "planted-slot:admin-building.screen-body",
    widgetId: "admin-building",
    fixture: FIXTURE,
    w: 6,
    h: 14,
  },
];
