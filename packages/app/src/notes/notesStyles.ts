import styled from "styled-components";

export const Item = styled.div`
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: var(--gap-related);
  align-items: start;
  padding: var(--inset-surface);
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-regular);
`;

export const ReorderColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-line);
`;

// Stacked in pairs beside a one-line note, so a full control inset would make the glyphs taller than the note they act on.
export const ReorderBtn = styled.button`
  background: none;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: var(--inset-control-compact);
  display: inline-flex;
  align-items: center;
  justify-content: center;

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  @media (hover: hover) {
    &:not(:disabled):hover {
      color: var(--color-text-primary);
    }
  }
`;

export const Body = styled.div`
  min-width: 0;
  font-size: var(--font-size-compact);
  line-height: var(--line-height-body);
  color: var(--color-text-primary);
  word-wrap: break-word;
`;

export const RenderedBody = styled.div`
  cursor: text;
  white-space: pre-wrap;
  padding: var(--inset-line);
`;

export const RowActions = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  align-items: center;
`;

export const DoneBtn = styled.button`
  background: none;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: var(--inset-control-compact);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  @media (hover: hover) {
    &:hover {
      color: var(--color-go-text);
    }
  }
`;

export const DeleteBtn = styled.button`
  background: none;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: var(--inset-control-compact);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  @media (hover: hover) {
    &:hover {
      color: var(--color-nogo-text);
    }
  }
`;

export const AddRow = styled.div`
  display: flex;
  gap: var(--gap-related);
  flex-shrink: 0;
`;

export const Empty = styled.div`
  color: var(--color-text-faint);
  font-size: var(--font-size-compact);
  /* The tighter inset is what keeps the message inside the body at the minimum size. */
  padding: var(--inset-surface);
  text-align: center;
`;
