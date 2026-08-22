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

/** A moving traffic highlight riding an ALREADY-drawn `connection-line`
 *  entity: never a second render of the graph geometry, purely a decoration
 *  keyed by that entity's own id (see `commsTraffic.ts`'s module doc
 *  comment). Rendered as a travelling gradient glow along the line rather
 *  than a discrete marker, deliberately: an earlier version drew this as a
 *  circle riding the line, which read as a second vessel dot sitting on its
 *  own orbit. A sweeping highlight can't be confused with a point marker. */
export interface SystemEntityPulse {
  /** Stable identity for this pulse (its `system.uplink.pending` entry's own
   *  id): the React key, since two pulses can share an `edgeId` at once. */
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
  /**
   * Fires when a vessel display object is activated (click, Enter, Space):
   * a `point` marker, or an `orbit-path` ring that carries a `vesselId`
   * that is selectable. Connection lines and blobs stay background
   * geometry, never selectable targets, and an `orbit-path` with no
   * `vesselId` (a hypothetical non-vessel ring) stays inert too. Omitted:
   * every shape renders as a plain (non-interactive, non-focusable) marker.
   */
  onEntityActivate?: (id: string) => void;
  /**
   * Command-traffic gradient sweeps: one travelling glow per in-flight
   * `system.uplink.pending` entry, riding an already-resolved
   * `connection-line`'s endpoints via an SVG `linearGradient` whose bright
   * band is centred on the pulse's own `t`. A pulse whose `edgeId` doesn't
   * match any resolved connection-line (off-frame, or the contribution
   * hasn't drawn it) is silently skipped, the same "just doesn't render this
   * frame" contract every other entity follows. Omitted or empty: renders
   * nothing extra.
   */
  pulses?: readonly SystemEntityPulse[];
  /**
   * Real "now" UT, driving a `travelling-pulse` entity's single, non-looping
   * pass (see `systemEntities.ts`'s own doc comment on that shape): SystemView
   * owns reactivity here, a contribution supplies only the static `arriveUt`/
   * `clearUt` timestamps. Typically `useUtNow()` (real-time bookkeeping, the
   * same clock `system.uplink.pending`'s traffic pulses already use), not the
   * delayed `useViewUt()`: a CME's `stormTime` is a real-UT fact stamped by
   * the mod the instant the storm rolls, not delayed craft telemetry.
   * Omitted or `undefined`: any `travelling-pulse` entity renders nothing
   * this frame, the same "no data, no draw" contract every other entity
   * follows on a missing input.
   */
  nowUt?: number;
}

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
      // Only a vessel's own ring is selectable (`vesselId` set): a body's
      // orbit ring, drawn by `SystemDiagram` itself rather than this layer,
      // never reaches here, but a future non-vessel `orbit-path`
      // contribution shouldn't accidentally become clickable either.
      // `dotX`/`dotY` come from `projectEntityPosition`, which (via
      // `bodyPosition`) already bakes lan+argPe+trueAnomaly into an
      // ABSOLUTE point, unlike the ellipse's own `cx`/`cy`/`rotationDeg`
      // (an UNROTATED local frame the caller rotates via the wrapping `<g>`,
      // see `projectOrbitRing`'s doc comment). Nesting the dot inside that
      // same rotated `<g>` would rotate an already-rotated point a second
      // time, so it renders as a sibling instead, outside the transform.
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
                strokeWidth={VESSEL_ORBIT_STROKE_WIDTH_PX}
              />
            </g>
            {dot}
          </>
        );
      }
      const activate = () => onActivate?.(r.id);
      return (
        <>
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
              // Selected reads brighter (colour/opacity, via `decorate`'s
              // "bright" emphasis override) AND thicker: two independent
              // cues so selection is legible even where colour contrast
              // alone is marginal.
              strokeWidth={
                selected
                  ? VESSEL_ORBIT_STROKE_WIDTH_SELECTED_PX
                  : VESSEL_ORBIT_STROKE_WIDTH_PX
              }
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
      // No live UT: the same "no data, no draw" contract every other entity
      // follows on a missing input (see this prop's own doc comment).
      if (nowUt === undefined) return null;
      const dx = r.x2 - r.x1;
      const dy = r.y2 - r.y1;
      // Apex -> `to` (the shape's own tip, e.g. the CME's target body).
      const bodyPx = Math.hypot(dx, dy);
      if (!(bodyPx > 0)) return null;
      const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      const segmentLengthPx = Math.min(r.segmentLengthPx, bodyPx);
      if (!(segmentLengthPx > 0)) return null;
      const crossingS = r.clearUt - r.arriveUt;
      if (!(crossingS > 0)) return null;

      // ONE constant real rate for the whole journey, derived from the
      // crossing phase (`segmentLengthPx` over `crossingS`, both exact):
      // the apex->tip travel phase moves at this SAME rate, so a real-metres
      // ratio (this shape's long-standing trick, `systemEntities.ts`'s own
      // doc comment works the algebra) turns directly into the real-UT
      // window the wave actually occupies, no separate phase/easing logic.
      const ratePxPerS = segmentLengthPx / crossingS;
      const travelS = bodyPx / ratePxPerS;
      // Departure: derived, not carried on the wire (a contribution has no
      // wall clock to compute "now" against, only `arriveUt`/`clearUt`
      // themselves, see `systemEntities.ts`'s doc comment on this shape).
      const departUt = r.arriveUt - travelS;
      // How far PAST the tip the pulse keeps going before this render treats
      // it as fully cleared: the segment's own physical length again, the
      // same "one more length of itself" decorative stand-in this shape has
      // always used, fabricating no new number.
      const exitPx = bodyPx + segmentLengthPx;
      const leadingPx = ratePxPerS * (nowUt - departUt);
      // Hasn't departed yet, or has already fully cleared (the real event's
      // own data should have dropped this entity by `clearUt`; this is a
      // defensive bound, not the primary "when does it end" signal).
      if (!(leadingPx > 0) || leadingPx > exitPx) return null;

      const startPx = leadingPx - segmentLengthPx;
      // Fades the portion of the wave that has passed BEYOND the target
      // (local x > bodyPx) rather than leaving it full-strength: this render
      // only ever knows real speed/distance, not "how far past the target
      // has it actually travelled", so a hard cutoff (or no fade at all)
      // would overstate a precision the underlying data doesn't carry.
      // Scales with the pulse's own length so a long pulse fades over a
      // proportionally long tail and a short one over a short one, floored
      // so a near-zero-length pulse still gets a visible fade band.
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
            {/* Fixed in the apex-anchored local frame, so the segment
                doesn't render before it has departed the apex (a real UT-
                driven render has no CSS animation to compose with, so this
                is just a static bound, not a moving-target sync problem the
                old looping version had to solve). */}
            <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
              <rect
                x={-TRAVELLING_PULSE_CLIP_PAD_PX}
                y={-TRAVELLING_PULSE_CLIP_HALF_HEIGHT_PX}
                width={exitPx + TRAVELLING_PULSE_CLIP_PAD_PX}
                height={TRAVELLING_PULSE_CLIP_HALF_HEIGHT_PX * 2}
              />
            </clipPath>
            {/* Pinned to the TARGET's own local x (`bodyPx`), not to the
                wave's current position: the wave's polyline points move
                frame to frame, this band stays put over the target. */}
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
            {/* A sine-wave polyline rather than a plain line: reads as
                wavy, energetic ejecta instead of a smooth static dash.
                Points are computed directly at the wave's CURRENT position
                (`startPx`) each render: a single real-UT-driven pass has no
                animation to compose with, so there's no need for the
                separate static/animated `<g>` split the old looping
                version needed. */}
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

/** Radius of the small marker `SystemEntitiesLayer` draws at an `orbit-path`
 *  entity's own declared position (its anomaly), alongside the ring itself:
 *  the ring shows the orbit's SHAPE, this marks WHERE on it the entity's
 *  data actually points (e.g. the same point a `connection-line` joins to),
 *  so a linked vessel reads as "here", not just "somewhere on this ring". */
const ORBIT_DOT_RADIUS_PX = 2.5;

/**
 * Every `orbit-path` entity this layer draws is a VESSEL orbit (the
 * contribution-slot's only source of that shape, `vesselOrbitsContribution.ts`):
 * deliberately THINNER than a body orbit ring (`SystemDiagram.tsx`'s own
 * `BODY_ORBIT_STROKE_WIDTH`, drawn in the same diagram), so the two classes
 * read as visually distinct rather than identical lines. This layer's own SVG
 * is the diagram's static auto-fit projection (zoom=1, no live pan/zoom, see
 * `SystemEntitiesContext`'s doc comment), so unlike `SystemDiagram.tsx`'s
 * `/zoom`-divided strokes, a plain constant here already stays screen-constant.
 */
const VESSEL_ORBIT_STROKE_WIDTH_PX = 1;
/** Selected: brighter (via `decorate`'s "bright" emphasis, unrelated to this
 *  file) AND thicker than its own unselected width, so selection reads as a
 *  clear step up rather than a colour change alone. */
const VESSEL_ORBIT_STROKE_WIDTH_SELECTED_PX = 2;

/** Half-width, in `t` units along the edge, of the pulse's bright band: a
 *  travelling gradient highlight rather than a discrete marker, so command
 *  traffic can't be mistaken for a vessel point riding the line. */
const PULSE_BAND_T = 0.14;
/** Gradient band ends: same faint grey the CommNet lines themselves already
 *  draw in (`EMPHASIS_COLOUR.faint`, `systemEntities.ts`), so the sweep
 *  reads as a highlight moving along the line rather than a new colour. */
const PULSE_BASE_COLOUR = "var(--color-text-faint)";
/** Gradient band peak: a dim, desaturated white (`--color-text-primary`,
 *  the body-text token), brighter than the faint base so the sweep still
 *  reads as a highlight, but deliberately NOT the bright accent green:
 *  that colour is reserved for "selected/active" state elsewhere in this
 *  layer (focus rings, the active vessel's own marker), and traffic riding
 *  the same hue read as a second selection signal rather than motion. */
const PULSE_PEAK_COLOUR = "var(--color-text-primary)";
/** Thin: a light sweep riding the line, not a fat marker that could be
 *  mistaken for a vessel point or an orbit ring (`connection-line`'s own
 *  1.4px, `orbit-path`'s 1.2px). */
const PULSE_STROKE_WIDTH_PX = 1.2;

const TRAVELLING_PULSE_STROKE_WIDTH_PX = 2;
/** Left padding on the static exit clip, so anti-aliasing at the segment's
 *  own trailing edge never gets a hard crop right at its start position. */
const TRAVELLING_PULSE_CLIP_PAD_PX = 4;
/** Half-height of the static exit clip: comfortably clears the sine wave's
 *  amplitude plus stroke width, since the clip only needs to bound the
 *  travel AXIS (x), never the wave's own y excursion. */
const TRAVELLING_PULSE_CLIP_HALF_HEIGHT_PX = 40;
/** Sine-wave texture along the pulse's own length: reads as wavy, energetic
 *  ejecta rather than a smooth dash. Wavelength/amplitude are fixed pixel
 *  constants (not scaled to the segment's length) so a long pulse reads as
 *  many small ripples and a short one as a couple, never stretched thin or
 *  bunched tight. */
const TRAVELLING_PULSE_WAVELENGTH_PX = 12;
const TRAVELLING_PULSE_AMPLITUDE_PX = 3;
const TRAVELLING_PULSE_SAMPLE_STEP_PX = 2;
/** How far past the target (as a fraction of the pulse's own on-screen
 *  length) the fade band extends before the trailing portion is fully
 *  invisible: see `Primitive`'s "travelling-pulse" case. */
const TRAVELLING_PULSE_FADE_FRACTION = 0.6;
/** Floor on the fade distance, so a very short (near-clamped) pulse still
 *  gets a visible fade band rather than an effectively-instant cutoff. */
const TRAVELLING_PULSE_MIN_FADE_PX = 2;

/** `points` for a `<polyline>` sine wave, `lengthPx` long, shifted by
 *  `offsetPx` (default 0): the wave's TEXTURE (ripple phase) is always
 *  computed from the segment's own local x in `[0, lengthPx]`, so it stays
 *  rigidly painted on the segment rather than sliding independently of it;
 *  `offsetPx` only moves where that whole textured segment sits, letting a
 *  caller position the CURRENT wave without regenerating its ripple phase.
 *  Exported for testing. */
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
