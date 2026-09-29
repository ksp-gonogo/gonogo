import type { ExtensionScene } from "../coverage";

const FIXTURE =
  "packages/components/scripts/probe/slot-fixtures/strategies.screen-body.json";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted:planted-slots-strategies-screen",
    widgetId: "strategies",
    fixture: FIXTURE,
    w: 6,
    h: 14,
  },
  {
    id: "planted-slot:strategies.screen-body",
    widgetId: "strategies",
    fixture: FIXTURE,
    w: 6,
    h: 14,
  },
];
