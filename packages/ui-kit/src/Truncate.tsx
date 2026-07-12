import styled from "styled-components";

/**
 * Single-line ellipsis truncation for a flex child. Standalone form of the
 * truncating behaviour baked into `RowName` — use this wherever a label
 * needs to truncate outside of a `Row` (grid cells, card titles).
 */
export const Truncate = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
`;
