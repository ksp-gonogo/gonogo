import type { ExtensionScene } from "../coverage";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:ship-map.overlay",
    widgetId: "ship-map",
    fixture:
      "packages/components/src/ShipMap/__fixtures__/probe/fuel-tank-bars-only.json",
    w: 8,
    h: 10,
  },
  {
    id: "planted-slot:ship-map.part-meters",
    widgetId: "ship-map",
    fixture:
      "packages/components/src/ShipMap/__fixtures__/probe/fuel-tank-bars-only.json",
    w: 10,
    h: 14,
    // A part's meters and status rows are drawn in its hover readout, on the root part the stub reads.
    hovers: [{ selector: 'g[aria-label^="Mk1 Command Pod"]' }],
  },
  {
    id: "planted-slot:ship-map.part-meta",
    widgetId: "ship-map",
    fixture:
      "packages/components/src/ShipMap/__fixtures__/probe/fuel-tank-bars-only.json",
    w: 10,
    h: 14,
    // A part's meters and status rows are drawn in its hover readout, on the root part the stub reads.
    hovers: [{ selector: 'g[aria-label^="Mk1 Command Pod"]' }],
  },
];
