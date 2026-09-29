import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import type { HTMLAttributes } from "react";
import styled from "styled-components";
import { TONE_MARK } from "./tone";

/**
 * The one track height a bar has. A mark drawn over it sits one pixel inside
 * each edge, in a layer of its own, since the track's `overflow: hidden`
 * rounds the fill.
 */
const TRACK_HEIGHT = "8px";

export interface BarTrackProps extends HTMLAttributes<HTMLDivElement> {
  /** The filled share, 0-100, already clamped; `null` draws the empty track alone. */
  percent: number | null;
  tone: Tone;
  /** An arbitrary CSS colour that wins outright over the tone fill. */
  fillColor?: string;
  /** The capacity has stopped being current: the unfilled part hatches. */
  trackHeld?: boolean;
  /** The reading has stopped being current: the fill dims. */
  fillHeld?: boolean;
}

/**
 * The track and fill `Meter` and `ProgressBar` both draw. The two differ in
 * role (`meter` against `progressbar`) and in what they take, never in how the
 * bar looks, so the role and its aria attributes arrive through `rest`.
 */
export function BarTrack({
  percent,
  tone,
  fillColor,
  trackHeld = false,
  fillHeld = false,
  children,
  ...rest
}: BarTrackProps) {
  return (
    <BarTrack__Track data-track-held={trackHeld ? "" : undefined} {...rest}>
      {percent !== null && (
        <BarTrack__Fill
          $tone={tone}
          $fillColor={fillColor}
          $held={fillHeld}
          data-fill-held={fillHeld ? "" : undefined}
          style={{ width: `${percent}%` }}
        />
      )}
      {trackHeld && (
        <BarTrack__Hatch
          data-track-hatch=""
          style={{ left: `${percent ?? 0}%` }}
        />
      )}
      {children}
    </BarTrack__Track>
  );
}

/* The edge stays solid whether or not the capacity is current: a held capacity is drawn by BarTrack__Hatch inside it. */
const BarTrack__Track = styled.div`
  width: 100%;
  border-radius: var(--radius-pill);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-subtle);
  overflow: hidden;
  /* Positioned for the fill only: this overflow rounds the fill's ends and would clip any mark drawn over it. */
  position: relative;
  height: ${TRACK_HEIGHT};
`;

/**
 * The unfilled part of a track whose capacity has stopped being current,
 * hatched thinly in the held mark's hue: the extent is what aged, so the
 * figure's fill is left clear of it. Static, so there is no motion to reduce.
 */
const BarTrack__Hatch = styled.div`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  background-image: repeating-linear-gradient(
    -45deg,
    ${TONE_MARK.warn} 0 1px,
    transparent 1px 4px
  );
  opacity: 0.55;
  pointer-events: none;
`;

const BarTrack__Fill = styled.div<{
  $tone: Tone;
  $fillColor?: string;
  $held: boolean;
}>`
  height: 100%;
  border-radius: var(--radius-pill);
  transition: width var(--duration-slow) var(--ease-standard);
  /* A held reading dims the fill, not the hue and not the whole bar, so a label beside it stays readable. */
  ${({ $held }) => ($held ? "opacity: 0.55;" : "")}
  background: ${({ $tone, $fillColor }) => $fillColor ?? TONE_MARK[$tone]};

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;
