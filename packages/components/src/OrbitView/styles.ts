import styled from "styled-components";

export const NoData = styled.div`
  font-size: var(--font-size-compact);
  color: var(--color-text-faint);
  padding: var(--inset-empty-note);
`;

export const PillFill = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
`;

export const DiagramOverlayWrap = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
`;

export const OverlayLayer = styled.div`
  position: absolute;
  inset: 0;
  /* An overlay augment re-enables pointer events on its own elements. */
  pointer-events: none;
`;

/**
 * The landscape branch's sidebar content: body name and status pill, stacked
 * and vertically centred in the narrow column `panelSidebar` reserves beside
 * the diagram.
 */
export const LandscapeChrome = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  justify-content: center;
  min-width: 0;
  min-height: 0;
`;
