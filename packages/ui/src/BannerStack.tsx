import type { ReactNode } from "react";
import styled from "styled-components";

export interface BannerStackProps {
  children: ReactNode;
}

/**
 * Fixed-position column in the bottom-right corner of the viewport, sitting
 * just left of the action FAB. All ephemeral status banners (signal loss,
 * version mismatch, flight outcome, scene change, alarm/warp pills) live in
 * this stack so they no longer overwrite top-row widgets and the operator
 * can scroll the dashboard freely.
 *
 * Children render bottom-up: the most recently mounted banner appears at
 * the bottom (closest to the FAB), older ones stack above. Horizontal
 * overflow scrolls — banners themselves stay one-line; long lists scroll
 * vertically with the container.
 *
 * Sits at `bottom: 90px` to clear the 56px FAB + its 16px safe-area
 * padding without overlapping. `right: 24px` keeps a clear gap on the
 * right edge.
 */
export function BannerStack({ children }: BannerStackProps) {
  return <Stack>{children}</Stack>;
}

const Stack = styled.div`
  position: fixed;
  right: 24px;
  bottom: calc(90px + env(safe-area-inset-bottom, 0px));
  z-index: 90;
  display: flex;
  flex-direction: column-reverse;
  align-items: flex-end;
  gap: 8px;
  max-height: calc(100vh - 120px);
  pointer-events: none;
  /* Wide-overflow guard: very long banners would otherwise push offscreen.
     The container constrains; individual pills can shrink if needed but
     prefer to truncate their own content. */
  max-width: min(80vw, 520px);

  /* Make banners individually clickable while keeping the stack itself
     transparent to interaction (so it doesn't block the dashboard
     underneath in empty corners of the column). */
  > * {
    pointer-events: auto;
  }
`;
