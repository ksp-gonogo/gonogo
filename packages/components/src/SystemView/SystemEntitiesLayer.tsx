import type { CSSProperties, KeyboardEvent } from "react";
import { useMemo } from "react";
// InteractiveMarker below is a styled.g whose keyboard focus ring
// (`&:focus-visible .focus-ring`) is an SVG pseudo-class + descendant rule
// that inline `style` cannot express, and no ui-kit primitive is an SVG <g>
// focus wrapper. Same pattern as `ShipMap/ShipDiagramSvg.tsx`'s `PartGroup`.
// Shared by both interactive shapes, point markers and vessel orbit-path
// rings: the focus treatment is identical either way.
// biome-ignore lint/style/noRestrictedImports: SVG <g> focus ring, no inline/primitive equivalent (see above)
import { styled } from "styled-components";
import {
  formatEntityLabel,
  type ResolvedSystemEntity,
  resolveSystemEntities,
  type SystemEntitiesContext,
  type SystemEntity,
  type SystemEntityStyle,
} from "./systemEntities";

/**
 * Draws every `system-view.entities` contribution as an SVG primitive, in
 * its own absolutely-positioned layer matching the diagram's auto-fit
 * viewBox (same static, non-zoom-tracking projection contract as the
 * `system-view.overlay` augment slot: `ctx` is typically SystemView's own
 * `overlayContext`, reused rather than recomputed). Renders nothing (`null`)
 * when nothing projects, so an empty contribution set costs nothing.
 */
export interface SystemEntitiesLayerProps {
  entities: readonly SystemEntity[];
  ctx: SystemEntitiesContext;
  /** Id-keyed decoration hook: see `resolveSystemEntities`'s own doc comment. */
  decorate?: (id: string) => SystemEntityStyle | undefined;
  /** Currently selected entity id, if any: drives `aria-pressed` on the matching marker. */
  selectedId?: string | null;
  /**
   * Fires when a vessel display object is activated (click, Enter, Space):
   * a `point` marker, or an `orbit-path` ring that carries a `vesselId`
   * that is selectable. Connection lines and blobs stay background
   * geometry, never selectable targets, and an `orbit-path` with no
   * `vesselId` (a hypothetical non-vessel ring) stays inert too. Omitted:
   * every shape renders as a plain (non-interactive, non-focusable) marker.
   */
  onEntityActivate?: (id: string) => void;
}

export function SystemEntitiesLayer({
  entities,
  ctx,
  decorate,
  selectedId,
  onEntityActivate,
}: Readonly<SystemEntitiesLayerProps>) {
  const resolved = useMemo(
    () => resolveSystemEntities(entities, ctx, decorate),
    [entities, ctx, decorate],
  );

  if (resolved.length === 0) return null;

  const halfW = ctx.width / 2;
  const halfH = ctx.height / 2;
  const viewBox = `${ctx.center.x - halfW} ${ctx.center.y - halfH} ${ctx.width} ${ctx.height}`;

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      role="presentation"
      style={LAYER_SVG}
    >
      {resolved.map((r) => (
        <Primitive
          key={r.id}
          resolved={r}
          selected={selectedId === r.id}
          onActivate={onEntityActivate}
        />
      ))}
    </svg>
  );
}

