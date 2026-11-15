import type { ExtensionScene } from "../coverage";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:vessel-schematic.overlay",
    widgetId: "vessel-schematic",
    fixture:
      "packages/components/src/VesselSchematic/__fixtures__/probe/fuel-tank-bars-only.json",
    w: 8,
    h: 10,
  },
  {
    id: "planted-slot:vessel-schematic.part-meters",
    widgetId: "vessel-schematic",
    fixture:
      "packages/components/src/VesselSchematic/__fixtures__/probe/fuel-tank-bars-only.json",
    w: 10,
    h: 14,
    // A part's meters and status rows are drawn in its hover readout, on the root part the stub reads.
    hovers: [{ selector: 'g[aria-label^="Mk1 Command Pod"]' }],
  },
  {
    id: "planted-slot:vessel-schematic.part-meta",
    widgetId: "vessel-schematic",
    fixture:
      "packages/components/src/VesselSchematic/__fixtures__/probe/fuel-tank-bars-only.json",
    w: 10,
    h: 14,
    // A part's meters and status rows are drawn in its hover readout, on the root part the stub reads.
    hovers: [{ selector: 'g[aria-label^="Mk1 Command Pod"]' }],
  },
];
