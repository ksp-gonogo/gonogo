import type { ExtensionScene } from "../coverage";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:rendezvous.camera",
    widgetId: "rendezvous",
    fixture:
      "packages/components/src/Rendezvous/__fixtures__/docking-misaligned.json",
    w: 6,
    h: 9,
  },
  {
    id: "planted-slot:rendezvous.overlay",
    widgetId: "rendezvous",
    fixture:
      "packages/components/src/Rendezvous/__fixtures__/docking-misaligned.json",
    w: 6,
    h: 9,
  },
];
