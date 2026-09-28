import { logger } from "@ksp-gonogo/logger";
import type { AlertTone } from "@ksp-gonogo/sitrep-sdk";
import {
  projectEntityPosition,
  projectOrbitRing,
  SYSTEM_ENTITY_DEFAULT_LAYER,
  type SystemEntitiesContext,
  type SystemEntity,
  type SystemEntityEmphasis,
  type SystemEntityMeta,
  type SystemEntityStyle,
} from "./systemEntities";

function effectiveLayer(entity: SystemEntity): number {
  return entity.zHint ?? SYSTEM_ENTITY_DEFAULT_LAYER[entity.shape.kind];
}

const TONE_COLOUR: Readonly<Record<AlertTone, string>> = {
  info: "var(--color-info-mark)",
  // Yellow: the muted warning gold reads as an ordinary faint line, and green is reserved for selection.
  warn: "var(--color-tag-yellow-fg)",
  nogo: "var(--color-nogo-text)",
};

const EMPHASIS_COLOUR: Readonly<Record<SystemEntityEmphasis, string>> = {
  faint: "var(--color-text-faint)",
  normal: "var(--color-info-mark)",
  bright: "var(--color-accent-fg)",
};

const EMPHASIS_OPACITY: Readonly<Record<SystemEntityEmphasis, number>> = {
  faint: 0.5,
  normal: 0.85,
  bright: 1,
};

function resolveColour(style: SystemEntityStyle): string {
  if (style.colour != null) return style.colour;
  if (style.tone != null) return TONE_COLOUR[style.tone];
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

/** One entity projected into plot space, or `null` when it has nowhere to draw. */
function resolveEntity(
  entity: SystemEntity,
  ctx: SystemEntitiesContext,
  colour: string,
  opacity: number,
): ResolvedSystemEntity | null {
  if (entity.shape.kind === "point") {
    const p = projectEntityPosition(entity.position, ctx);
    if (!p) return null;
    return {
      kind: "point",
      id: entity.id,
      x: p.x,
      y: p.y,
      radiusPx: entity.shape.radiusPx ?? DEFAULT_POINT_RADIUS_PX,
      colour,
      opacity,
      meta: entity.meta,
      vesselId: entity.vesselId,
    };
  }
  if (entity.shape.kind === "orbit-path") {
    if (entity.position.kind !== "orbit") {
      logger.warn(
        `System entity "${entity.id}" has shape "orbit-path" but a "${entity.position.kind}" position; skipped`,
      );
      return null;
    }
    const ring = projectOrbitRing(entity.position, ctx);
    if (!ring) return null;
    const dot = projectEntityPosition(entity.position, ctx);
    return {
      kind: "orbit-path",
      id: entity.id,
      ring,
      ...(dot ? { dotX: dot.x, dotY: dot.y } : {}),
      colour,
      opacity,
      meta: entity.meta,
      vesselId: entity.vesselId,
    };
  }
  if (entity.shape.kind === "connection-line") {
    const from = projectEntityPosition(entity.position, ctx);
    const to = projectEntityPosition(entity.shape.to, ctx);
    if (!from || !to) return null;
    return {
      kind: "connection-line",
      id: entity.id,
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      colour,
      opacity,
      meta: entity.meta,
    };
  }
  if (entity.shape.kind === "blob") {
    const p = projectEntityPosition(entity.position, ctx);
    if (!p) return null;
    const radiusPx = entity.shape.radiusMetres * ctx.plotScale;
    if (!(radiusPx > 0)) return null;
    return {
      kind: "blob",
      id: entity.id,
      x: p.x,
      y: p.y,
      radiusPx,
      colour,
      opacity,
      meta: entity.meta,
    };
  }
  const from = projectEntityPosition(entity.position, ctx);
  const to = projectEntityPosition(entity.shape.to, ctx);
  if (!from || !to) return null;
  // A coincident apex and tip has no bearing to travel along.
  if (from.x === to.x && from.y === to.y) return null;
  const segmentLengthPx = entity.shape.segmentLengthMetres * ctx.plotScale;
  if (!(segmentLengthPx > 0)) return null;
  return {
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
  };
}

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

    const resolved = resolveEntity(entity, ctx, colour, opacity);
    if (resolved) layered.push({ z, resolved });
  }

  layered.sort((a, b) => a.z - b.z);
  return layered.map((l) => l.resolved);
}
