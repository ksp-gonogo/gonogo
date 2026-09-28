import styled from "styled-components";
import { TONE_LABEL, TONE_MARK, TONE_ON_STATUS, TONE_STATUS } from "../tone";
import type { Severity } from "./severity";

export interface PanelStatusDotProps {
  severity: Severity;
  /**
   * How many contributors sit at this severity. The number is shown INSIDE the
   * dot only when greater than 1; a single contributor is just the coloured dot.
   * Defaults to 1.
   */
  count?: number;
}

/**
 * One per-severity status dot for a Panel's collapsed header: a small coloured
 * disc carrying the count when more than one contributor sits at that
 * severity, growing sideways into a pill when the count takes more than one
 * digit.
 *
 * It carries `role="img"` and an accessible name ("warning", "3 caution")
 * rather than being hidden: in a collapsed header the dot row is the status
 * display, so a screen reader must reach it.
 */
export function PanelStatusDot({ severity, count = 1 }: PanelStatusDotProps) {
  const withCount = count > 1;
  return (
    <PanelStatusDot__Root
      data-panel-status-dot=""
      data-severity={severity}
      role="img"
      aria-label={
        withCount ? `${count} ${TONE_LABEL[severity]}` : TONE_LABEL[severity]
      }
      $mark={TONE_MARK[severity]}
      $digits={withCount ? String(count).length : 1}
    >
      {withCount && (
        <PanelStatusDot__Count
          $fill={TONE_STATUS[severity]}
          $ink={TONE_ON_STATUS[severity]}
        >
          {count}
        </PanelStatusDot__Count>
      )}
    </PanelStatusDot__Root>
  );
}

// Sized to the panel title's cap-height, not its font-size, so the dot sits inside the title's text line.
const DOT_DIAMETER = "8px";

const PanelStatusDot__Root = styled.span<{
  $mark: string;
  $digits: number;
}>`
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* One fixed diameter whether or not a count is shown; the count is out of flow, so it cannot affect this box's size. */
  height: ${DOT_DIAMETER};
  /* The count's own size, so the width below can be counted in its digits. */
  font-size: 7px;
  /* More than one digit grows the dot sideways into a pill, keeping its height and its place on the title's line. */
  width: ${({ $digits }) =>
    $digits > 1 ? `calc(${$digits}ch + 4px)` : DOT_DIAMETER};
  border-radius: ${({ $digits }) =>
    $digits > 1 ? "var(--radius-pill)" : "var(--radius-circle)"};
  background: ${({ $mark }) => $mark};
  /* A rim in a lighter tint of the dot's own fill plus a glow bloom, so the dot reads as a lit indicator. */
  box-shadow:
    0 0 0 1px color-mix(in srgb, ${({ $mark }) => $mark} 78%, white),
    0 0 4px 1px ${({ $mark }) => $mark};
`;

/* A lone dot is a mark; one carrying its count is a status fill under its own text, so the count paints that fill over the whole dot. */
const PanelStatusDot__Count = styled.span<{ $fill: string; $ink: string }>`
  /* Out of flow, centred over the fixed parent box with no say over its size. */
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: ${({ $fill }) => $fill};
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  color: ${({ $ink }) => $ink};
  /* Below the --font-size-2xs floor, which would not fit the 8px dot. */
  font-size: inherit;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: var(--line-height-flush);
`;
