import { logger } from "@ksp-gonogo/logger";
import {
  INERTIAL_PLACEMENT,
  orbitPointAt,
  orbitRingPoints,
  type Placement,
} from "./projection";

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
      topics: "system.vessels" | "system.bodies" | "comms.network";
    };
  }
}

/** The diagram's auto-fit projection (zoom 1, no pan), the same value SystemView passes to overlay augments. */
export interface SystemEntitiesContext {
  /** Name of the parent body the diagram is centred on. */
  parentName: string;
  width: number;
  height: number;
  /** Metres → SVG-user-unit plot scale at the diagram's auto-fit zoom. */
  plotScale: number;
  /** The parent body sits at this SVG-space point (the origin, in practice). */
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
    return { x: at[0] * ctx.plotScale, y: at[1] * ctx.plotScale };
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

function effectiveLayer(entity: SystemEntity): number {
  return entity.zHint ?? SYSTEM_ENTITY_DEFAULT_LAYER[entity.shape.kind];
}

const SEVERITY_COLOUR: Readonly<Record<SystemEntitySeverity, string>> = {
  info: "var(--color-status-info-fg)",
  // Yellow: the muted warning gold reads as an ordinary faint line, and green is reserved for selection.
  warning: "var(--color-tag-yellow-fg)",
  critical: "var(--color-status-nogo-fg)",
};

const EMPHASIS_COLOUR: Readonly<Record<SystemEntityEmphasis, string>> = {
  faint: "var(--color-text-faint)",
  normal: "var(--color-status-info-fg)",
  bright: "var(--color-accent-fg)",
};

const EMPHASIS_OPACITY: Readonly<Record<SystemEntityEmphasis, number>> = {
  faint: 0.5,
  normal: 0.85,
  bright: 1,
};

function resolveColour(style: SystemEntityStyle): string {
  if (style.colour != null) return style.colour;
  if (style.severity != null) return SEVERITY_COLOUR[style.severity];
  return EMPHASIS_COLOUR[style.emphasis ?? "normal"];
}

function resolveOpacity(style: SystemEntityStyle): number {
  return EMPHASIS_OPACITY[style.emphasis ?? "normal"];
}

interface ResolvedBase {
  id: string;
  colour: string;
  opacity: number;
  meta?: SystemEntityMeta;
  /** Carried from `SystemEntity.vesselId`, so selection recognises a vessel whether drawn as a point or a ring. */
  vesselId?: string;
}

export type ResolvedSystemEntity =
  | (ResolvedBase & {
      kind: "point";
      x: number;
      y: number;
      radiusPx: number;
    })
  | (ResolvedBase & {
      kind: "orbit-path";
      /** The whole ring as a closed SVG path, already absolute because every sample is projected. */
      ring: string;
      /** The entity's own declared anomaly, projected, marking where on the ring its data points. */
      dotX?: number;
      dotY?: number;
    })
  | (ResolvedBase & {
      kind: "connection-line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    })
  | (ResolvedBase & {
      kind: "blob";
      x: number;
      y: number;
      radiusPx: number;
    })
  | (ResolvedBase & {
      kind: "travelling-pulse";
      /** Apex (the entity's own `position`, projected). */
      x1: number;
      y1: number;
      /** Tip (`shape.to`, projected): where the pulse travels TOWARD. */
      x2: number;
      y2: number;
      segmentLengthPx: number;
      /** See the `travelling-pulse` shape's doc. */
      arriveUt: number;
      clearUt: number;
    });

const DEFAULT_POINT_RADIUS_PX = 4;

/**
 * Projects, styles and z-orders every entity for the rendered frame. An entity that fails to project is skipped; a shape and position that cannot combine (an `orbit-path` on a `fixed` position) also logs a dev warning, since that is always a contribution bug.
 *
 * `decorate` returns a style override merged over the entity's own. Sorting is stable, so ties keep array order.
 */
export function resolveSystemEntities(
  entities: readonly SystemEntity[],
  ctx: SystemEntitiesContext,
  decorate?: (id: string) => SystemEntityStyle | undefined,
): ResolvedSystemEntity[] {
  const layered: Array<{ z: number; resolved: ResolvedSystemEntity }> = [];

  for (const entity of entities) {
    const style: SystemEntityStyle = {
      ...entity.style,
      ...decorate?.(entity.id),
    };
    const colour = resolveColour(style);
    const opacity = resolveOpacity(style);
    const z = effectiveLayer(entity);

    if (entity.shape.kind === "point") {
      const p = projectEntityPosition(entity.position, ctx);
      if (!p) continue;
      layered.push({
        z,
        resolved: {
          kind: "point",
          id: entity.id,
          x: p.x,
          y: p.y,
          radiusPx: entity.shape.radiusPx ?? DEFAULT_POINT_RADIUS_PX,
          colour,
          opacity,
          meta: entity.meta,
          vesselId: entity.vesselId,
        },
      });
    } else if (entity.shape.kind === "orbit-path") {
      if (entity.position.kind !== "orbit") {
        logger.warn(
          `System entity "${entity.id}" has shape "orbit-path" but a "${entity.position.kind}" position; skipped`,
        );
        continue;
      }
      const ring = projectOrbitRing(entity.position, ctx);
      if (!ring) continue;
      const dot = projectEntityPosition(entity.position, ctx);
      layered.push({
        z,
        resolved: {
          kind: "orbit-path",
          id: entity.id,
          ring,
          ...(dot ? { dotX: dot.x, dotY: dot.y } : {}),
          colour,
          opacity,
          meta: entity.meta,
          vesselId: entity.vesselId,
        },
      });
    } else if (entity.shape.kind === "connection-line") {
      const from = projectEntityPosition(entity.position, ctx);
      const to = projectEntityPosition(entity.shape.to, ctx);
      if (!from || !to) continue;
      layered.push({
        z,
        resolved: {
          kind: "connection-line",
          id: entity.id,
          x1: from.x,
          y1: from.y,
          x2: to.x,
          y2: to.y,
          colour,
          opacity,
          meta: entity.meta,
        },
      });
    } else if (entity.shape.kind === "blob") {
      const p = projectEntityPosition(entity.position, ctx);
      if (!p) continue;
      const radiusPx = entity.shape.radiusMetres * ctx.plotScale;
      if (!(radiusPx > 0)) continue;
      layered.push({
        z,
        resolved: {
          kind: "blob",
          id: entity.id,
          x: p.x,
          y: p.y,
          radiusPx,
          colour,
          opacity,
          meta: entity.meta,
        },
      });
    } else {
      // "travelling-pulse"
      const from = projectEntityPosition(entity.position, ctx);
      const to = projectEntityPosition(entity.shape.to, ctx);
      if (!from || !to) continue;
      // A coincident apex and tip has no bearing to travel along.
      if (from.x === to.x && from.y === to.y) continue;
      const segmentLengthPx = entity.shape.segmentLengthMetres * ctx.plotScale;
      if (!(segmentLengthPx > 0)) continue;
      layered.push({
        z,
        resolved: {
          kind: "travelling-pulse",
          id: entity.id,
          x1: from.x,
          y1: from.y,
          x2: to.x,
          y2: to.y,
          segmentLengthPx,
          arriveUt: entity.shape.arriveUt,
          clearUt: entity.shape.clearUt,
          colour,
          opacity,
          meta: entity.meta,
        },
      });
    }
  }

  layered.sort((a, b) => a.z - b.z);
  return layered.map((l) => l.resolved);
}

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
