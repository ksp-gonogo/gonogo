import type { ExtensionScene } from "../coverage";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:tracking-station.overlay",
    widgetId: "tracking-station",
    fixture:
      "packages/components/src/TrackingStation/__fixtures__/kerbin-orbit-comms-active.json",
    w: 10,
    h: 12,
  },
  {
    // Wide enough that the panel header keeps its actions in view instead of folding them away.
    id: "planted-slot:tracking-station.actions",
    widgetId: "tracking-station",
    fixture:
      "packages/components/src/TrackingStation/__fixtures__/kerbin-orbit-comms-active.json",
    w: 24,
    h: 18,
  },
  {
    // Pinned to the stub's own projection, which the host's stock entries do not include.
    id: "planted-slot:tracking-station.projection",
    widgetId: "tracking-station",
    fixture:
      "packages/components/src/TrackingStation/__fixtures__/kerbin-orbit-comms-active.json",
    w: 12,
    h: 14,
    config: { projection: "planted-slot-projection:1" },
  },
];
