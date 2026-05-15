import type { ReactNode } from "react";
import styled from "styled-components";

export interface BannerStackProps {
  children: ReactNode;
}

/**
 * Fixed-position horizontal strip sitting immediately to the left of the
 * action FAB, at the FAB's exact height. All ephemeral status banners
 * (signal loss, version mismatch, flight outcome, scene change, alarm /
 * warp pills) live in this stack so they no longer overwrite top-row
 * widgets and the operator can scroll the dashboard freely.
 *
 * Layout:
 * - Height matches the FAB (48px), so banners sit vertically centered on
 *   the same baseline as the FAB itself.
 * - `flex-direction: row-reverse` puts the first DOM child closest to the
 *   FAB (the right edge); additional banners stack to the left.
 * - Overflow scrolls horizontally — when too many banners are active the
 *   leftward overflow becomes scrollable rather than pushing offscreen.
 *
 * The primary "+" FAB is 48×48 at `bottom: 24px; right: 24px`. The stack
 * sits at the same `bottom: 24px`, with `right: 88px` (24 FAB + 48 width
 * + 16 gap) so it never touches the FAB.
 */
export function BannerStack({ children }: BannerStackProps) {
  return <Stack>{children}</Stack>;
}

const Stack = styled.div`
  position: fixed;
  right: calc(88px + env(safe-area-inset-right, 0px));
  bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  z-index: 90;
  display: flex;
  flex-direction: row-reverse;
  align-items: center;
  gap: 8px;
  height: 48px;
  max-width: calc(100vw - 112px - env(safe-area-inset-right, 0px));
  overflow-x: auto;
  overflow-y: hidden;
  pointer-events: none;

  /* Make banners individually clickable while keeping the stack itself
     transparent to interaction (so it doesn't block the dashboard
     underneath in empty corners of the row). Banners are sized to the
     stack height (border-box so padding + border count toward the
     48px, otherwise content-box would push the rendered pill ~18px
     taller and the strip would clip the top and bottom). Each banner
     is rendered as a pill that doesn't shrink. */
  > * {
    pointer-events: auto;
    flex-shrink: 0;
    box-sizing: border-box;
    height: 100%;
    display: inline-flex;
    align-items: center;
  }

  /* Subtle scrollbar styling for the overflow case — only visible on hover
     so the strip stays clean when not interacted with. */
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
  &:hover {
    scrollbar-color: var(--color-border-strong) transparent;
  }
`;
