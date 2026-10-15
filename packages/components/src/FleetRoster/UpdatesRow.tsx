// biome-ignore lint/style/noRestrictedImports: the row collapses on :empty, which an inline style cannot express
import styled from "styled-components";

/** Wraps the per-vessel `fleet-roster.updates` slot; `:empty` collapses it live when a bound augment renders nothing for this row, which a render-time check cannot see. */
export const UpdatesRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  /* 21px = NameCell padding 6 + LinkDot 8 + NameCell gap 7, so the block hangs under the vessel name. */
  padding: 0 var(--gutter-roster-cell) var(--gutter-roster-cell) 21px;

  /* Augments that return null add no DOM, so an empty row takes no space. */
  &:empty {
    display: none;
  }
`;
