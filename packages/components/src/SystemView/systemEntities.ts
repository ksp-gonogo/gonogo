import { orbitPointAt, orbitRingPoints } from "./orbitGeometry";
import { INERTIAL_PLACEMENT, type Placement } from "./projection";

/*
 * The `system-view.entities` contribution slot: a contribution supplies a flat list of static display objects from its own `deps`, never seeing pan, zoom or the framed body. An entity whose parent is not the rendered frame simply does not project this render.
 * SystemView owns projection, z-order (`SYSTEM_ENTITY_DEFAULT_LAYER`, overridable by `zHint`) and the id-keyed `decorate` hook that lets host state such as selection restyle an entity.
 */

export type SystemEntityEmphasis = "faint" | "normal" | "bright";

/** Semantic weight a contributor can name: the host maps it to a hue. */
export type SystemEntitySeverity = "info" | "warning" | "critical";

export interface SystemEntityStyle {
  /** Defaults to "normal" when omitted. */
  emphasis?: SystemEntityEmphasis;
  /** What the entity means, which the host turns into a hue; a contributor never names a colour, so the theme reaches every entity. */
  severity?: SystemEntitySeverity;
  /** A resolved CSS colour overriding both of the above, for the host's own `decorate` hook; a contribution names `severity` instead. */
  colour?: string;
}

/** Key/value rows shown in the info panel when this entity is selected. */
export type SystemEntityMeta = Readonly<
  Record<string, string | number | boolean>
>;

/** A point on a Keplerian orbit around `parentName`; `trueAnomaly` places the point, and whole-ring shapes ignore it. */
export interface SystemEntityOrbitPosition {
  kind: "orbit";
  parentName: string;
  /** Semi-major axis, metres. */
  sma: number;
  ecc: number;
  /** Longitude of the ascending node, degrees. */
  lan: number;
  /** Argument of periapsis, degrees. */
  argPe: number;
  /** Inclination to the parent's reference plane, degrees. Required: an equatorial orbit says `0`, since a frame transform needs a third component to rotate. */
  inclination: number;
  /** True anomaly, degrees. */
  trueAnomaly: number;
}

/** A position in parent-centred metres for anything not itself on a conic; placing something at a body is the contributor's job, and SystemView only turns metres into pixels. */
export interface SystemEntityFixedPosition {
  kind: "fixed";
  parentName: string;
  xMetres: number;
  yMetres: number;
  /** Out of the parent's reference plane, metres; required for the same reason as `inclination`. */
  zMetres: number;
}

export type SystemEntityPosition =
  | SystemEntityOrbitPosition
  | SystemEntityFixedPosition;

export type SystemEntityShape =
  | { kind: "point"; radiusPx?: number }
  /** Draws the FULL ellipse of `position` (which must be `kind: "orbit"`). */
  | { kind: "orbit-path" }
  /** A line from this entity's own `position` to `to`. */
  | { kind: "connection-line"; to: SystemEntityPosition }
  /** A physically scaled disc: `radiusMetres` projects by `plotScale`, so it scales on zoom. */
  | { kind: "blob"; radiusMetres: number }
  /**
   * A segment travelling once from this entity's `position` (the apex) toward `to`, for one thing in transit along a bearing such as a CME front.
   *
   * `segmentLengthMetres` is the segment's own physical length, clamped to the apex-to-tip distance. `arriveUt` and `clearUt` are absolute UTs derived from Topic data, keeping `compute()` pure; the layer derives departure at the same constant rate, so the leading edge reaches `to` at `arriveUt` and the trailing edge clears it at `clearUt`, fading past the target.
   */
  | {
      kind: "travelling-pulse";
      to: SystemEntityPosition;
      segmentLengthMetres: number;
      /** UT the leading edge reaches `to`. */
      arriveUt: number;
      /** UT the trailing edge fully clears `to`. */
      clearUt: number;
    };

export interface SystemEntity {
  /** Stable, globally unique id that the decoration hook and info panel key off. */
  id: string;
  position: SystemEntityPosition;
  shape: SystemEntityShape;
  style?: SystemEntityStyle;
  meta?: SystemEntityMeta;
  /** `system.vessels`' `vesselId` when this entity is a vessel, so host state matches by identity rather than parsing `id`. */
  vesselId?: string;
  /** Explicit stacking override of `SYSTEM_ENTITY_DEFAULT_LAYER`; ties within a layer keep array order. */
  zHint?: number;
}

declare module "@ksp-gonogo/core" {
  interface ContributionRegistry {
    "system-view.entities": {
      entry: SystemEntity;
    };
  }
}

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
}

/** Case/whitespace-insensitive body-name match (mirrors `SystemDiagram`'s own `nameMatches`). */
function sameParent(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Projects a position spec into SVG user units, or `null` when its parent is not the rendered frame or the geometry is degenerate. */
export function projectEntityPosition(
  position: SystemEntityPosition,
  ctx: SystemEntitiesContext,
): { x: number; y: number } | null {
  if (!sameParent(position.parentName, ctx.parentName)) return null;
  const placement = ctx.placement ?? INERTIAL_PLACEMENT;
  if (position.kind === "orbit") {
    if (!(position.sma > 0) || !Number.isFinite(position.sma)) return null;
    const at = placement.place(
      orbitPointAt(
        position.sma,
        position.ecc,
        position.lan,
        position.argPe,
        position.inclination,
        position.trueAnomaly,
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
  const points = orbitRingPoints(
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
