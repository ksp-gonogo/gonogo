import type { CSSProperties, KeyboardEvent } from "react";
import { useMemo } from "react";
// An SVG <g> keyboard focus ring (a pseudo-class plus descendant rule) that inline style cannot express, shared by point markers and vessel rings.
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

/** A traffic highlight riding an already-drawn `connection-line` entity, keyed by its id: a sweeping glow, so it cannot be mistaken for a vessel dot. */
export interface SystemEntityPulse {
  /** The `system.uplink.pending` entry's id, used as the React key since two pulses can share an `edgeId`. */
  id: string;
  /** The `connection-line` entity id this pulse currently sits on. */
  edgeId: string;
  /** 0..1 along the edge's own a -> b direction (its x1,y1 -> x2,y2 draw order). */
  t: number;
  opacity: number;
}

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

  const resolvedPulses = useMemo(() => {
    if (!pulses || pulses.length === 0) return [];
    const edgesById = new Map(
      resolved
        .filter((r) => r.kind === "connection-line")
        .map((r) => [r.id, r] as const),
    );
    return pulses.flatMap((p) => {
      const edge = edgesById.get(p.edgeId);
      if (!edge || edge.kind !== "connection-line") return [];
      const t = Math.min(Math.max(p.t, 0), 1);
      return [
        {
          id: p.id,
          edgeId: p.edgeId,
          opacity: p.opacity,
          x1: edge.x1,
          y1: edge.y1,
          x2: edge.x2,
          y2: edge.y2,
          t,
          bandStart: Math.max(0, t - PULSE_BAND_T),
          bandEnd: Math.min(1, t + PULSE_BAND_T),
        },
      ];
    });
  }, [pulses, resolved]);

  if (resolved.length === 0 && resolvedPulses.length === 0) return null;

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
      {resolvedPulses.length > 0 && (
        <defs>
          {resolvedPulses.map((p) => (
            <linearGradient
              key={p.id}
              id={`system-entities-pulse-${p.id}`}
              gradientUnits="userSpaceOnUse"
              x1={p.x1}
              y1={p.y1}
              x2={p.x2}
              y2={p.y2}
            >
              <stop
                offset={p.bandStart}
                stopColor={PULSE_BASE_COLOUR}
                stopOpacity={0}
              />
              <stop
                offset={p.t}
                stopColor={PULSE_PEAK_COLOUR}
                stopOpacity={p.opacity}
              />
              <stop
                offset={p.bandEnd}
                stopColor={PULSE_BASE_COLOUR}
                stopOpacity={0}
              />
            </linearGradient>
          ))}
        </defs>
      )}
      {resolvedPulses.map((p) => (
        <line
          key={p.id}
          data-pulse-edge-id={p.edgeId}
          x1={p.x1}
          y1={p.y1}
          x2={p.x2}
          y2={p.y2}
          stroke={`url(#system-entities-pulse-${p.id})`}
          strokeWidth={PULSE_STROKE_WIDTH_PX}
          strokeLinecap="round"
          pointerEvents="none"
        />
      ))}
    </svg>
  );
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
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                activate();
              }
            }}
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
    case "travelling-pulse": {
      if (nowUt === undefined) return null;
      const dx = r.x2 - r.x1;
      const dy = r.y2 - r.y1;
      const bodyPx = Math.hypot(dx, dy);
      if (!(bodyPx > 0)) return null;
      const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      const segmentLengthPx = Math.min(r.segmentLengthPx, bodyPx);
      if (!(segmentLengthPx > 0)) return null;
      const crossingS = r.clearUt - r.arriveUt;
      if (!(crossingS > 0)) return null;

      // One constant rate for the whole journey, from the crossing phase, so the real-metres ratio maps straight onto the real-UT window the wave occupies.
      const ratePxPerS = segmentLengthPx / crossingS;
      const travelS = bodyPx / ratePxPerS;
      // Derived here: a contribution has no wall clock, only `arriveUt` and `clearUt`.
      const departUt = r.arriveUt - travelS;
      // The pulse keeps going one segment length past the tip before it counts as cleared.
      const exitPx = bodyPx + segmentLengthPx;
      const leadingPx = ratePxPerS * (nowUt - departUt);
      // A defensive bound; the event's own data should drop this entity by `clearUt`.
      if (!(leadingPx > 0) || leadingPx > exitPx) return null;

      const startPx = leadingPx - segmentLengthPx;
      // Past the target the wave fades rather than cutting off, since the data carries no precise overshoot; the band scales with the pulse length, floored.
      const fadeDistancePx = Math.max(
        segmentLengthPx * TRAVELLING_PULSE_FADE_FRACTION,
        TRAVELLING_PULSE_MIN_FADE_PX,
      );
      const clipId = `system-entities-pulse-clip-${r.id}`;
      const gradientId = `system-entities-pulse-fade-${r.id}`;
      return (
        <g
          transform={`translate(${r.x1} ${r.y1}) rotate(${angleDeg})`}
          pointerEvents="none"
          data-entity-id={r.id}
        >
          <defs>
            {/* Fixed in the apex-anchored frame, so the segment never renders before it departs. */}
            <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
              <rect
                x={-TRAVELLING_PULSE_CLIP_PAD_PX}
                y={-TRAVELLING_PULSE_CLIP_HALF_HEIGHT_PX}
                width={exitPx + TRAVELLING_PULSE_CLIP_PAD_PX}
                height={TRAVELLING_PULSE_CLIP_HALF_HEIGHT_PX * 2}
              />
            </clipPath>
            {/* Pinned over the target, not to the wave's moving position. */}
            <linearGradient
              id={gradientId}
              gradientUnits="userSpaceOnUse"
              x1={bodyPx}
              y1={0}
              x2={bodyPx + fadeDistancePx}
              y2={0}
            >
              <stop offset={0} stopColor={r.colour} stopOpacity={r.opacity} />
              <stop offset={1} stopColor={r.colour} stopOpacity={0} />
            </linearGradient>
          </defs>
          <g clipPath={`url(#${clipId})`}>
            {/* Points are computed at the wave's current position each render. */}
            <polyline
              points={travellingPulseWavePoints(segmentLengthPx, startPx)}
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth={TRAVELLING_PULSE_STROKE_WIDTH_PX}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </g>
      );
    }
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

