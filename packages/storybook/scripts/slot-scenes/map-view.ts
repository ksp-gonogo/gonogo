import type { ExtensionScene } from "../coverage";

const FIXTURE =
  "packages/components/src/MapView/__fixtures__/kerbin-lko-equator.json";

export const SCENES: readonly ExtensionScene[] = [
  "map-view.overlay",
  "map-view.base",
  "map-view.sections",
  "map-view.actions",
].map((slot) => ({
  id: `planted-slot:${slot}`,
  widgetId: "map-view",
  fixture: FIXTURE,
  w: 12,
  h: 14,
}));
