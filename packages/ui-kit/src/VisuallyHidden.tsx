import styled from "styled-components";

/**
 * Screen-reader-only content: visually removed but kept in the accessibility
 * tree. Use it for what a sighted user reads from another channel (colour, a
 * ticking number) that an assistive-technology user would otherwise miss, such
 * as a discrete power-state word beside a colour-coded net-rate readout, or the
 * word a currency icon stands for.
 *
 * Pair it with `role="status" aria-live="polite"` to announce a discrete state
 * change; keep a streaming value out of the live region so it does not flood
 * the screen reader every tick.
 *
 * @example
 * ```tsx
 * <span role="status" aria-live="polite">
 *   <VisuallyHidden>{netRate < 0 ? "Draining" : "Charging"}</VisuallyHidden>
 * </span>
 * ```
 *
 * @category Typography
 */
export const VisuallyHidden = styled.span`
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
`;
