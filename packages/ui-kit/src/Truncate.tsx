import styled from "styled-components";

/**
 * A `span` that truncates to one line with an ellipsis, as a flex child that
 * fills the free width. The same behaviour as {@link RowName}, for a label
 * outside a {@link Row} (a grid cell, a card title). Useful for keeping a long
 * name on one line so it does not push the figures beside it out of the tile.
 * Used by the maneuver planner's burn rows and the warp control's next-alarm
 * line. Its text is the neutral text colour.
 *
 * @category Typography
 */
export const Truncate = styled.span`
  /* Its own theme colour rather than whatever the nearest element gives it, so no ancestor's default can reach the words. */
  color: var(--color-neutral-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
`;
