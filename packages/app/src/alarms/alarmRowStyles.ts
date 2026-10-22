import styled from "styled-components";

export const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

export const RowMeta = styled.div`
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
  code {
    color: var(--color-go-text);
  }
`;

export const RowActions = styled.div`
  display: flex;
  gap: var(--gap-related);
  flex-shrink: 0;
`;

export const DangerButton = styled.button`
  background: var(--color-nogo-muted);
  color: var(--color-nogo-text);
  border: 1px solid var(--color-nogo-muted);
  padding: var(--inset-control);
  border-radius: var(--radius-regular);
  font-size: var(--font-size-compact);
  cursor: pointer;
  &:hover {
    background: var(--color-nogo-muted);
  }
  &:focus-visible {
    outline: 2px solid var(--color-nogo-mark);
    outline-offset: 2px;
  }
`;
