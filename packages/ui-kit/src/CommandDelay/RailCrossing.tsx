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
 *   continuous one is a ribbon lying along it, an amplitude per sample, newest
 *   at this end and older further out
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
// Half the ribbon's full-scale height, in viewBox units. Short by design: the
// collapsed rail is a band, not a meter.
const RIBBON_HALF_H = 5.5;
const MID_Y = VB_H / 2;
const DOT_R = 2.2;

/** Where the presumed target sits: halfway when there is a leg back, the far end when not. */
export function crossingBoundaryX(returnLeg: boolean): number {
  return returnLeg ? VB_W / 2 : VB_W - EDGE;
}

const clamp01 = (v: number): number =>
  !Number.isFinite(v) ? 0 : v < 0 ? 0 : v > 1 ? 1 : v;

/**
 * Turn a newest-last amplitude ring into the closed outline of a waveform
 * ribbon: out along the top from this end to the boundary, back along the
 * bottom. Exported for direct assertion, since the geometry is the whole of
 * what this component decides.
 */
export function ribbonPath(
  amplitudes: readonly number[],
  spanSamples: number,
  boundaryX: number,
): string {
  const span = Math.max(1, spanSamples);
  const top: string[] = [];
  const bottom: string[] = [];
  // Newest first: index 0 of the walk is `now`, at this end of the rail.
  for (let age = 0; age < amplitudes.length; age++) {
    if (age > span) break;
    const a = clamp01(amplitudes[amplitudes.length - 1 - age]);
    const x = (age / span) * boundaryX;
    const dy = a * RIBBON_HALF_H;
    top.push(`${x.toFixed(2)},${(MID_Y - dy).toFixed(2)}`);
    bottom.unshift(`${x.toFixed(2)},${(MID_Y + dy).toFixed(2)}`);
  }
  if (top.length === 0) return "";
  return `M${top.join(" L")} L${bottom.join(" L")} Z`;
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
  const path =
    mark === "ribbon"
      ? ribbonPath(samples, spanSamples ?? samples.length, boundaryX)
      : "";
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
          arrives, so it is clearest where it lands. `gradientUnits` is the
          default objectBoundingBox, so the ramp spans the drawn shape rather
          than the box, and a short ribbon fades over its own length.
        */}
        <linearGradient
          id={fadeId}
          x1={railFlow(tags) === "outbound" ? "0" : "1"}
          y1="0"
          x2={railFlow(tags) === "outbound" ? "1" : "0"}
          y2="0"
        >
          <stop offset="0" stopColor={tone} stopOpacity="0.55" />
          <stop offset="1" stopColor={tone} stopOpacity="0.05" />
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
        <path
          data-role="ribbon"
          d={path}
          fill={`url(#${fadeId})`}
          stroke="none"
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
     ribbon has no transition: its motion IS the data arriving. */
  [data-role="dot"] {
    transition: cx var(--duration-slow, 200ms) linear;
  }

  @media (prefers-reduced-motion: reduce) {
    [data-role="dot"] {
      transition: none;
    }
  }
`;
