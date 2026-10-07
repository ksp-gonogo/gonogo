import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import type { ComponentPropsWithoutRef } from "react";
import styled, { css } from "styled-components";
import { TONE_TEXT } from "./tone";

/**
 * Where a {@link Readout} sits: `hero` fills the remaining panel space and centres, `inline` sits baseline-aligned beside other content.
 *
 * @category Readout
 */
export type ReadoutSize = "hero" | "inline";

const Readout__Box = styled.div<{ $size: ReadoutSize; $tone: Tone }>`
  display: ${({ $size }) => ($size === "hero" ? "flex" : "inline-flex")};
  font-weight: 700;
  letter-spacing: 0.04em;
  color: ${({ $tone }) => TONE_TEXT[$tone]};
  ${({ $size }) =>
    $size === "hero"
      ? css`
          flex: 1;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: var(--gap-tiny-content);
          text-align: center;
          /* A fluid size off the type scale, with a line height tuned to it so descenders do not clip. */
          font-size: clamp(20px, 6vw, 38px);
          line-height: 1.05;
          min-width: 0;
        `
      : css`
          align-items: baseline;
          gap: var(--gap-value-tag);
          /* Display tier: the type scale stops at lg, so this stays literal. */
          font-size: 22px;
        `}
`;

/**
 * The display-tier figure: bold, tracked, coloured by tone.
 *
 * `size="hero"` is the dominant value of a widget's tiny form (ΔV, time to
 * impact, warp rate): it fills the remaining panel space and centres. The
 * default `size="inline"` is the same treatment smaller, sitting beside other
 * content.
 *
 * Pair with {@link ReadoutCaption} for an optional sub-label.
 *
 * @category Readout
 * @categoryDescription Readout
 * Figures that stand on their own: the bold display readout, a labelled stat, a
 * data line, and the stats contributed to a widget.
 */
export function Readout({
  size = "inline",
  tone = "neutral",
  ...rest
}: ComponentPropsWithoutRef<"div"> & {
  /** Where it sits. Defaults to `inline`. */
  size?: ReadoutSize;
  /** Colour-codes the figure for state-driven widgets. Defaults to `neutral`. */
  tone?: Tone;
}) {
  return <Readout__Box $size={size} $tone={tone} {...rest} />;
}

/**
 * Muted uppercase secondary line for a {@link Readout}
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
