import type { ShipBounds } from "./shipLayout";
import type {
  ShipMapPart,
  ShipMapPartMetaEntry,
  ShipMapPartMeterEntry,
} from "./shipTopology";

/**
 * Props for `ship-map.overlay`, a layer over the part diagram carrying its
 * base-frame projection. Project a part at metre-space `(lat, axial)` with
 *   x = width / 2 + (lat - bounds.cx) * baseScale
 *   y = height / 2 - (axial - bounds.cy) * baseScale
 * This is the identity-camera frame; the live zoom/pan is not reflected.
 */
export interface ShipMapOverlayContext {
  /** The projected parts (per-part `lat`/`axial`/`flightId`/geometry). */
  parts: readonly ShipMapPart[];
  /** Overlay layer width in px (matches the diagram canvas). */
  width: number;
  /** Overlay layer height in px (matches the diagram canvas). */
  height: number;
  /** Metre-space fit bounds of the projected vessel. */
  bounds: ShipBounds;
  /** Base (identity-camera) metres→px scale. */
  baseScale: number;
  /** Screen-space margin (px) reserved around the fit-scaled diagram. */
  padding: number;
}

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "ship-map.overlay": ShipMapOverlayContext;
  }

  // Two typed slots, each fed by the built-in contribution and any Uplink's on equal footing.
  interface ContributionRegistry {
    "ship-map.part-meters": {
      entry: ShipMapPartMeterEntry;
      topics: "vessel.parts";
    };
    "ship-map.part-meta": {
      entry: ShipMapPartMetaEntry;
    };
  }
}
