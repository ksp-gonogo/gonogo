import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import styled from "styled-components";
import { TONE_TEXT } from "./tone";

/**
 * Big centred readout, the hero element of a widget's tiny form. Fills the
 * remaining panel space and centres a single dominant value (e.g. ΔV,
 * time-to-impact, warp rate). Use `$tone` to colour-code the readout for
 * state-driven widgets.
 *
 * Pair with {@link ReadoutCaption} underneath for an optional sub-label.
 *
 * @category Readout
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
 * The compact sibling of {@link BigReadout}: the same hero treatment at a
 * smaller size, sitting inline alongside other content rather than filling the
 * panel. `$tone` colours it.
 *
 * @category Readout
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

/**
 * Muted uppercase secondary line for {@link BigReadout} and {@link Readout}
 * (e.g. a mode tag).
 *
 * @category Readout
 */
export const ReadoutCaption = styled.span`
  font-size: var(--font-size-caption);
  font-weight: 400;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
  text-transform: uppercase;
`;
