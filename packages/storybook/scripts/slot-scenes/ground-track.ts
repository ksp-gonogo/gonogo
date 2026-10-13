import type { ExtensionScene } from "../coverage";

const FIXTURE =
  "packages/components/src/GroundTrack/__fixtures__/kerbin-lko-equator.json";

export const SCENES: readonly ExtensionScene[] = [
  "ground-track.overlay",
  "ground-track.base",
  "ground-track.sections",
  "ground-track.actions",
].map((slot) => ({
  id: `planted-slot:${slot}`,
  widgetId: "ground-track",
  fixture: FIXTURE,
  w: 12,
  h: 14,
}));
