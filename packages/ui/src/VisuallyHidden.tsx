import styled from "styled-components";

/**
 * Screen-reader-only content: visually removed but kept in the accessibility
 * tree. Use for announcements a sighted user reads from another channel
 * (colour, a ticking number) that an assistive-tech user would otherwise miss,
 * e.g. a discrete power-state word next to a colour-coded net-rate readout.
 *
 * Pair with `role="status" aria-live="polite"` to announce a discrete state
 * CHANGE; keep the streaming value itself OUT of the live region so it doesn't
 * flood the screen reader every tick.
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