function Primitive({
  resolved: r,
  selected,
  onActivate,
}: Readonly<{
  resolved: ResolvedSystemEntity;
  selected: boolean;
  onActivate?: (id: string) => void;
}>) {
  switch (r.kind) {
    case "orbit-path": {
      // Only a vessel's own ring is selectable (`vesselId` set): a body's
      // orbit ring, drawn by `SystemDiagram` itself rather than this layer,
      // never reaches here, but a future non-vessel `orbit-path`
      // contribution shouldn't accidentally become clickable either.
      const interactive = onActivate !== undefined && r.vesselId != null;
      if (!interactive) {
        return (
          <g
            transform={`rotate(${r.rotationDeg})`}
            pointerEvents="none"
            data-entity-id={r.id}
          >
            <ellipse
              cx={r.cx}
              cy={r.cy}
              rx={r.rx}
              ry={r.ry}
              fill="none"
              stroke={r.colour}
              strokeOpacity={r.opacity}
              strokeWidth={1.2}
            />
          </g>
        );
      }
      const activate = () => onActivate?.(r.id);
      return (
        <InteractiveMarker
          transform={`rotate(${r.rotationDeg})`}
          data-entity-id={r.id}
          role="button"
          tabIndex={0}
          aria-label={formatEntityLabel(r.id, r.meta)}
          aria-pressed={selected}
          onClick={activate}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              activate();
            }
          }}
          style={POINT_INTERACTIVE_STYLE}
        >
          {/* Transparent, wider stroke: enlarges the click/tap hit target
              past the thin visible ring without changing its drawn weight. */}
          <ellipse
            data-hit-target="true"
            cx={r.cx}
            cy={r.cy}
            rx={r.rx}
            ry={r.ry}
            fill="none"
            stroke="transparent"
            strokeWidth={14}
          />
          <ellipse
            data-ring="true"
            cx={r.cx}
            cy={r.cy}
            rx={r.rx}
            ry={r.ry}
            fill="none"
            stroke={r.colour}
            strokeOpacity={r.opacity}
            strokeWidth={1.2}
          />
          <ellipse
            className="focus-ring"
            cx={r.cx}
            cy={r.cy}
            rx={r.rx + 3}
            ry={r.ry + 3}
            fill="none"
            stroke="var(--color-accent-fg)"
            strokeWidth={2}
            pointerEvents="none"
          />
        </InteractiveMarker>
      );
    }
    case "connection-line":
      return (
        <line
          x1={r.x1}
          y1={r.y1}
          x2={r.x2}
          y2={r.y2}
          stroke={r.colour}
          strokeOpacity={r.opacity}
          strokeWidth={1.4}
          pointerEvents="none"
          data-entity-id={r.id}
        />
      );
    case "blob":
      return (
        <circle
          cx={r.x}
          cy={r.y}
          r={r.radiusPx}
          fill={r.colour}
          fillOpacity={r.opacity * 0.3}
          stroke={r.colour}
          strokeOpacity={r.opacity}
          strokeWidth={1}
          pointerEvents="none"
          data-entity-id={r.id}
        />
      );
    case "point": {
      const interactive = onActivate !== undefined;
      const activate = () => onActivate?.(r.id);
      const interactiveProps = interactive
        ? {
            role: "button" as const,
            tabIndex: 0,
            "aria-label": formatEntityLabel(r.id, r.meta),
            "aria-pressed": selected,
            onClick: activate,
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                activate();
              }
            },
            style: POINT_INTERACTIVE_STYLE,
          }
        : { style: POINT_STATIC_STYLE };
      return (
        <InteractiveMarker data-entity-id={r.id} {...interactiveProps}>
          <circle
            cx={r.x}
            cy={r.y}
            r={r.radiusPx}
            fill={r.colour}
            fillOpacity={r.opacity}
            stroke="var(--color-text-inverse)"
            strokeWidth={1}
          />
          {interactive && (
            <circle
              className="focus-ring"
              cx={r.x}
              cy={r.y}
              r={r.radiusPx + 3}
              fill="none"
              stroke="var(--color-accent-fg)"
              strokeWidth={2}
              pointerEvents="none"
            />
          )}
        </InteractiveMarker>
      );
    }
    default:
      return null;
  }
}

const LAYER_SVG: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "block",
  // Empty space between markers stays click-through to the diagram beneath
  // (pan/zoom, body hover); each interactive point re-enables pointer events
  // on itself.
  pointerEvents: "none",
};

const POINT_INTERACTIVE_STYLE: CSSProperties = {
  cursor: "pointer",
  pointerEvents: "auto",
};

const POINT_STATIC_STYLE: CSSProperties = { pointerEvents: "none" };

// The one styled block that stays: an SVG <g> keyboard focus ring. See the
// justified biome-ignore on the styled-components import at the top of the
// file.
const InteractiveMarker = styled.g`
  outline: none;
  .focus-ring {
    visibility: hidden;
  }
  &:focus-visible .focus-ring {
    visibility: visible;
  }
`;
