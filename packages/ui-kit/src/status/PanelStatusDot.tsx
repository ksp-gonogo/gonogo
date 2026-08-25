import styled from "styled-components";
import type { Severity } from "./severity";
import { severityDotColor } from "./severityDotColor";

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
 * disc (filled via `severityDotColor`) that grows into a counted pill when more
 * than one contributor sits at that severity. Keyed on the canonical `Severity`,
 * this is the rebuild of the killed 3-tone `Dot` draft on the real vocabulary,
 * NOT a harvest of it.
 *
 * It is a meaningful graphic, so it carries `role="img"` + an accessible name
 * ("warning", "3 caution") rather than being hidden: in a collapsed header the
 * dot row IS the status display (the summary badge is gone), so a screen reader
 * must reach it. The count colour reads OUT of the dot as the panel surface, so
 * it stays legible on every saturated severity fill (verified by the visual
 * gate, not asserted in jsdom).
 */
export function PanelStatusDot({ severity, count = 1 }: PanelStatusDotProps) {
  const withCount = count > 1;
  return (
    <PanelStatusDot__Root
      data-panel-status-dot=""
      data-severity={severity}
      role="img"
      aria-label={withCount ? `${count} ${severity}` : severity}
      $color={severityDotColor(severity)}
    >
      {withCount && <PanelStatusDot__Count>{count}</PanelStatusDot__Count>}
    </PanelStatusDot__Root>
  );
}

/* 8px: sized to the TITLE's cap-height, not the title's full font-size
   (--font-size-xs, 11px). PanelTitle is small uppercase, and an 11px dot next
   to 11px uppercase text reads a touch big, it wants to sit IN the title's
   text line rather than beside it at the same nominal size. 8px is roughly an
   11px font's cap-height, so the dot now visually fits the glyphs rather than
   overshooting them. (Was 16px originally, then 11px; this is the third and
   title-anchored cut, not a further arbitrary trim.) */
const DOT_DIAMETER = "8px";

const PanelStatusDot__Root = styled.span<{
  $color: string;
}>`
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  /* One fixed diameter whether or not a count is shown. A count rendered as a
     direct text child sits in normal flex-item flow, where it can nudge this
     box's effective cross-size and, with it, the box's centred position in the
     row, so a counted dot renders measurably smaller and off-baseline from a
     bare one. PanelStatusDot__Count is absolutely positioned (see below), which
     makes that structurally impossible rather than tuned-around: an
     out-of-flow child cannot affect this box's size no matter what font-size
     or line-height it carries. */
  width: ${DOT_DIAMETER};
  height: ${DOT_DIAMETER};
  border-radius: var(--radius-circle);
  background: ${({ $color }) => $color};
  /* A crisp rim plus a real glow bloom, so the dot reads as a lit indicator
     rather than a flat disc. The previous halo used a negative spread (a rim
     tucked back under the disc's own edge), which is why it was effectively
     invisible in renders; this one has genuine positive spread.

     The rim is a LIGHTER tint of the dot's own fill, not white: white read as
     a harsh ring unrelated to the severity underneath it, where a lightened
     version of the same colour keeps the dot monochromatic-per-severity (a
     critical dot gets a lighter red rim, a caution dot a lighter amber one)
     and softens rather than fights the fill. color-mix derives it straight
     from $color (itself severityDotColor's output) so there is no second
     per-severity map to keep in step, the same reasoning that put the fill
     behind one function in the first place.

     78%: operator review round 3 called the previous 55% mix too washed out
     to read as "lit" against the fill, it just looked like a soft tint. 78%
     is roughly halfway from 55% back to the fill's own 100%, brighter and
     closer to the core colour while still visibly lighter than it, so the
     rim stays a rim rather than becoming indistinguishable from the fill it
     rings. */
  box-shadow:
    0 0 0 1px color-mix(in srgb, ${({ $color }) => $color} 78%, white),
    0 0 4px 1px ${({ $color }) => $color};
`;

const PanelStatusDot__Count = styled.span`
  /* Out of flow: see the note on PanelStatusDot__Root. Centred over the fixed
     parent box via inset:0 + flex centring, with zero say over that box's
     size. */
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  /* The count reads OUT of the dot as the panel surface, so it stays legible on
     every saturated severity fill without a per-severity text colour. */
  color: var(--color-surface-panel);
  /* Off the --font-size-2xs floor (10-11px): the smallest rung would not fit a
     2-digit count inside an 11px dot. Pinned to the fixed DOT_DIAMETER box
     above it, not a spacing decision. */
  font-size: 7px;
  font-weight: 700;
  line-height: var(--line-height-flush, 1);
`;
