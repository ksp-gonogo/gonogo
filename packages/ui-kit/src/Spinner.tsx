import type { HTMLAttributes } from "react";
import styled, { keyframes } from "styled-components";

/**
 * Props for {@link Spinner}. Any other `span` attribute passes through, except
 * `color` and `role`.
 *
 * @category EmptyState
 */
export interface SpinnerProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "color" | "role"> {
  /** Outer diameter in pixels. Defaults to 12. */
  size?: number;
  /** Stroke width in pixels. Defaults to 2. */
  thickness?: number;
  /** Active arc colour. Defaults to the accent foreground. */
  color?: string;
  /** Accessible name for screen readers. Defaults to "Loading". */
  ariaLabel?: string;
}

/**
 * A small inline pending indicator: a ring with a coloured arc, sized to sit
 * beside a row label or value without reflowing the layout. It is
 * `role="status"` with an accessible name. Under `prefers-reduced-motion` the
 * ring does not spin.
 *
 * @category EmptyState
 */
export function Spinner({
  size = 12,
  thickness = 2,
  color = "var(--color-accent-fg)",
  ariaLabel = "Loading",
  ...rest
}: Readonly<SpinnerProps>) {
  return (
    <SpinnerEl
      {...rest}
      role="status"
      aria-label={ariaLabel}
      $size={size}
      $thickness={thickness}
      $color={color}
    />
  );
}

const spin = keyframes`
  to { transform: rotate(360deg); }
`;

const SpinnerEl = styled.span<{
  $size: number;
  $thickness: number;
  $color: string;
}>`
  display: inline-block;
  width: ${({ $size }) => `${$size}px`};
  height: ${({ $size }) => `${$size}px`};
  border-radius: var(--radius-circle);
  border: ${({ $thickness }) => `${$thickness}px`} solid
    var(--color-border-subtle);
  border-top-color: ${({ $color }) => $color};
  flex-shrink: 0;
  @media (prefers-reduced-motion: no-preference) {
    /* Off the motion scale: continuous rotation, not a UI transition. */
    animation: ${spin} 700ms linear infinite;
  }
`;
