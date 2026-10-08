import {
  type BodyPoseCurrency,
  deriveTrueAnomalyDeg,
} from "@ksp-gonogo/sitrep-client";
import type {
  SystemEntity,
  SystemEntityEmphasis,
  SystemEntityFixedPosition,
  SystemEntityMeta,
  SystemEntityOrbitPosition,
  SystemEntityPosition,
  SystemEntityShape,
  SystemEntityStyle,
  SystemEntitySubjectPosition,
} from "@ksp-gonogo/sitrep-sdk";
import { orbitPointAt, orbitRingOf } from "./orbitGeometry";
import { INERTIAL_PLACEMENT, type Placement } from "./projection";

export type {
  SystemEntity,
  SystemEntityEmphasis,
  SystemEntityFixedPosition,
  SystemEntityMeta,
  SystemEntityOrbitPosition,
  SystemEntityPosition,
  SystemEntityShape,
  SystemEntityStyle,
  SystemEntitySubjectPosition,
};

/*
 * The `system-view.entities` contribution slot: a contribution supplies a flat list of static display objects from its own `deps`, never seeing pan, zoom or the framed body. An entity whose parent is not the rendered frame simply does not project this render.
 * SystemView owns projection, z-order (`SYSTEM_ENTITY_DEFAULT_LAYER`, overridable by `zHint`) and the id-keyed `decorate` hook that lets host state such as selection restyle an entity.
 */

/** The diagram's auto-fit projection (zoom 1, no pan), the same value SystemView passes to overlay augments. */
export interface SystemEntitiesContext {
  /** Name of the parent body the diagram is centred on. */
  parentName: string;
  width: number;
  height: number;
  /** Metres → SVG-user-unit plot scale at the diagram's current zoom. */
  plotScale: number;
  /** Where the parent body is drawn, in the origin-centred frame, after the diagram's pan. */
  center: { x: number; y: number };
  /** The frame the diagram draws in, so an entity lands where the bodies do; absent is parent-centred inertial, the frame positions arrive in. */
  placement?: Placement;
  /** The instant on screen, in seconds: where an orbit position's mean anomaly is carried to. Absent places no orbit marker. */
  ut?: number;
  /** A body's gravitational parameter by name, for carrying an orbit position forward. */
  muOf?: (bodyName: string) => number | null;
  /** Where a body is relative to the frame body, in the catalogue's axes and metres, and how well that is known; null when it has no place. */
  bodyPlace?: (bodyIndex: number) => {
    offset: readonly [number, number, number];
    currency: BodyPoseCurrency;
  } | null;
}

/** Case/whitespace-insensitive body-name match (mirrors `SystemDiagram`'s own `nameMatches`). */
function sameParent(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Where on its orbit an entity is at the instant on screen, in degrees, or null
 * when it states no epoch, the parent's gravitational parameter is unknown, or
 * there is no instant. A place nobody stated is not guessed.
 *
 * Not a reckoner: the entity states a mean anomaly at an epoch and the widget
 * carries it to the instant on screen; no Topic holds the result, and
 * `registerReckoner` takes a `TopicId`.
 */
function trueAnomalyOf(
  position: SystemEntityOrbitPosition,
  ctx: SystemEntitiesContext,
): number | null {
  if (ctx.ut === undefined) return null;
  return deriveTrueAnomalyDeg({
    semiMajorAxis: position.sma,
    eccentricity: position.ecc,
    meanAnomalyAtEpoch: position.meanAnomalyAtEpoch,
    epoch: position.epoch,
    parentGravParameter: ctx.muOf?.(position.parentName),
    ut: ctx.ut,
  });
}

/** Whether an entity's place is known to be old: it says so itself, or it is placed by a body whose place is held. */
export function entityIsHeld(
  entity: SystemEntity,
  ctx: SystemEntitiesContext,
): boolean {
  if (entity.currency === "held") return true;
  if (entity.position.kind !== "subject") return false;
  return (
    ctx.bodyPlace?.(entity.position.subject.bodyIndex)?.currency === "held"
  );
}

/** Projects a position spec into SVG user units, or `null` when its parent is not the rendered frame or the geometry is degenerate. */
export function projectEntityPosition(
  position: SystemEntityPosition,
  ctx: SystemEntitiesContext,
): { x: number; y: number } | null {
  const placement = ctx.placement ?? INERTIAL_PLACEMENT;
  if (position.kind === "subject") {
    const place = ctx.bodyPlace?.(position.subject.bodyIndex);
    if (!place) return null;
    const at = placement.place([...place.offset]);
    return {
      x: ctx.center.x + at[0] * ctx.plotScale,
      y: ctx.center.y + at[1] * ctx.plotScale,
    };
  }
  if (!sameParent(position.parentName, ctx.parentName)) return null;
  if (position.kind === "orbit") {
    if (!(position.sma > 0) || !Number.isFinite(position.sma)) return null;
    const trueAnomaly = trueAnomalyOf(position, ctx);
    if (trueAnomaly === null) return null;
    const at = placement.place(
      orbitPointAt(
        position.sma,
        position.ecc,
        position.lan,
        position.argPe,
        position.inclination,
        trueAnomaly,
      ),
    );
    return {
      x: ctx.center.x + at[0] * ctx.plotScale,
      y: ctx.center.y + at[1] * ctx.plotScale,
    };
  }
  if (
    !Number.isFinite(position.xMetres) ||
    !Number.isFinite(position.yMetres) ||
    !Number.isFinite(position.zMetres)
  ) {
    return null;
  }
  const at = placement.place([
    position.xMetres,
    position.yMetres,
    position.zMetres,
  ]);
  return {
    x: ctx.center.x + at[0] * ctx.plotScale,
    y: ctx.center.y + at[1] * ctx.plotScale,
  };
}

/** An `orbit-path` ring as a closed polyline in SVG user units, sampled like the host's own rings so the two cannot disagree; `null` as for `projectEntityPosition`. */
export function projectOrbitRing(
  orbit: SystemEntityOrbitPosition,
  ctx: SystemEntitiesContext,
): string | null {
  if (!sameParent(orbit.parentName, ctx.parentName)) return null;
  if (!(orbit.sma > 0) || !Number.isFinite(orbit.sma)) return null;
  const placement = ctx.placement ?? INERTIAL_PLACEMENT;
  const points = orbitRingOf(
    orbit.sma,
    orbit.ecc,
    orbit.lan,
    orbit.argPe,
    orbit.inclination,
  ).map((p) => placement.place(p));
  let d = "";
  for (let i = 0; i < points.length; i++) {
    const x = ctx.center.x + points[i][0] * ctx.plotScale;
    const y = ctx.center.y + points[i][1] * ctx.plotScale;
    d += `${i === 0 ? "M" : " L"}${x},${y}`;
  }
  return `${d} Z`;
}

/** Default stacking, back to front: orbit rings, then blobs and travelling pulses, then connection lines, then point markers on top so they stay clickable. */
export const SYSTEM_ENTITY_DEFAULT_LAYER: Readonly<
  Record<SystemEntityShape["kind"], number>
> = {
  "orbit-path": 0,
  blob: 1,
  "travelling-pulse": 1,
  "connection-line": 2,
  point: 3,
};

/** Human-readable label for an entity's accessible name: `meta` rows, id fallback. */
export function formatEntityLabel(
  id: string,
  meta: SystemEntityMeta | undefined,
): string {
  if (!meta) return id;
  const entries = Object.entries(meta);
  if (entries.length === 0) return id;
  return entries.map(([k, v]) => `${k}: ${v}`).join(", ");
}
