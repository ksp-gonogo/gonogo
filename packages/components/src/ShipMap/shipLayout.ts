import { ENGINE_FLAME_BODY_FRACTION } from "./partOverlays";
import type { ShipMapPart } from "./shipTopology";

export interface BodyBox {
  latMin: number;
  latMax: number;
  axialMin: number;
  axialMax: number;
}

export interface ProjectedPart extends ShipMapPart {
  body: BodyBox;
  /** Distance from the spine: used for back-to-front draw ordering. */
  spineDist: number;
}

/** Screen-space margin (px) reserved around the fit-scaled diagram. */
export const SHIP_DIAGRAM_PADDING = 24;

/** Metre-space fit bounds of the projected vessel (see {@link project}). */
export interface ShipBounds {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/**
 * Base (identity-camera) metres-to-px scale fitting `bounds` into the
 * viewport with {@link SHIP_DIAGRAM_PADDING}. Shared by the diagram's render
 * and the `ship-map.overlay` slot props so both use one coordinate space.
 */
export function computeShipBaseScale(
  bounds: { w: number; h: number },
  width: number,
  height: number,
): number {
  return Math.min(
    (width - SHIP_DIAGRAM_PADDING * 2) / Math.max(bounds.w, 0.001),
    (height - SHIP_DIAGRAM_PADDING * 2) / Math.max(bounds.h, 0.001),
  );
}

/** The base-frame layout an overlay augment needs to draw in the diagram's space. */
export interface ShipBaseLayout {
  bounds: ShipBounds;
  baseScale: number;
  padding: number;
}

/**
 * The diagram's base-frame layout (fit bounds and scale), exactly as
 * `ShipDiagramSvg` computes it, for the `ship-map.overlay` slot. The live
 * zoom/pan is layered on at render time and is not reflected here.
 */
export function computeShipLayout(
  parts: readonly ShipMapPart[],
  width: number,
  height: number,
): ShipBaseLayout {
  const { bounds } = project(parts);
  return {
    bounds,
    baseScale: computeShipBaseScale(bounds, width, height),
    padding: SHIP_DIAGRAM_PADDING,
  };
}

/**
 * Half-sizes, in metres, of the axis-aligned box a part covers in the diagram
 * once its upright box is turned by `rotationRad`. `latHalfExtent` and
 * `axialHalfExtent` are measured across and along the part's own up direction,
 * so a part turned off the spine reaches further than either on screen.
 */
export function drawnHalfExtent(p: ShipMapPart): {
  lat: number;
  axial: number;
} {
  const c = Math.abs(Math.cos(p.rotationRad));
  const s = Math.abs(Math.sin(p.rotationRad));
  return {
    lat: p.latHalfExtent * c + p.axialHalfExtent * s,
    axial: p.latHalfExtent * s + p.axialHalfExtent * c,
  };
}

/** Metre-space margin below an active engine for its flame, the same fraction of the body its flame draws. */
function engineFlameReach(p: ShipMapPart, axialExtent: number): number {
  if (p.type !== "engine") return 0;
  const firing = p.partState?.some(
    (m) => m.type === "engine" && m.state === "active",
  );
  return firing ? axialExtent * ENGINE_FLAME_BODY_FRACTION : 0;
}

export function project(parts: readonly ShipMapPart[]) {
  if (parts.length === 0) {
    return {
      projected: [] as ProjectedPart[],
      stages: [] as number[],
      edges: [] as { a: ProjectedPart; b: ProjectedPart }[],
      bounds: { cx: 0, cy: 0, w: 1, h: 1 },
    };
  }

  const projected: ProjectedPart[] = parts.map(withBody);

  const stages = projected
    .filter((p) => p.type === "decoupler")
    .map((p) => p.axial);

  const edges: { a: ProjectedPart; b: ProjectedPart }[] = [];
  const projById = new Map(projected.map((p) => [p.flightId, p]));
  for (const p of projected) {
    if (p.parentFlightId == null) continue;
    const parent = projById.get(p.parentFlightId);
    if (parent) edges.push({ a: p, b: parent });
  }

  /* A launch clamp is a pad tower beside or below the craft; it is left out of the fit unless nothing else is there, so it does not shrink the vessel. */
  const fitted = projected.some((p) => p.type !== "clamp")
    ? projected.filter((p) => p.type !== "clamp")
    : projected;
  let minL = Infinity;
  let maxL = -Infinity;
  let minA = Infinity;
  let maxA = -Infinity;
  for (const p of fitted) {
    const half = drawnHalfExtent(p);
    minL = Math.min(minL, p.lat - half.lat);
    maxL = Math.max(maxL, p.lat + half.lat);
    // Flames escape the body box, so the same fraction of the metre-space extent is reserved or they clip at fit zoom.
    const axialExtent = p.body.axialMax - p.body.axialMin;
    minA = Math.min(
      minA,
      p.axial - half.axial - engineFlameReach(p, axialExtent),
    );
    maxA = Math.max(maxA, p.axial + half.axial);
  }
  const w = Math.max(maxL - minL, 1);
  const h = Math.max(maxA - minA, 1);
  return {
    projected,
    stages,
    edges,
    bounds: { cx: (minL + maxL) / 2, cy: (minA + maxA) / 2, w, h },
  };
}

/** The part's box as `buildShipMapPart` measured it, centred on its mesh centre and drawn upright before its rotation. */
function withBody(p: ShipMapPart): ProjectedPart {
  return {
    ...p,
    body: {
      latMin: p.lat - p.latHalfExtent,
      latMax: p.lat + p.latHalfExtent,
      axialMin: p.axial - p.axialHalfExtent,
      axialMax: p.axial + p.axialHalfExtent,
    },
    spineDist: Math.abs(p.lat),
  };
}

/**
 * The parts in the order they are painted, back to front by depth, quantised
 * to the mm so float noise does not disturb the tiebreak. Parts at the same
 * depth draw outermost first so the central column overlaps on top. A fairing
 * is a shell over the parts it covers, so it draws after all of them. Fuel
 * lines are left out: they render as arrows in a separate top layer.
 */
export function paintOrder(parts: readonly ProjectedPart[]): ProjectedPart[] {
  return parts
    .filter((p) => p.type !== "fuel-line")
    .sort((a, b) => {
      if ((a.type === "fairing") !== (b.type === "fairing")) {
        return a.type === "fairing" ? 1 : -1;
      }
      const depthOrder =
        Math.round(a.depth * 1000) - Math.round(b.depth * 1000);
      return depthOrder !== 0 ? depthOrder : b.spineDist - a.spineDist;
    });
}
