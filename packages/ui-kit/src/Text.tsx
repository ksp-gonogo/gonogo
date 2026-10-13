import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";
import { TONE_TEXT } from "./tone";

/**
 * How far plain text recedes: `muted` for secondary text, `faint` the quietest
 * tier below it, for a readout that should recede, such as the number echoing
 * a value already drawn as a bar. Useful for letting the operator's eye pass over words that
 * support a figure. Taken by the `level` prop of {@link Text}.
 *
 * @category Typography
 */
export type TextLevel = "muted" | "faint";

/**
 * The type-scale steps {@link Text}'s `size` accepts, smallest to largest:
 * `xs` for dense rows, `sm` for values, `base` for prose, `lg` for a headline
 * figure. Useful for sizing words so the operator can tell a label from a
 * value. Taken by the `size` prop of {@link Text}.
 *
 * @category Typography
 */
export type TextSize = "xs" | "sm" | "base" | "lg";

/**
 * The font weights {@link Text}'s `weight` accepts: `regular` (400) and
 * `semibold` (600). Useful for marking the key figure in a line of words for
 * the operator. Taken by the `weight` prop of {@link Text}.
 *
 * @category Typography
 */
export type TextWeight = "regular" | "semibold";

/**
 * Props for {@link Text}. Any other `span` attribute passes through. Useful for
 * colouring and sizing the words around a figure so the operator can tell a
 * label from a value. Taken by {@link Text}.
 *
 * @category Typography
 */
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
  /** The text, or inline content such as a {@link Unit}. */
  children?: ReactNode;
}

const LEVEL_COLOR: Record<TextLevel, string> = {
  muted: "var(--color-text-muted)",
  faint: "var(--color-text-faint)",
};

/**
 * Inline style declarations that recede every neutral word inside a box to the
 * faint text level, which still meets WCAG AA contrast on a panel. Useful for
 * quieting a block of words the operator should not act on, such as a figure
 * with no vessel behind it. Used by the landing status solution readouts. The
 * same declarations as {@link faintText}, for a `style` prop.
 *
 * It sets `color` and the neutral, primary, muted and dim text variables to
 * that faint colour, so nested kit text recedes with it. A word in a tone keeps
 * its tone. Keep opacity for marks that carry no text, since it drops words
 * below contrast.
 *
 * @category Typography
 */
export const FAINT_TEXT_STYLE: Readonly<Record<string, string>> = {
  color: LEVEL_COLOR.faint,
  "--color-neutral-text": LEVEL_COLOR.faint,
  "--color-text-primary": LEVEL_COLOR.faint,
  "--color-text-muted": LEVEL_COLOR.faint,
  "--color-text-dim": LEVEL_COLOR.faint,
};

/**
 * The same declarations as {@link FAINT_TEXT_STYLE}, written as
 * `property: value;` lines for a styled-components rule. Useful for quieting a
 * block of words in a styled rule. Used by the research and development styles.
 *
 * @category Typography
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
 * An inline `span` with a tone, level, size and weight. Useful for colouring
 * and sizing the words around a figure so the operator can tell a label from a
 * value. Used by the landing status altitude rail. Digits are always
 * tabular (`font-variant-numeric: tabular-nums`), so a changing number does
 * not jitter. It renders whatever it is given, with no magnitude, unit or
 * formatting of its own.
 *
 * {@link Unit} renders a quantity and its symbol; `Text` colours and sizes the
 * span around it. The two compose, and that is the normal case.
 *
 * @example
 * ```tsx
 * import { useTelemetry } from "@ksp-gonogo/sitrep-sdk";
 * import { Cluster, Text, Unit } from "@ksp-gonogo/ui-kit";
 *
 * function AltitudeLine() {
 *   const flight = useTelemetry("vessel.flight");
 *   return (
 *     <Cluster>
 *       <Text level="muted" size="xs">Altitude</Text>
 *       <Text weight="semibold">
 *         <Unit value={flight.altitudeAsl} />
 *       </Text>
 *     </Cluster>
 *   );
 * }
 * ```
 *
 * @category Typography
 * @categoryDescription Typography
 * Text: the type levels, faint text, truncation, expandable text, subject
 * headings, visually hidden text, and the live region that announces a change.
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
