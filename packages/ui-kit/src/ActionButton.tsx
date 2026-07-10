import type { ButtonHTMLAttributes, ReactNode } from "react";
import styled, { css, keyframes } from "styled-components";

export type ActionButtonTone = "ghost" | "go";

export interface ActionButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * `ghost` (default) is the neutral compact button. `go` is the go-toned
   * confirm variant — a filled green button that pulses to draw the eye to a
   * pending confirmation (e.g. "confirm transmit").
   */
  tone?: ActionButtonTone;
  children?: ReactNode;
}

/**
 * Compact row-level action button. Extracted from ScienceOfficer's
 * `ActionButton` + `ConfirmTransmitButton` — the `go` tone replaces the
 * latter.
 */
export function ActionButton({
  tone = "ghost",
  children,
  ...rest
}: ActionButtonProps) {
  return (
    <ActionButton__Root $tone={tone} {...rest}>
      {children}
    </ActionButton__Root>
  );
}

const transmitPulse = keyframes`
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
`;

const ActionButton__Root = styled.button<{ $tone: ActionButtonTone }>`
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 2px 8px;
  border-radius: 2px;
  border: 1px solid var(--color-surface-raised);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  gap: 4px;

  &:hover:not(:disabled) {
    color: var(--color-text-primary);
    border-color: var(--color-accent-fg);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.7;
  }

  ${({ $tone }) =>
    $tone === "go" &&
    css`
      background: var(--color-status-go-bg);
      color: var(--color-status-go-fg);
      border-color: transparent;

      @media (prefers-reduced-motion: no-preference) {
        animation: ${transmitPulse} 1s ease-in-out infinite;
      }
    `}
`;
