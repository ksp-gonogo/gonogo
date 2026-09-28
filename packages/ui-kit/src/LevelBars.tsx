import styled from "styled-components";
import type { StatTone } from "./statTone";

const BAR_FILL: Record<StatTone, string> = {
  neutral: "var(--color-text-muted)",
  go: "var(--color-accent-fg)",
  warn: "var(--color-status-warning-bg)",
  nogo: "var(--color-status-nogo-bg)",
  info: "var(--color-status-info-fg)",
};

/**
 * Props for {@link LevelBars}.
 *
 * @category Readouts
 */
export interface LevelBarsProps {
  /** How many bars are lit, or null when there is nothing to judge by. Zero is a verdict and draws every bar unlit. */
  lit: number | null;
  /** How many bars the glyph has. */
  of: number;
  tone?: StatTone;
  /** What the glyph measures, spoken before the count: "Signal" reads "Signal 3 of 4". */
  label?: string;
}

/**
 * A stepped level glyph, bars rising left to right with `lit` of them filled:
 * a signal-strength indicator. Sized in em, so it scales with the figure it
 * stands beside.
 *
 * @category Readouts
 */
export function LevelBars({
  lit,
  of,
  tone = "neutral",
  label,
}: LevelBarsProps) {
  const count = lit === null ? "unknown" : `${lit} of ${of}`;
  return (
    <LevelBars__Root
      role="img"
      aria-label={label === undefined ? count : `${label} ${count}`}
      data-level-bars=""
    >
      {Array.from({ length: of }, (_, index) => (
        <LevelBars__Bar
          // biome-ignore lint/suspicious/noArrayIndexKey: a bar is its position
          key={index}
          $fill={lit !== null && index < lit ? BAR_FILL[tone] : null}
          $height={(index + 1) / of}
        />
      ))}
    </LevelBars__Root>
  );
}

const LevelBars__Root = styled.span`
  display: inline-flex;
  align-items: flex-end;
  gap: var(--gap-signal-bars);
  height: 0.8em;
  flex: none;
`;

const LevelBars__Bar = styled.span<{ $fill: string | null; $height: number }>`
  width: 0.22em;
  height: ${({ $height }) => `${Math.round($height * 100)}%`};
  background: ${({ $fill }) => $fill ?? "transparent"};
  border: 1px solid ${({ $fill }) => $fill ?? "var(--color-border-subtle)"};
`;
