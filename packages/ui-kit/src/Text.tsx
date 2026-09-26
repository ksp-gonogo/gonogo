import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";

/**
 * `faint` is the quietest tier, one step below `muted`: a secondary readout
 * that should recede rather than compete, like the numeric echo beside an
 * analog stick.
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
   * font-size; set it for dense list or grid rows that need to stay off the
   * body-text size.
   */
  size?: TextSize;
  /** Font weight. Omit to inherit the ambient weight; set `semibold` to emphasise a key figure. */
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
  // The plain warning foreground is near-black text for the amber badge, so prose on a panel takes the muted amber.
  warn: css`
    color: var(--color-status-warning-fg-muted);
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
  ${({ $spaced }) => $spaced && `margin-left: var(--gap-lead-figure);`}
`;
