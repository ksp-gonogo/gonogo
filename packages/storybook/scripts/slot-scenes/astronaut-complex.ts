import type { ExtensionScene } from "../coverage";

const FIXTURE =
  "packages/components/src/AstronautComplex/__render__/mid-career-pool.json";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:astronaut-complex.crew",
    widgetId: "astronaut-complex",
    fixture: FIXTURE,
    w: 12,
    h: 14,
  },
  {
    id: "planted-slot:astronaut-complex.crew-badge",
    widgetId: "astronaut-complex",
    fixture: FIXTURE,
    w: 12,
    h: 14,
  },
  {
    id: "planted-slot:astronaut-complex.tab",
    widgetId: "astronaut-complex",
    fixture: FIXTURE,
    w: 12,
    h: 14,
    clicks: [{ selector: 'button[aria-controls$="augment-panel"]' }],
  },
];
