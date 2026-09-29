import styled from "styled-components";

/**
 * Single-line ellipsis truncation for a flex child. Standalone form of the
 * truncating behaviour baked into `RowName`: use this wherever a label
 * needs to truncate outside of a `Row` (grid cells, card titles).
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
