import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";

export type ValueTone = "accent" | "default" | "muted";
export type ValueSize = "xs" | "sm" | "base" | "lg";

export interface ValueProps extends HTMLAttributes<HTMLSpanElement> {
  /** Foreground colour. Defaults to `accent`. */
  tone?: ValueTone;
  /** Adds `margin-left: 2px` so the value sits apart from a preceding label. */
  spaced?: boolean;
  /**
   * Font size, snapped to the type scale. Omit to inherit the ambient
   * font-size from wherever the value is mounted (the original behaviour) —
   * set it explicitly for dense list/grid rows (coverage %, sensor state,
   * vessel meta) that need to stay off the 14px body-text size.
   */
  size?: ValueSize;
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
 * Inline numeric/data readout. `font-variant-numeric: tabular-nums` is baked
 * in so widgets never forget it and digits don't jitter as they update.
 * Extracted from ScienceOfficer's `DataReadout`.
 */
export function Value({
  tone = "accent",
  spaced = false,
  size,
  children,
  ...rest
}: ValueProps) {
  return (
    <Value__Root $tone={tone} $spaced={spaced} $size={size} {...rest}>
      {children}
    </Value__Root>
  );
}

const Value__Root = styled.span<{
  $tone: ValueTone;
  $spaced: boolean;
  $size?: ValueSize;
}>`
  font-variant-numeric: tabular-nums;
  ${({ $tone }) => TONE_STYLES[$tone]}
  ${({ $size }) => $size && SIZE_STYLES[$size]}
  ${({ $spaced }) => $spaced && `margin-left: 2px;`}
`;
