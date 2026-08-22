import { logger } from "@ksp-gonogo/logger";
import { bodyPosition, orbitEllipseGeometry } from "./SystemDiagram";

/**
 * The `system-view.entities` contribution slot (contribution-slots-spec
 * precedent: `ship-map.part-meters`): the shape-contribution foundation
 * every later SystemView augmentation (vessel orbits, the CommNet graph,
 * selection, CME) draws through.
 *
 * A contribution supplies a flat list of STATIC display objects, computed
 * once per frame from its own `deps` (same aggregation pipeline as any other
 * contribution slot, `contributionsRuntime.tsx`'s `SlotAggregator`). It never
 * receives the diagram's live pan/zoom or which body the widget is framed
 * on: `SystemEntitiesLayer` filters/projects every entity against whichever
 * frame is currently rendered (an entity whose `position.parentName` doesn't
 * match the current frame simply doesn't project this render, and reappears
 * automatically if the user re-frames onto its body).
 *
 * SystemView owns three things a contribution never touches:
 *   - Projection: `projectEntityPosition`/`projectOrbitRing` below, built on
 *     `SystemDiagram.tsx`'s own `bodyPosition` (the same conic-section math
 *     that places a body dot on its orbit).
 *   - Z-order: `SYSTEM_ENTITY_DEFAULT_LAYER` layers shapes so contributed
 *     geometry never occludes another contribution's destructively (orbits
 *     under blobs under connections under markers); a contributor can still
 *     force an explicit stacking position via `zHint`.
 *   - The id-keyed decoration hook (`resolveSystemEntities`'s `decorate`
 *     param): lets host-owned state (selection now, CommNet traffic/
 *     highlight in later tasks) override an entity's style by id, without
 *     the contribution itself knowing selection exists.
 */

// ── Style / meta ─────────────────────────────────────────────────────────

export type SystemEntityEmphasis = "faint" | "normal" | "bright";

export interface SystemEntityStyle {
  /** Defaults to "normal" when omitted. */
  emphasis?: SystemEntityEmphasis;
  /** CSS colour (a `var(--...)` token or a literal); overrides the emphasis default. */
  colour?: string;
}

/** Key/value rows shown in the info panel when this entity is selected. */
export type SystemEntityMeta = Readonly<
  Record<string, string | number | boolean>
>;

// ── Position specs ───────────────────────────────────────────────────────

/**
 * A point on a Keplerian orbit around `parentName`, in the same element set
 * `SystemDiagram`'s own child-body and vessel-orbit props already carry.
 * `trueAnomaly` places the POINT along the orbit; shapes that draw the whole
 * ring (`orbit-path`) ignore it.
 */
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
  /** True anomaly, degrees. */
  trueAnomaly: number;
}

/**
 * A position given directly in parent-centric metres (the same frame an
 * orbit's polar form resolves into), for anything that isn't itself on a
 * conic: e.g. a ground station co-located with its body, or a body's own
 * projected position a fleet/comms contribution has already resolved.
 * Placing something "at a body" is the contributing Uplink's job (it reads
 * that body's own orbit off `system.bodies` and projects it the same way a
 * child body would be); SystemView only ever turns metres into pixels.
 */
export interface SystemEntityFixedPosition {
  kind: "fixed";
  parentName: string;
  xMetres: number;
  yMetres: number;
}

export type SystemEntityPosition =
  | SystemEntityOrbitPosition
  | SystemEntityFixedPosition;

// ── Shape kinds ───────────────────────────────────────────────────────────

export type SystemEntityShape =
  | { kind: "point"; radiusPx?: number }
  /** Draws the FULL ellipse of `position` (which must be `kind: "orbit"`). */
  | { kind: "orbit-path" }
  /** A line from this entity's own `position` to `to`. */
  | { kind: "connection-line"; to: SystemEntityPosition }
  /** A physically-scaled disc: `radiusMetres` is projected by `plotScale` like any other distance, so it grows/shrinks correctly on zoom (e.g. an expanding CME front). */
  | { kind: "blob"; radiusMetres: number };

