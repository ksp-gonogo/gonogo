import type { HTMLAttributes } from "react";
import styled from "styled-components";

export interface ProgressBarProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Current value, 0–100. Clamped into range before rendering. */
  value: number;
  /** Accessible label for screen readers (e.g. "Biome coverage — Kerbin"). */
  ariaLabel?: string;
}

/**
 * Thin track+fill progress indicator. Extracted from the Scanning widget's
 * coverage bar (`CoverageBar`/`CoverageFill`) — the same shape covers the
 * ContractManager altitude-envelope bar. Renders as a native
 * `role="progressbar"` so screen readers announce the percentage.
 */
export function ProgressBar({
  value,
  ariaLabel,
  ...rest
}: Readonly<ProgressBarProps>) {
  const clamped = Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 0;
  return (
    <ProgressBar__Track
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      {...rest}
    >
      <ProgressBar__Fill $percent={clamped} />
    </ProgressBar__Track>
  );
}

const ProgressBar__Track = styled.div`
  height: 6px;
  background: var(--color-surface-raised);
  border-radius: 3px;
  overflow: hidden;
`;

const ProgressBar__Fill = styled.div<{ $percent: number }>`
  height: 100%;
  width: ${({ $percent }) => `${$percent}%`};
  background: var(--color-accent-fg);
  transition: width 250ms linear;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;
