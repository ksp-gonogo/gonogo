import styled from "styled-components";

// The Panel family is aliased from ui-kit so an Uplink can reach it; add no Panel part here.
export { Panel, type PanelProps, ScrollArea } from "@ksp-gonogo/ui-kit";

/** Dim placeholder text for an empty slot. App-side only. */
export const Placeholder = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-faint);
`;
