import type { CSSProperties, KeyboardEvent } from "react";
import { useMemo } from "react";
// An SVG <g> keyboard focus ring (a pseudo-class plus descendant rule) that inline style cannot express, shared by point markers and vessel rings.
// biome-ignore lint/style/noRestrictedImports: SVG <g> focus ring, no inline/primitive equivalent (see above)
import { styled } from "styled-components";
import { hasSweep, PulseSweeps, type SystemEntityPulse } from "./pulseSweeps";

export type { SystemEntityPulse } from "./pulseSweeps";

import {
  type ResolvedSystemEntity,
  resolveSystemEntities,
} from "./resolveSystemEntities";
import {
  formatEntityLabel,
  type SystemEntitiesContext,
  type SystemEntity,
  type SystemEntityStyle,
} from "./systemEntities";
import { TravellingPulse } from "./TravellingPulse";

export interface SystemEntitiesLayerProps {
  entities: readonly SystemEntity[];
  ctx: SystemEntitiesContext;
  /** Id-keyed decoration hook: see `resolveSystemEntities`'s own doc comment. */
  decorate?: (id: string) => SystemEntityStyle | undefined;
  /** Currently selected entity id, if any: drives `aria-pressed` on the matching marker. */
  selectedId?: string | null;
  /** Fires when a selectable vessel shape (a `point`, or an `orbit-path` carrying a `vesselId`) is activated; omitted, every shape is inert. */
  onEntityActivate?: (id: string) => void;
  /** One travelling gradient glow per in-flight `system.uplink.pending` entry; a pulse whose `edgeId` matches no resolved connection line is skipped. */
  pulses?: readonly SystemEntityPulse[];
  /** Real now UT driving a `travelling-pulse` entity's single pass: `useUtNow()`, not the delayed view UT, since a CME's storm time is a real-UT fact. Absent draws no pulse. */
  nowUt?: number;
}

/** Draws every `system-view.entities` contribution as an SVG primitive in its own layer, matching the diagram's static auto-fit viewBox; renders nothing when nothing projects. */
export function SystemEntitiesLayer({
  entities,
  ctx,
  decorate,
  selectedId,
  onEntityActivate,
  pulses,
  nowUt,
}: Readonly<SystemEntitiesLayerProps>) {
  const resolved = useMemo(
    () => resolveSystemEntities(entities, ctx, decorate),
    [entities, ctx, decorate],
  );

  if (resolved.length === 0 && !hasSweep(pulses, resolved)) return null;

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
          nowUt={nowUt}
        />
      ))}
      <PulseSweeps pulses={pulses} resolved={resolved} />
    </svg>
  );
}

/** Enter and Space activate, as they do a native button. */
function activateOnKey(activate: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    activate();
  };
}

function Primitive({
  resolved: r,
  selected,
  onActivate,
  nowUt,
}: Readonly<{
  resolved: ResolvedSystemEntity;
  selected: boolean;
  onActivate?: (id: string) => void;
  nowUt?: number;
}>) {
  switch (r.kind) {
    case "orbit-path": {
      // Only a vessel's own ring (`vesselId` set) is selectable. Ring and dot are both already projected, so neither sits inside a transform.
      const dot =
        r.dotX != null && r.dotY != null ? (
          <circle
            cx={r.dotX}
            cy={r.dotY}
            r={ORBIT_DOT_RADIUS_PX}
            fill={r.colour}
            fillOpacity={r.opacity}
            pointerEvents="none"
            data-entity-dot-id={r.id}
          />
        ) : null;
      const interactive = onActivate !== undefined && r.vesselId != null;
      if (!interactive) {
        return (
          <>
            <path
              d={r.ring}
              fill="none"
              stroke={r.colour}
              strokeOpacity={r.opacity}
              strokeWidth={VESSEL_ORBIT_STROKE_WIDTH_PX}
              pointerEvents="none"
              data-entity-id={r.id}
            />
            {dot}
          </>
        );
      }
      const activate = () => onActivate?.(r.id);
      return (
        <>
          <InteractiveMarker
            data-entity-id={r.id}
            role="button"
            tabIndex={0}
            aria-label={formatEntityLabel(r.id, r.meta)}
            aria-pressed={selected}
            onClick={activate}
            onKeyDown={activateOnKey(activate)}
            style={POINT_INTERACTIVE_STYLE}
          >
            {/* Outlined by a heavier stroke on the same path: an offset curve of a projected rosette is not the same curve. */}
            <path
              className="focus-ring"
              d={r.ring}
              fill="none"
              stroke="var(--color-accent-fg)"
              strokeWidth={VESSEL_ORBIT_STROKE_WIDTH_SELECTED_PX + 4}
              strokeOpacity={0.9}
              pointerEvents="none"
            />
            {/* A wider transparent stroke enlarges the hit target without changing the drawn weight. */}
            <path
              data-hit-target="true"
              d={r.ring}
              fill="none"
              stroke="transparent"
              strokeWidth={14}
            />
            <path
              data-ring="true"
              d={r.ring}
              fill="none"
              stroke={r.colour}
              strokeOpacity={r.opacity}
              // Selected is brighter and thicker, two cues so selection does not rely on colour contrast alone.
              strokeWidth={
                selected
                  ? VESSEL_ORBIT_STROKE_WIDTH_SELECTED_PX
                  : VESSEL_ORBIT_STROKE_WIDTH_PX
              }
            />
          </InteractiveMarker>
          {dot}
        </>
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
    case "travelling-pulse":
      return nowUt === undefined ? null : (
        <TravellingPulse resolved={r} nowUt={nowUt} />
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
            onKeyDown: activateOnKey(activate),
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

/** Radius of the marker at an `orbit-path` entity's own anomaly, showing where on the ring its data points. */
const ORBIT_DOT_RADIUS_PX = 2.5;

/** Vessel rings draw thinner than a body orbit ring; this layer's SVG never zooms, so a constant width is already screen-constant. */
const VESSEL_ORBIT_STROKE_WIDTH_PX = 1;
/** Selected rings are thicker as well as brighter. */
const VESSEL_ORBIT_STROKE_WIDTH_SELECTED_PX = 2;

const LAYER_SVG: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "block",
  // Empty space stays click-through to the diagram beneath; each interactive point re-enables pointer events.
  pointerEvents: "none",
};

const POINT_INTERACTIVE_STYLE: CSSProperties = {
  cursor: "pointer",
  pointerEvents: "auto",
};

const POINT_STATIC_STYLE: CSSProperties = { pointerEvents: "none" };

const InteractiveMarker = styled.g`
  outline: none;
  .focus-ring {
    visibility: hidden;
  }
  &:focus-visible .focus-ring {
    visibility: visible;
  }
`;
