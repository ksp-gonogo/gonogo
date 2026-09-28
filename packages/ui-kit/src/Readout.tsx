import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import styled, { css } from "styled-components";
import { fitBox } from "./fitBox";
import { TONE_MUTED, TONE_TEXT, toneEdge } from "./tone";

/**
 * Big centred readout: typical "tiny mode" hero element. Fills the remaining
 * panel space and centres a single dominant value (e.g. ΔV, time-to-impact,
 * warp rate). Use `$tone` to colour-code the readout for state-driven widgets.
 *
 * Pair with `<ReadoutCaption>` underneath for an optional sub-label.
 */
export const BigReadout = styled.div<{ $tone?: Tone }>`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--gap-tiny-content);
  text-align: center;
  /* A fluid size off the type scale, with a line height tuned to it so descenders do not clip. */
  font-size: clamp(20px, 6vw, 38px);
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1.05;
  color: ${({ $tone }) => TONE_TEXT[$tone ?? "neutral"]};
  min-width: 0;
`;

/**
 * Smaller-scale variant for "small" responsive modes: same hero treatment
 * but at a compact size. Doesn't fill, sits alongside other content.
 */
export const Readout = styled.div<{ $tone?: Tone }>`
  display: inline-flex;
  align-items: baseline;
  gap: var(--gap-value-tag);
  /* Display tier: the type scale stops at lg, so this stays literal. */
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: ${({ $tone }) => TONE_TEXT[$tone ?? "neutral"]};
`;

/** Muted secondary line for both readout sizes (e.g. units, mode tag). */
export const ReadoutCaption = styled.span`
  font-size: var(--font-size-caption);
  font-weight: 400;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
  text-transform: uppercase;
`;

/**
 * Status pill: single-token badge ("NOMINAL", "GO", "ABORT"), for tiny-mode
 * widgets that boil their state down to one indicator.
 */
export const StatusPill = styled.div<{ $tone: Tone }>`
  ${fitBox("status-pill")}
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* --inset-control's value, not the token: a status pill is read, never pressed, so it must not widen for touch. */
  padding: var(--inset-pill);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-caption);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: ${({ $tone }) => TONE_TEXT[$tone]};
  background: ${({ $tone }) => TONE_MUTED[$tone]};
  border: 1px solid ${({ $tone }) => toneEdge($tone)};
  ${({ $tone }) =>
    $tone === "nogo" &&
    css`
      @media (prefers-reduced-motion: no-preference) {
        animation: pill-pulse 1.4s var(--ease-emphasis) infinite;
      }
      @keyframes pill-pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.7;
        }
      }
    `}
`;
