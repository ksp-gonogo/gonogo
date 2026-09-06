import { useId } from "react";
import styled from "styled-components";
import {
  type RailTags,
  railDrawsReturnLeg,
  railFlow,
  railMark,
  railToneToken,
} from "./railTags";

/**
 * One tagged thing crossing the gap, drawn from its three axes and nothing
 * else. The sibling of `InFlightList`'s grazing glow and `ControlDelayStream`'s
 * three-zone strip, for the rows of the rail table those two cannot express.
 *
 * Each axis lands on exactly one property here, which is what makes this a
 * model rather than a shape bolted on for voice:
 *
 * - CONTINUITY picks the mark. A discrete entry is a dot travelling the rail; a
 *   continuous one is a ribbon, drawn as a waveform trace lying along it, an
 *   amplitude per sample, newest at this end and older further out
 * - DELIVERY picks where the journey ENDS. Acked, the track is out and back and
 *   the boundary sits halfway; fire-and-forget, the track is the outbound leg
 *   alone and the entry reaches the boundary and simply stops. Nothing is drawn
 *   coming back, because nothing is coming back
 * - DIRECTION picks the tone, and which way the fade runs: a command leaves
 *   from this end, telemetry arrives at it
 *
 * The boundary is the one vertical line: the presumed target, one light-time
 * away. Everything fades toward it, because confidence does.
 *
 * Props-only, no data hooks, no timers. The rail feeds it from a registration
 * and this draws the numbers it is handed.
 */
export interface RailCrossingProps {
  /** The three axes. `railTagsOf` builds one from a handle. */
  tags: RailTags;
  /**
   * The waveform, one scalar per sample in 0..1, NEWEST LAST. Only read for a
   * ribbon mark. Samples older than `spanSamples` have already arrived and are
   * dropped rather than piled up against the boundary.
   */
  amplitudes?: readonly number[];
  /**
   * How many samples span the trip to the boundary, i.e. one light-time in
   * sample counts. Defaults to the whole array, which is the honest reading
   * when the caller does not know the separation.
   */
  spanSamples?: number;
  /** For a dot mark: 0 at this end, 1 at the far end of the drawn journey. */
  progress?: number;
  /** What the crossing is, in a sentence. Becomes the graphic's accessible name. */
  label: string;
  /**
   * `"rail"` is the collapsed 16px band, `"expanded"` the grown rail's taller
   * draw, `"inline"` the in-widget size a `<CommandDelay>` rendered in a
   * widget's own body gets. Same geometry throughout, only the box height moves.
   */
  variant?: "inline" | "rail" | "expanded";
}

// viewBox units, stretched to the rail's width (preserveAspectRatio="none").
const VB_W = 100;
const VB_H = 16;
// Keeps the boundary stroke inside the box when it sits at the far end.
const EDGE = 2;
// Half the waveform's full-scale height, in viewBox units: how far a full-scale
// sample reaches either side of the centre line. Short by design, the collapsed
// rail is a band, not a meter.
const WAVE_HALF_H = 5.5;
/**
 * How far apart the trace's turning points sit, in viewBox units, i.e. HALF a
 * period.
 *
 * Fixed in the DRAWING rather than taken from the capture rate, which is the
 * whole of what makes this read as a wave. 128 chunks of 20 ms history over a
 * short light-time would otherwise put several turning points in each pixel and
 * come back out as a solid hatch, and one chunk over a long one would put none
 * in the whole band. Two units against the 100-unit box is ~25 cycles across the
 * widget however wide it is drawn.
 */
const WAVE_STEP = 2;
const MID_Y = VB_H / 2;
const DOT_R = 2.2;

/** Where the presumed target sits: halfway when there is a leg back, the far end when not. */
export function crossingBoundaryX(returnLeg: boolean): number {
  return returnLeg ? VB_W / 2 : VB_W - EDGE;
}

const clamp01 = (v: number): number =>
  !Number.isFinite(v) ? 0 : v < 0 ? 0 : v > 1 ? 1 : v;

/**
 * How far along the rail the drawn trace reaches: one light-time out at most,
 * and only as far as there is history to draw when there is less than that.
 * Samples older than the span have already arrived, so they are dropped rather
 * than piled up against the boundary.
 */
function waveformExtentX(
  amplitudes: readonly number[],
  spanSamples: number,
  boundaryX: number,
): number {
  const span = Math.max(1, spanSamples);
  return (Math.min(amplitudes.length - 1, span) / span) * boundaryX;
}

/**
 * Turn a newest-last amplitude ring into an open waveform TRACE: a line that
 * crosses the centre of the band, reaching a sample's amplitude as a peak first
 * one side and then the other. Exported for direct assertion, since the geometry
 * is the whole of what this component decides.
 *
 * It used to be the closed outline of a filled envelope, top out and bottom
 * back, and the operator read exactly what that draws: a pen that thickens where
 * the voice is loud, with nothing about it that says wave. An envelope has no
 * period, and period is what a waveform is recognised by. So the amplitude here
 * is the height of a turning point rather than the width of a stroke, and the
 * turning points come at a fixed pitch (`WAVE_STEP`), which is what keeps the
 * period visible at any density of capture.
 *
 * Silence is therefore a flat line down the middle rather than nothing at all,
 * which is the honest reading: the key is open and nobody is speaking.
 */
