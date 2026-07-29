import styled, { keyframes } from "styled-components";

/**
 * Small inline pending indicator. Sized to slot next to a row label /
 * value without reflowing layout. Honours `prefers-reduced-motion`:
 * the spin animation is gated on the no-preference query so users with
 * vestibular sensitivity see a static ring instead.
 */
export interface SpinnerProps {
  /** Outer diameter in pixels. Defaults to 12. */
  size?: number;
  /** Stroke width in pixels. Defaults to 2. */
  thickness?: number;
  /** Active arc colour. Defaults to the accent foreground. */
  color?: string;
  /** ARIA label for screen readers. */
  ariaLabel?: string;
}

export function Spinner({
  size = 12,
  thickness = 2,
  color = "var(--color-accent-fg)",
  ariaLabel = "Loading",
}: Readonly<SpinnerProps>) {
  return (
    <SpinnerEl
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
  border-radius: var(--radius-circle, 50%);
  border: ${({ $thickness }) => `${$thickness}px`} solid
    var(--color-border-subtle);
  border-top-color: ${({ $color }) => $color};
  flex-shrink: 0;
  @media (prefers-reduced-motion: no-preference) {
    /* Off the motion scale on purpose: this is continuous physical rotation,
       not a UI transition, so the period and the linear timing both stay
       literal. */
    animation: ${spin} 700ms linear infinite;
  }
`;
