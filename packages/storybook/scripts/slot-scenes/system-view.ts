import type { ExtensionScene } from "../coverage";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:system-view.overlay",
    widgetId: "system-view",
    fixture:
      "packages/components/src/SystemView/__fixtures__/kerbin-orbit-comms-active.json",
    w: 10,
    h: 12,
  },
  {
    // Wide enough that the panel header keeps its actions in view instead of folding them away.
    id: "planted-slot:system-view.actions",
    widgetId: "system-view",
    fixture:
      "packages/components/src/SystemView/__fixtures__/kerbin-orbit-comms-active.json",
    w: 24,
    h: 18,
  },
  {
    // Pinned to the stub's own projection, which the host's stock entries do not include.
    id: "planted-slot:system-view.projection",
    widgetId: "system-view",
    fixture:
      "packages/components/src/SystemView/__fixtures__/kerbin-orbit-comms-active.json",
    w: 12,
    h: 14,
    config: { projection: "planted-slot-projection:1" },
  },
];
