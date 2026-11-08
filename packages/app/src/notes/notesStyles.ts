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

export const Body = styled.div`
  min-width: 0;
  font-size: var(--font-size-compact);
  line-height: var(--line-height-body);
  color: var(--color-text-primary);
  word-wrap: break-word;
`;

// A real button so the keyboard reaches it; reset to read as the plain note text it replaces.
export const RenderedBody = styled.button`
  display: block;
  width: 100%;
  margin: 0;
  background: none;
  border: none;
  border-radius: var(--radius-regular);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: text;
  white-space: pre-wrap;
  word-wrap: break-word;
  padding: var(--inset-line);

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

// Holds the editor so one tooltip can say why an edit is stuck.
export const EditorSlot = styled.div<{ $stuck: boolean }>`
  min-width: 0;
  border-radius: var(--radius-regular);
  outline: ${({ $stuck }) =>
    $stuck ? "1px solid var(--color-warn-mark)" : "none"};
`;

export const RowActions = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  align-items: center;
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

// Carries the tip for a composer that is switched off; a disabled field gets no pointer events of its own.
export const Field = styled.div`
  display: flex;
  flex: 1;
  min-width: 0;
`;
