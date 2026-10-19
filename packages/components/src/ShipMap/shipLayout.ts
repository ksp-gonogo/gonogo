import { CANOPY_SHAPES, ENGINE_FLAME_BODY_FRACTION } from "./partOverlays";
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

/** Metre-space margin below an active engine for its flame, the same fraction of the body its flame draws. */
function engineFlameReach(p: ShipMapPart, axialExtent: number): number {
  if (p.type !== "engine") return 0;
  const firing = p.partState?.some(
    (m) => m.type === "engine" && m.state === "active",
  );
  return firing ? axialExtent * ENGINE_FLAME_BODY_FRACTION : 0;
}

/** Metre-space margin above a parachute for its canopy, reserved only for the states that render one. */
function parachuteCanopyReach(p: ShipMapPart, latExtent: number): number {
  if (p.type !== "parachute") return 0;
  const state = p.partState?.find((m) => m.type === "parachute")?.state;
  const canopy = state === undefined ? undefined : CANOPY_SHAPES.get(state);
  return canopy ? latExtent * canopy.height : 0;
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

  let minL = Infinity;
  let maxL = -Infinity;
  let minA = Infinity;
  let maxA = -Infinity;
  for (const p of projected) {
    minL = Math.min(minL, p.body.latMin);
    maxL = Math.max(maxL, p.body.latMax);
    // Flames and canopies escape the body box, so the same fraction of the metre-space extent is reserved or they clip at fit zoom.
    const axialExtent = p.body.axialMax - p.body.axialMin;
    const latExtent = p.body.latMax - p.body.latMin;
    minA = Math.min(minA, p.body.axialMin - engineFlameReach(p, axialExtent));
    maxA = Math.max(maxA, p.body.axialMax + parachuteCanopyReach(p, latExtent));
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
