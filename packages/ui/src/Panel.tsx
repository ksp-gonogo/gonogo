import styled from "styled-components";

/**
 * The Panel family lives in `@ksp-gonogo/ui-kit`, which is the published
 * package and therefore the only place a third-party Uplink can reach it.
 * There were two implementations of it for a while, one here and one there,
 * which is how a widget could import `Panel` and get a container that did not
 * take `panelTitle`. This file is the app-side alias so both names resolve to
 * one component.
 *
 * Add nothing to it. A Panel part added here would be invisible to Uplinks,
 * which is the split that caused the problem in the first place.
 */
export { Panel, type PanelProps, ScrollArea } from "@ksp-gonogo/ui-kit";

/** Dim placeholder text for an empty slot. App-side only. */
export const Placeholder = styled.span`
  font-size: var(--font-size-sm);
  color: var(--color-text-faint);
`;