export interface SystemEntity {
  /** Stable, globally-unique id: the decoration hook and the future info panel key off this. */
  id: string;
  position: SystemEntityPosition;
  shape: SystemEntityShape;
  style?: SystemEntityStyle;
  meta?: SystemEntityMeta;
  /**
   * `system.vessels`' `vesselId`, when this entity represents a specific
   * vessel. Lets host-owned state match an entity by vessel identity without
   * parsing a contribution-private `id` string: SystemView uses it to
   * suppress the active/framed vessel's own entry, since `SystemDiagram`
   * already draws that vessel's dedicated bright ring and a contributed
   * faint one would sit on top of it.
   */
  vesselId?: string;
  /**
   * Explicit stacking override. Omitted: the shape kind's entry in
   * `SYSTEM_ENTITY_DEFAULT_LAYER` applies. Entities within the same
   * effective layer keep their `entities` array order (ties broken by
   * array position, not id).
   */
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

// ── Projection context ───────────────────────────────────────────────────

/**
 * The diagram's auto-fit projection: structurally the same contract
 * `SystemOverlayContext` (`index.tsx`) already gives third-party overlay
 * augments (zoom=1, no pan; the SVG's parent-centric metres → user-unit
 * scale), kept as its own named type since the two slots may diverge later.
 * SystemView passes its existing `overlayContext` value straight through:
 * one projection computed once per render, reused by both slots.
 */
export interface SystemEntitiesContext {
  /** Name of the parent body the diagram is centred on. */
  parentName: string;
  width: number;
  height: number;
  /** Metres → SVG-user-unit plot scale at the diagram's auto-fit zoom. */
  plotScale: number;
  /** The parent body sits at this SVG-space point (the origin, in practice). */
  center: { x: number; y: number };
}

/** Case/whitespace-insensitive body-name match (mirrors `SystemDiagram`'s own `nameMatches`). */
function sameParent(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Projects a position spec into the diagram's SVG user-units. Returns
 * `null` when the position's `parentName` doesn't match the currently
 * rendered frame (the entity simply isn't drawn this render) or the
 * geometry is degenerate (non-finite/non-positive sma, non-finite metres).
 */
export function projectEntityPosition(
  position: SystemEntityPosition,
  ctx: SystemEntitiesContext,
): { x: number; y: number } | null {
  if (!sameParent(position.parentName, ctx.parentName)) return null;
  if (position.kind === "orbit") {
    if (!(position.sma > 0) || !Number.isFinite(position.sma)) return null;
    return bodyPosition(
      position.sma,
      position.ecc,
      position.lan,
      position.argPe,
      position.trueAnomaly,
      ctx.plotScale,
    );
  }
  if (
    !Number.isFinite(position.xMetres) ||
    !Number.isFinite(position.yMetres)
  ) {
    return null;
  }
  return {
    x: ctx.center.x + position.xMetres * ctx.plotScale,
    y: ctx.center.y + position.yMetres * ctx.plotScale,
  };
}

/**
 * Ellipse parameters for an `orbit-path` ring, positioned at `ctx.center`:
 * the caller wraps `<ellipse cx cy rx ry>` in a `<g transform="rotate(rotationDeg)">`
 * around `ctx.center`. `null` for a frame mismatch or degenerate sma, same
 * as `projectEntityPosition`. The ellipse geometry itself comes from
 * `orbitEllipseGeometry` (`SystemDiagram.tsx`), the same conic-section math
 * a child body's and the active vessel's own orbit rings use, just
 * re-centred from origin-relative to `ctx.center`.
 */
export interface OrbitRingGeometry {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotationDeg: number;
}

export function projectOrbitRing(
  orbit: SystemEntityOrbitPosition,
  ctx: SystemEntitiesContext,
): OrbitRingGeometry | null {
  if (!sameParent(orbit.parentName, ctx.parentName)) return null;
  if (!(orbit.sma > 0) || !Number.isFinite(orbit.sma)) return null;
  const ring = orbitEllipseGeometry(
    orbit.sma,
    orbit.ecc,
    orbit.lan,
    orbit.argPe,
    ctx.plotScale,
  );
  return {
    cx: ctx.center.x + ring.cx,
    cy: ctx.center.y + ring.cy,
    rx: ring.rx,
    ry: ring.ry,
    rotationDeg: ring.rotationDeg,
  };
}

// ── Z-order ───────────────────────────────────────────────────────────────

/**
 * Default stacking, back to front: orbit rings read as background structure,
 * blobs (physical ambient effects, e.g. a CME front) sit above them but
 * below the network layer, connection lines sit above blobs so a link is
 * always readable against whatever it crosses, and point markers are always
 * on top so they stay clickable. A contributed entity's `zHint` overrides
 * this outright when a contribution needs a different stacking (e.g. an
 * entity that must clear a specific other entity).
 */
export const SYSTEM_ENTITY_DEFAULT_LAYER: Readonly<
  Record<SystemEntityShape["kind"], number>
> = {
  "orbit-path": 0,
  blob: 1,
  "connection-line": 2,
  point: 3,
};

function effectiveLayer(entity: SystemEntity): number {
  return entity.zHint ?? SYSTEM_ENTITY_DEFAULT_LAYER[entity.shape.kind];
}

// ── Style resolution ──────────────────────────────────────────────────────

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
  return style.colour ?? EMPHASIS_COLOUR[style.emphasis ?? "normal"];
}

function resolveOpacity(style: SystemEntityStyle): number {
  return EMPHASIS_OPACITY[style.emphasis ?? "normal"];
}

// ── Resolved (projected + styled + z-ordered) draw descriptors ────────────

interface ResolvedBase {
  id: string;
  colour: string;
  opacity: number;
  meta?: SystemEntityMeta;
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
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      rotationDeg: number;
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
    });

const DEFAULT_POINT_RADIUS_PX = 4;

/**
 * Projects, styles, and z-orders every entity for the currently rendered
 * frame. An entity that fails to project (wrong frame, degenerate geometry,
 * or a shape/position combination that doesn't make sense, e.g. an
 * `orbit-path` on a `fixed` position) is silently skipped, same "just
 * doesn't render this frame" contract as `projectEntityPosition`; a dev
 * warning is logged for the shape/position mismatch case since that one is
 * always a contribution bug, not a normal off-frame entity.
 *
 * `decorate`, given an entity's id, returns a style override merged OVER the
 * entity's own declared style (host-owned state, e.g. selection, drives this
 * without the contribution needing to know it exists).
 *
 * Sorted back-to-front by effective layer; ties keep `entities` array order
 * (relies on `Array.prototype.sort` being a stable sort, guaranteed since
 * ES2019).
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
      layered.push({
        z,
        resolved: {
          kind: "orbit-path",
          id: entity.id,
          ...ring,
          colour,
          opacity,
          meta: entity.meta,
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
    } else {
      // "blob"
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