/** Radius of the marker at an `orbit-path` entity's own anomaly, showing where on the ring its data points. */
const ORBIT_DOT_RADIUS_PX = 2.5;

/** Vessel rings draw thinner than a body orbit ring; this layer's SVG never zooms, so a constant width is already screen-constant. */
const VESSEL_ORBIT_STROKE_WIDTH_PX = 1;
/** Selected rings are thicker as well as brighter. */
const VESSEL_ORBIT_STROKE_WIDTH_SELECTED_PX = 2;

/** Half-width, in `t` units along the edge, of the pulse's bright band. */
const PULSE_BAND_T = 0.14;
/** The faint grey the CommNet lines draw in, so the sweep reads as a highlight moving along the line. */
const PULSE_BASE_COLOUR = "var(--color-text-faint)";
/** Brighter than the base but not the accent green, which this layer reserves for selection. */
const PULSE_PEAK_COLOUR = "var(--color-text-primary)";
/** Thin enough that the sweep cannot be mistaken for a vessel point or an orbit ring. */
const PULSE_STROKE_WIDTH_PX = 1.2;

const TRAVELLING_PULSE_STROKE_WIDTH_PX = 2;
/** Left padding on the exit clip so anti-aliasing at the trailing edge is not hard-cropped. */
const TRAVELLING_PULSE_CLIP_PAD_PX = 4;
/** Half-height of the exit clip; it only bounds the travel axis, so this just clears the wave's amplitude. */
const TRAVELLING_PULSE_CLIP_HALF_HEIGHT_PX = 40;
/** Fixed pixel ripple constants, so a long pulse reads as many ripples rather than a stretched one. */
const TRAVELLING_PULSE_WAVELENGTH_PX = 12;
const TRAVELLING_PULSE_AMPLITUDE_PX = 3;
const TRAVELLING_PULSE_SAMPLE_STEP_PX = 2;
/** How far past the target, as a fraction of the pulse's on-screen length, the fade band extends. */
const TRAVELLING_PULSE_FADE_FRACTION = 0.6;
/** Floor on the fade distance so a near-clamped pulse still gets a visible fade. */
const TRAVELLING_PULSE_MIN_FADE_PX = 2;

/** `points` for a sine-wave polyline `lengthPx` long; the ripple phase is painted on the segment's local x, and `offsetPx` only moves the whole segment. */
export function travellingPulseWavePoints(
  lengthPx: number,
  offsetPx = 0,
): string {
  const steps = Math.max(
    1,
    Math.round(lengthPx / TRAVELLING_PULSE_SAMPLE_STEP_PX),
  );
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const localX = (i / steps) * lengthPx;
    const y =
      TRAVELLING_PULSE_AMPLITUDE_PX *
      Math.sin((localX / TRAVELLING_PULSE_WAVELENGTH_PX) * 2 * Math.PI);
    points.push(`${localX + offsetPx},${y}`);
  }
  return points.join(" ");
}

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
