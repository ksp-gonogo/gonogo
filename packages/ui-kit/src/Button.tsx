import styled from "styled-components";

/** Default action button: neutral dark style */
export const Button = styled.button`
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm, 3px);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: 600;
  letter-spacing: 0.1em;
  padding: var(--space-6, 6px) var(--space-12, 12px);
  cursor: pointer;
  text-transform: uppercase;
  transition: border-color var(--duration-fast, 120ms), color var(--duration-fast, 120ms);

  @media (hover: hover) {
    &:hover {
      border-color: var(--color-text-faint);
      color: var(--color-text-primary);
    }
  }
  &:active {
    background: var(--color-border-subtle);
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  @media (pointer: coarse) {
    min-height: 44px;
    /* One rung WIDER than the base inset, not the same rung. A coarse value of
       14px against a 12px base snaps both onto --space-12, erasing the
       widening this block exists for (min-height only covers the vertical
       target). --space-16 keeps a touch-sized horizontal target. */
    padding: var(--space-8, 8px) var(--space-16, 16px);
  }
`;

/** Confirm / save: green accent */
export const PrimaryButton = styled(Button)`
  background: var(--color-status-go-bg);
  border-color: var(--color-status-go-bg);
  color: var(--color-accent-fg);
  align-self: flex-end;

  @media (hover: hover) {
    &:hover {
      background: var(--color-status-go-bg);
      border-color: var(--color-status-go-bg);
      color: var(--color-accent-fg);
    }
  }
`;

/** Ghost / cancel: no background */
export const GhostButton = styled(Button)`
  background: none;
  border-color: var(--color-border-strong);
  /* var(--color-text-muted) on the var(--color-surface-app) app background clears WCAG AA 4.5:1 (≈6.1:1);
     var(--color-text-dim) (the previous value) was ~3.5:1 and failed. */
  color: var(--color-text-muted);

  @media (hover: hover) {
    &:hover {
      border-color: var(--color-text-faint);
      color: var(--color-text-primary);
    }
  }
`;

/** Inline subtle link-style button: tertiary actions placed inline with
 *  surrounding copy (e.g. "Clear all", "Cancel" inside a list row). For a
 *  paired Cancel / Confirm action row, prefer GhostButton + PrimaryButton. */
export const TextButton = styled.button`
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-family: inherit;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  transition: color var(--duration-fast, 120ms);

  @media (hover: hover) {
    &:hover {
      color: var(--color-text-primary);
    }
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

/** Icon-only button: no chrome, just text/icon */
export const IconButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-faint);
  font-size: var(--font-size-base);
  line-height: var(--line-height-flush, 1);
  padding: var(--space-2, 2px) var(--space-4, 4px);
  transition: color var(--duration-fast, 120ms);

  @media (hover: hover) {
    &:hover {
      color: var(--color-text-primary);
    }
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  @media (pointer: coarse) {
    min-width: 44px;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
`;