export function waveformPath(
  amplitudes: readonly number[],
  spanSamples: number,
  boundaryX: number,
): string {
  if (amplitudes.length === 0) return "";
  const span = Math.max(1, spanSamples);
  const extentX = waveformExtentX(amplitudes, spanSamples, boundaryX);
  const points: string[] = [];
  const steps = Math.max(1, Math.ceil(extentX / WAVE_STEP));
  for (let k = 0; k <= steps; k++) {
    const x = Math.min(k * WAVE_STEP, extentX);
    // Newest at this end: age 0 is `now`, and x walks back through the ring.
    const age = Math.min(
      Math.round((x / boundaryX) * span),
      amplitudes.length - 1,
    );
    const a = clamp01(amplitudes[amplitudes.length - 1 - age]);
    const dy = (k % 2 === 0 ? -1 : 1) * a * WAVE_HALF_H;
    points.push(`${x.toFixed(2)},${(MID_Y + dy).toFixed(2)}`);
    if (x >= extentX) break;
  }
  return `M${points.join(" L")}`;
}

export function RailCrossing({
  tags,
  amplitudes,
  spanSamples,
  progress = 0,
  label,
  variant = "rail",
}: Readonly<RailCrossingProps>) {
  // Per-instance, never a literal: two mounted crossings would both emit the
  // same `id`, and the SVG spec resolves `url(#...)` to whichever element comes
  // FIRST in document order, so one instance's fade silently wins for both.
  // `ControlDelayStream` learnt this the same way.
  const fadeId = `rail-crossing-fade-${useId()}`;
  const returnLeg = railDrawsReturnLeg(tags);
  const boundaryX = crossingBoundaryX(returnLeg);
  const tone = `var(${railToneToken(tags)})`;
  const mark = railMark(tags);
  const samples = amplitudes ?? [];
  const span = spanSamples ?? samples.length;
  const path = mark === "ribbon" ? waveformPath(samples, span, boundaryX) : "";
  // Where the fade runs from and to: the trace's OWN length, so a short one
  // fades over itself rather than over a journey it has not made. At least a
  // unit wide, since a gradient with no extent paints one flat colour.
  const fadeX = Math.max(waveformExtentX(samples, span, boundaryX), 1);
  // A ribbon with nothing in it, or a dot that has not left, is not a crossing.
  if (mark === "ribbon" && path === "") return null;

  // The journey a dot travels: the whole track when something comes back, the
  // outbound leg alone when nothing does.
  const dotX = clamp01(progress) * (returnLeg ? VB_W : boundaryX);

  return (
    <RailCrossing__Svg
      role="img"
      aria-label={label}
      data-rail-crossing=""
      data-mark={mark}
      data-flow={railFlow(tags)}
      data-return-leg={returnLeg}
      $variant={variant}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
    >
      <defs>
        {/*
          The fade, running the way the entry does: a command leaves this end
          clear and dissolves toward the target it has not reached; telemetry
          arrives, so it is clearest where it lands. In USER SPACE across the
          trace's own length rather than across its bounding box: the trace is
          stroked now, and a quiet passage is a flat line whose box has no
          height at all, which an objectBoundingBox ramp declines to paint.
        */}
        <linearGradient
          id={fadeId}
          gradientUnits="userSpaceOnUse"
          x1={railFlow(tags) === "outbound" ? 0 : fadeX}
          y1="0"
          x2={railFlow(tags) === "outbound" ? fadeX : 0}
          y2="0"
        >
          {/* Nearer full strength than the filled ribbon carried: a hairline
              trace at 0.55 is most of the way to invisible where a broad fill at
              the same value still read. */}
          <stop offset="0" stopColor={tone} stopOpacity="0.9" />
          <stop offset="1" stopColor={tone} stopOpacity="0.1" />
        </linearGradient>
      </defs>
      {/*
        The presumed target boundary, one light-time out. Drawn for every
        combination: what changes with DELIVERY is whether anything is drawn
        PAST it, never whether the far end exists.
      */}
      <line
        data-role="boundary"
        x1={boundaryX}
        y1="0"
        x2={boundaryX}
        y2={VB_H}
        stroke="var(--color-border-subtle)"
        strokeWidth="0.6"
      />
      {mark === "ribbon" && (
        /* Stroked, and stroked in SCREEN units: the box is stretched to the
           widget's width, so a scaled stroke would come out several times
           thicker across than it is tall and the near-vertical parts of the
           trace would fatten into the blob this replaced. */
        <path
          data-role="ribbon"
          d={path}
          fill="none"
          stroke={`url(#${fadeId})`}
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {mark === "dot" && (
        <circle
          data-role="dot"
          cx={dotX}
          cy={MID_Y}
          r={DOT_R}
          fill={tone}
          fillOpacity="0.55"
        />
      )}
    </RailCrossing__Svg>
  );
}

/**
 * Full-bleed, like every other rail child: the band's width IS the journey, so
 * an inset would put the boundary somewhere other than where the geometry says.
 */
const RailCrossing__Svg = styled.svg<{
  $variant: "inline" | "rail" | "expanded";
}>`
  display: block;
  width: 100%;
  height: ${(p) =>
    p.$variant === "expanded"
      ? "40px"
      : p.$variant === "inline"
        ? "24px"
        : "16px"};

  /* The dot slides between progress values rather than jumping the gap. The
     waveform has no transition: its motion IS the data arriving, and a trace
     redrawn every chunk has nothing to interpolate between. Nothing here
     animates on a timer, so there is no indefinite motion for a reduced-motion
     reader to opt out of; the guard below is the dot's. */
  [data-role="dot"] {
    transition: cx var(--duration-slow, 200ms) var(--ease-linear);
  }

  @media (prefers-reduced-motion: reduce) {
    [data-role="dot"] {
      transition: none;
    }
  }
`;
