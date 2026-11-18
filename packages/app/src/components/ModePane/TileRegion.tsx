import styled from "styled-components";

/**
 * The part of the screen the tiles have, beside a mode's pane and above its
 * Timeline, from the edges `ModePane` publishes. The menu and the banners are
 * fixed inside it, so they sit over the tiles and never over the pane or the
 * Timeline.
 */
export const TileRegion = styled.div`
  position: fixed;
  top: 0;
  right: 0;
  bottom: var(--mode-foot-height, 0px);
  left: var(--mode-side-width, 0px);
  /* Layout containment makes this box the containing block of the fixed menu and banners inside it. */
  contain: layout;
  z-index: var(--z-fab);
  pointer-events: none;
`;
