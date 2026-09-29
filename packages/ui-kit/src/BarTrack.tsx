import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import styled from "styled-components";
import { TONE_MARK } from "./tone";

/**
 * The one track height a bar has. A mark drawn over it sits one pixel inside
 * each edge, in a layer of its own, since the track's `overflow: hidden`
 * rounds the fill.
 */
const TRACK_HEIGHT = "8px";

/**
 * The track `Meter` and `ProgressBar` both draw their fill in. The two differ
 * in role (`meter` against `progressbar`) and in what they take, never in
 * how the bar looks.
 *
 * A held capacity dashes the track's edge in the held mark's hue, which clears
 * 3:1 against the panel where the subtle border does not: colour already means
 * the fill's status.
 */
export const BarTrack = styled.div<{ $held?: boolean }>`
  width: 100%;
  border-radius: var(--radius-pill);
  background: var(--color-surface-raised);
  border: 1px
    ${({ $held }) =>
      $held ? `dashed ${TONE_MARK.warn}` : "solid var(--color-border-subtle)"};
  overflow: hidden;
  /* Positioned for the fill only: this overflow rounds the fill's ends and would clip any mark drawn over it. */
  position: relative;
  height: ${TRACK_HEIGHT};
`;

/** The filled share of a {@link BarTrack}; its width is set inline by the caller. */
export const BarFill = styled.div<{
  $tone: Tone;
  $fillColor?: string;
  $held?: boolean;
}>`
  height: 100%;
  border-radius: var(--radius-pill);
  transition: width var(--duration-slow) var(--ease-standard);
  /* A held reading dims the fill, not the hue and not the whole bar, so a label beside it stays readable. */
  ${({ $held }) => ($held ? "opacity: 0.55;" : "")}
  /* $fillColor is an arbitrary CSS colour and wins outright over the tone fill. */
  background: ${({ $tone, $fillColor }) => $fillColor ?? TONE_MARK[$tone]};

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;
