import type { ExtensionScene } from "../coverage";

const FIXTURE =
  "packages/components/src/LandingStatus/__fixtures__/suicide-burn-approaching.json";

export const SCENES: readonly ExtensionScene[] = [
  "landing-status.sections",
  "landing-status.actions",
  "plots",
].map((slot) => ({
  id: `planted-slot:${slot}`,
  widgetId: "landing-status",
  fixture: FIXTURE,
  w: 10,
  h: 36, // `.sections` and a contributed plot draw under everything else the widget draws; at h:14 they sit well below the tile's visible box.
}));
