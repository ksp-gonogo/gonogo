import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";

export type ValueTone = "accent" | "default" | "muted";

export interface ValueProps extends HTMLAttributes<HTMLSpanElement> {
  /** Foreground colour. Defaults to `accent`. */
  tone?: ValueTone;
  /** Adds `margin-left: 2px` so the value sits apart from a preceding label. */
  spaced?: boolean;
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

/**
 * Inline numeric/data readout. `font-variant-numeric: tabular-nums` is baked
 * in so widgets never forget it and digits don't jitter as they update.
 * Extracted from ScienceOfficer's `DataReadout`.
 */
export function Value({
  tone = "accent",
  spaced = false,
  children,
  ...rest
}: ValueProps) {
  return (
    <Value__Root $tone={tone} $spaced={spaced} {...rest}>
      {children}
    </Value__Root>
  );
}

const Value__Root = styled.span<{ $tone: ValueTone; $spaced: boolean }>`
  font-variant-numeric: tabular-nums;
  ${({ $tone }) => TONE_STYLES[$tone]}
  ${({ $spaced }) => $spaced && `margin-left: 2px;`}
`;
