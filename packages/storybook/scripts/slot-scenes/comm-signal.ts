import type { ExtensionScene } from "../coverage";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:comm-signal.sections",
    widgetId: "comm-signal",
    fixture:
      "packages/components/src/CommSignal/__fixtures__/strong-direct-ksc.json",
    w: 6,
    h: 7,
  },
  {
    // A rate shows on a hop of the route, so the scene needs a route with hops and room to draw it.
    id: "planted-slot:comm-signal.hop-rates",
    widgetId: "comm-signal",
    fixture:
      "packages/components/src/CommSignal/__fixtures__/relay-network-multi-hop.json",
    w: 8,
    h: 10,
  },
];
