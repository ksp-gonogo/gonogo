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

interface Intrinsic {
  /** Half-extent along the axial (spine) axis, in metres. */
  halfH: number;
  /** Half-extent along the lateral axis, in metres. */
  halfW: number;
  /** Tanks, boosters and engines stretch axially to fill stack slabs; everything else keeps its intrinsic size. */
  stretchy: boolean;
}

/** Lateral offset under which a child counts as stack-attached. Well under the ~1.25 m stack diameter's radius. */
const STACK_LAT_TOL = 0.3;

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

function intrinsicSize(part: ShipMapPart): Intrinsic {
  const stretchy =
    part.type === "tank" || part.type === "booster" || part.type === "engine";
  return {
    halfH: part.axialHalfExtent,
    halfW: part.latHalfExtent,
    stretchy,
  };
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

  const intrinsics = new Map<number, Intrinsic>(
    parts.map((p) => [p.flightId, intrinsicSize(p)]),
  );
  const byId = new Map(parts.map((p) => [p.flightId, p]));
  const childrenOf = new Map<number, ShipMapPart[]>();
  for (const p of parts) {
    if (p.parentFlightId == null) continue;
    const list = childrenOf.get(p.parentFlightId) ?? [];
    list.push(p);
    childrenOf.set(p.parentFlightId, list);
  }

  const projected: ProjectedPart[] = parts.map((p) =>
    withBody(p, byId, childrenOf, intrinsics),
  );

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

function withBody(
  p: ShipMapPart,
  byId: Map<number, ShipMapPart>,
  childrenOf: Map<number, ShipMapPart[]>,
  intrinsics: Map<number, Intrinsic>,
): ProjectedPart {
  const intr = intrinsics.get(p.flightId);
  if (!intr)
    throw new Error(`ShipDiagram: missing intrinsic for ${p.flightId}`);
  const parent =
    p.parentFlightId != null ? (byId.get(p.parentFlightId) ?? null) : null;
  const children = childrenOf.get(p.flightId) ?? [];

  const isStackAxial = (c: ShipMapPart) =>
    Math.abs(c.lat - p.lat) < STACK_LAT_TOL &&
    Math.abs(c.axial - p.axial) > 0.05;

  const stackParent = parent && isStackAxial(parent) ? parent : null;
  const stackChildAbove = children
    .filter((c) => isStackAxial(c) && c.axial > p.axial)
    .reduce<ShipMapPart | null>(
      (m, c) => (!m || c.axial > m.axial ? c : m),
      null,
    );
  const stackChildBelow = children
    .filter((c) => isStackAxial(c) && c.axial < p.axial)
    .reduce<ShipMapPart | null>(
      (m, c) => (!m || c.axial < m.axial ? c : m),
      null,
    );

  let axialMax = p.axial + intr.halfH;
  let axialMin = p.axial - intr.halfH;

  if (intr.stretchy) {
    const upper =
      stackParent && stackParent.axial > p.axial
        ? stackParent
        : stackChildAbove;
    const lower =
      stackParent && stackParent.axial < p.axial
        ? stackParent
        : stackChildBelow;
    if (upper) {
      const ui = intrinsics.get(upper.flightId);
      if (ui) {
        axialMax = ui.stretchy
          ? (p.axial + upper.axial) / 2
          : upper.axial - ui.halfH;
      }
    }
    if (lower) {
      const li = intrinsics.get(lower.flightId);
      if (li) {
        axialMin = li.stretchy
          ? (p.axial + lower.axial) / 2
          : lower.axial + li.halfH;
      }
    }
  }

  let latMin = p.lat - intr.halfW;
  let latMax = p.lat + intr.halfW;
  for (const c of children) {
    if (isStackAxial(c)) continue;
    const ci = intrinsics.get(c.flightId);
    if (!ci) continue;
    if (c.type !== "fin" && c.type !== "solar") {
      if (c.axial + ci.halfH > axialMax) axialMax = c.axial + ci.halfH;
      if (c.axial - ci.halfH < axialMin) axialMin = c.axial - ci.halfH;
    }
    if (
      Math.abs(c.lat - p.lat) > 0.05 &&
      c.type !== "fin" &&
      c.type !== "solar"
    ) {
      const sign = Math.sign(c.lat - p.lat);
      const innerEdge = c.lat - sign * ci.halfW;
      if (sign > 0 && innerEdge > latMax) latMax = innerEdge;
      if (sign < 0 && innerEdge < latMin) latMin = innerEdge;
    }
  }

  if (p.type === "decoupler") {
    const widthOf = (n: ShipMapPart | null) =>
      n ? (intrinsics.get(n.flightId)?.halfW ?? 0) : 0;
    const halfW = Math.max(
      intr.halfW,
      widthOf(stackParent),
      widthOf(stackChildAbove),
      widthOf(stackChildBelow),
    );
    latMin = p.lat - halfW;
    latMax = p.lat + halfW;
  }

  return {
    ...p,
    body: { latMin, latMax, axialMin, axialMax },
    spineDist: Math.abs(p.lat),
  };
}
