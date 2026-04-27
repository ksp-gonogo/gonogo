import styled from "styled-components";

export const Panel = styled.div`
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: 4px;
  padding: 12px 16px;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
`;

export const PanelTitle = styled.h3`
  margin: 0;
  font-size: var(--font-size-xs);
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

export const PanelSubtitle = styled.div`
  font-size: 12px;
  color: var(--color-text-muted);
  letter-spacing: 0.05em;
  margin-top: -4px;
`;

export const PanelScrollable = styled(Panel)`
  overflow: auto;
`;

export const Placeholder = styled.span`
  font-size: 12px;
  color: var(--color-text-faint);
`;
