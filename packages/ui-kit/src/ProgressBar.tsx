import type { HTMLAttributes } from "react";
import styled from "styled-components";

export interface ProgressBarProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Current value, 0–100. Clamped into range before rendering. */
  value: number;
  /** Accessible label for screen readers (e.g. "Biome coverage, Kerbin"). */
  ariaLabel?: string;
  /**
   * CSS colour for the fill, overriding the default `--color-accent-fg`.
   * For a bar whose progress is itself a threat (a CME closing in, not a
   * coverage percentage getting better), the default green reads as
   * reassuring; pass a status token here instead (e.g.
   * `var(--color-status-nogo-bg)`) so "further along" doesn't visually mean
   * "more done".
   */
  fillColor?: string;
}

/**
 * Thin track+fill progress indicator. Extracted from the Scanning widget's
 * coverage bar (`CoverageBar`/`CoverageFill`): the same shape covers the
 * ContractManager altitude-envelope bar. Renders as a native
 * `role="progressbar"` so screen readers announce the percentage.
 */
export function ProgressBar({
  value,
  ariaLabel,
  fillColor,
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
      <ProgressBar__Fill $percent={clamped} $fillColor={fillColor} />
    </ProgressBar__Track>
  );
}

const ProgressBar__Track = styled.div`
  height: 6px;
  background: var(--color-surface-raised);
  /* Stadium, not a corner: a fixed radius sized to half this 6px height
     decouples the corner from the track the moment the height changes.
     --radius-pill clamps to the same shape and survives it. */
  border-radius: var(--radius-pill, 999px);
  overflow: hidden;
`;

const ProgressBar__Fill = styled.div<{ $percent: number; $fillColor?: string }>`
  height: 100%;
  width: ${({ $percent }) => `${$percent}%`};
  background: ${({ $fillColor }) => $fillColor ?? "var(--color-accent-fg)"};
  /* Off the motion scale on purpose: a determinate fill has to advance at a
     constant rate, so both the 250ms and the linear timing carry meaning
     rather than taste. The motion tokens cover UI transitions only. */
  transition: width 250ms linear;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;
