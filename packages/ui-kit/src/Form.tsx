import styled from "styled-components";

export const ConfigForm = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

/** Vertical stack: label on top, input below */
export const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

/** Horizontal: label left, input right */
export const FieldRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const FieldLabel = styled.label`
  font-size: var(--font-size-sm);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

export const FieldHint = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
`;

export const FormActions = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
`;

const inputBase = `
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: 3px;
  color: var(--color-text-primary);
  font-size: var(--font-size-base);
  padding: 6px 8px;
  box-sizing: border-box;

  &:focus {
    /* var(--color-accent-fg) on var(--color-surface-raised) ≈ 11.4:1 — well clear of WCAG 1.4.11's 3:1 minimum
       for non-text UI components. The previous var(--color-text-faint) border was ~1.4:1. */
    border-color: var(--color-accent-fg);
    outline: none;
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }

  @media (pointer: coarse) {
    min-height: 44px;
    padding: 10px 12px;
    /* 16px prevents iOS Safari from auto-zooming on focus. */
    font-size: 16px;
  }
`;

export const Input = styled.input`
  ${inputBase}
  width: 100%;
`;

export const Select = styled.select`
  ${inputBase}
  width: 100%;
`;

export const Textarea = styled.textarea`
  ${inputBase}
  width: 100%;
  resize: vertical;
`;
