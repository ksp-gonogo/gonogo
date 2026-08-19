import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";

/**
 * `faint` is the quietest tier, one step below `muted`: a secondary readout
 * that should recede rather than compete, like the numeric echo beside an
 * analog stick. Added because `VirtualDevice/AnalogPad` was keeping its own
 * `Value` for this one colour.
 */
export type TextTone =
  | "accent"
  | "default"
  | "muted"
  | "faint"
  | "go"
  | "warn"
  | "nogo"
  | "info";
export type TextSize = "xs" | "sm" | "base" | "lg";
export type TextWeight = "regular" | "semibold";

export interface TextProps extends HTMLAttributes<HTMLSpanElement> {
  /** Foreground colour. Defaults to `accent`. */
  tone?: TextTone;
  /** Adds `margin-left: 2px` so the value sits apart from a preceding label. */
  spaced?: boolean;
  /**
   * Font size, snapped to the type scale. Omit to inherit the ambient
   * font-size from wherever the value is mounted (the original behaviour),
   * set it explicitly for dense list/grid rows (coverage %, sensor state,
   * vessel meta) that need to stay off the 14px body-text size.
   */
  size?: TextSize;
  /**
   * Font weight. Omit to inherit the ambient weight; set `semibold` to
   * emphasise a key figure. Extracted from ScienceBench's chip/career values.
   */
  weight?: TextWeight;
  children?: ReactNode;
}

const TONE_STYLES = {
  accent: css`
    color: var(--color-accent-fg);
  `,
  default: css`
    color: var(--color-text-primary);
  `,
  muted: css`
    color: var(--color-text-muted);
  `,
  faint: css`
    color: var(--color-text-faint);
  `,
  go: css`
    color: var(--color-status-go-fg);
  `,
  warn: css`
    color: var(--color-status-warning-fg);
  `,
  nogo: css`
    color: var(--color-status-nogo-fg);
  `,
  info: css`
    color: var(--color-status-info-fg);
  `,
} as const;

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
    font-size: var(--font-size-xs);
  `,
  sm: css`
    font-size: var(--font-size-sm);
  `,
  base: css`
    font-size: var(--font-size-base);
  `,
  lg: css`
    font-size: var(--font-size-lg);
  `,
} as const;

/**
 * Inline text: tone, size, weight, spacing. `font-variant-numeric: tabular-nums`
 * is baked in so widgets never forget it and digits don't jitter as they update.
 *
 * Called `Value` until now, and the name was wrong twice over. It collided with
 * `@ksp-gonogo/sitrep-sdk`'s `Value<U>`, the unit-system's actual value type, so
 * two published packages exported one name for unrelated things and an author
 * importing either got no warning. And it oversold itself: this renders whatever
 * you give it, with no magnitude, no unit and no formatting anywhere in it.
 *
 * It does NOT merge into `Unit`, which is a different axis: `Unit` renders a
 * quantity and its symbol, this colours and sizes a span. They compose, and that
 * composition is the normal case:
 *
 *     <Text tone="go"><Unit value={altitude} /></Text>
 */
export function Text({
  tone = "accent",
  spaced = false,
  size,
  weight,
  children,
  ...rest
}: TextProps) {
  return (
    <Text__Root
      $tone={tone}
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
  $tone: TextTone;
  $spaced: boolean;
  $size?: TextSize;
  $weight?: TextWeight;
}>`
  font-variant-numeric: tabular-nums;
  ${({ $tone }) => TONE_STYLES[$tone]}
  ${({ $size }) => $size && SIZE_STYLES[$size]}
  ${({ $weight }) => $weight && WEIGHT_STYLES[$weight]}
  ${({ $spaced }) => $spaced && `margin-left: var(--space-2, 2px);`}
`;
