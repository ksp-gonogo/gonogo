import type { ExtensionScene } from "../coverage";

const FIXTURE =
  "packages/components/src/CrewStatus/__fixtures__/valentina-solo-orbit.json";

export const SCENES: readonly ExtensionScene[] = [
  "crew-status.row-badges",
  "crew-status.avatar",
  "crew-status.summary",
].map((slot) => ({
  id: `planted-slot:${slot}`,
  widgetId: "crew-status",
  fixture: FIXTURE,
  w: 9,
  h: 10,
}));
