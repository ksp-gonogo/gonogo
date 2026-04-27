import styled from "styled-components";

/** Default action button — neutral dark style */
export const Button = styled.button`
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: 3px;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: 600;
  letter-spacing: 0.1em;
  padding: 5px 12px;
  cursor: pointer;
  text-transform: uppercase;
  transition: border-color 0.1s, color 0.1s;

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
    padding: 8px 14px;
  }
`;

/** Confirm / save — green accent */
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

/** Ghost / cancel — no background */
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

/** Icon-only button — no chrome, just text/icon */
export const IconButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-faint);
  font-size: var(--font-size-base);
  line-height: 1;
  padding: 2px 4px;
  transition: color 0.1s;

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
