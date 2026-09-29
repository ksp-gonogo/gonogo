import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";
import { TONE_TEXT } from "./tone";

/**
 * How far plain text recedes: `muted` for secondary text, `faint` the quietest
 * tier below it, for a readout that should recede rather than compete, like
 * the numeric echo beside an analog stick.
 *
 * @category Text
 */
export type TextLevel = "muted" | "faint";
export type TextSize = "xs" | "sm" | "base" | "lg";
export type TextWeight = "regular" | "semibold";

export interface TextProps extends HTMLAttributes<HTMLSpanElement> {
  /** The state the text shows. Defaults to `neutral`, the primary text colour. */
  tone?: Tone;
  /**
   * Recedes neutral text to a quieter tier. A text with a state keeps its
   * tone's colour, since a state is never dimmed away, so
   * `tone={alarm ? "nogo" : undefined} level="faint"` reads faint until the
   * alarm.
   */
  level?: TextLevel;
  /** Adds `margin-left: 2px` so the value sits apart from a preceding label. */
  spaced?: boolean;
  /**
   * Font size, snapped to the type scale. Omit to inherit the ambient
   * font-size; set it for dense list or grid rows that need to stay off the
   * body-text size.
   */
  size?: TextSize;
  /** Font weight. Omit to inherit the ambient weight; set `semibold` to emphasise a key figure. */
  weight?: TextWeight;
  children?: ReactNode;
}

const LEVEL_COLOR: Record<TextLevel, string> = {
  muted: "var(--color-text-muted)",
  faint: "var(--color-text-faint)",
};

/**
 * Recedes every neutral word inside a box to the faint text level, which still
 * clears AA on the panel. The way to quiet a block of words: opacity drops them
 * below contrast, so it is kept for marks that carry no text. A word in a tone
 * keeps its tone, since a state is never dimmed away. The same declarations as
 * {@link faintText}, for a `style` prop.
 *
 * @category Text
 */
export const FAINT_TEXT_STYLE: Readonly<Record<string, string>> = {
  color: LEVEL_COLOR.faint,
  "--color-neutral-text": LEVEL_COLOR.faint,
  "--color-text-primary": LEVEL_COLOR.faint,
  "--color-text-muted": LEVEL_COLOR.faint,
  "--color-text-dim": LEVEL_COLOR.faint,
};

/**
 * {@link FAINT_TEXT_STYLE} as declarations for a styled-components rule.
 *
 * @category Text
 */
export function faintText(): string {
  return Object.entries(FAINT_TEXT_STYLE)
    .map(([property, value]) => `${property}: ${value};`)
    .join("\n");
}

const WEIGHT_STYLES = {
  regular: css`
    font-weight: 400;
  `,
  semibold: css`
    font-weight: 600;
  `,
} as const;

const SIZE_STYLES = {
  xs: css`
    font-size: var(--font-size-compact);
  `,
  sm: css`
    font-size: var(--font-size-value);
  `,
  base: css`
    font-size: var(--font-size-prose);
  `,
  lg: css`
    font-size: var(--font-size-figure);
  `,
} as const;

/**
 * Inline text: tone, size, weight, spacing. `font-variant-numeric: tabular-nums`
 * is baked in so widgets never forget it and digits don't jitter as they update.
 * It renders whatever it is given, with no magnitude, unit or formatting.
 *
 * `Unit` renders a quantity and its symbol; this colours and sizes a span. They
 * compose, and that composition is the normal case:
 *
 *     <Text tone="go"><Unit value={altitude} /></Text>
 */
export function Text({
  tone = "neutral",
  level,
  spaced = false,
  size,
  weight,
  children,
  ...rest
}: TextProps) {
  return (
    <Text__Root
      $color={
        tone === "neutral" && level !== undefined
          ? LEVEL_COLOR[level]
          : TONE_TEXT[tone]
      }
      $spaced={spaced}
      $size={size}
      $weight={weight}
      {...rest}
    >
      {children}
    </Text__Root>
  );
}

const Text__Root = styled.span<{
  $color: string;
  $spaced: boolean;
  $size?: TextSize;
  $weight?: TextWeight;
}>`
  font-variant-numeric: tabular-nums;
  color: ${({ $color }) => $color};
  ${({ $size }) => $size && SIZE_STYLES[$size]}
  ${({ $weight }) => $weight && WEIGHT_STYLES[$weight]}
  ${({ $spaced }) => $spaced && `margin-left: var(--gap-lead-figure);`}
`;
