import type {
  SystemEntity,
  SystemEntityEmphasis,
  SystemEntityFixedPosition,
  SystemEntityMeta,
  SystemEntityOrbitPosition,
  SystemEntityPosition,
  SystemEntityShape,
  SystemEntityStyle,
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
