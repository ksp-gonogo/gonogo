import type { ButtonHTMLAttributes } from "react";
import { forwardRef } from "react";
import styled, { css } from "styled-components";

export type ToggleButtonTone = "neutral" | "go" | "nogo" | "warn";
export type ToggleButtonSize = "sm" | "md";

export interface ToggleButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  tone?: ToggleButtonTone;
  size?: ToggleButtonSize;
}

/**
 * Two-state toggle button. Subsumes the many ad-hoc styled buttons that
 * switch between an "on" and "off" presentation (e.g. mode pickers, filter
 * toggles). Always renders a real `<button>` so keyboard + screen reader
 * support is correct; sets `aria-pressed` automatically.
 *
 * Use `tone` to colour the active state; `neutral` is the default and uses
 * the standard accent green. `nogo` / `warn` are useful when the toggle
 * represents a destructive or attention-worthy state.
 */
export const ToggleButton = forwardRef<HTMLButtonElement, ToggleButtonProps>(
  function ToggleButton(
    {
      active = false,
      tone = "neutral",
      size = "md",
      type = "button",
      "aria-pressed": ariaPressed,
      ...rest
    },
    ref,
  ) {
    return (
      <ToggleButton__Body
        ref={ref}
        type={type}
        $active={active}
        $tone={tone}
        $size={size}
        aria-pressed={ariaPressed ?? active}
        {...rest}
      />
    );
  },
);

const TONE_ACTIVE = {
  neutral: css`
    background: var(--color-status-go-bg);
    border-color: var(--color-status-go-bg);
    color: var(--color-status-go-fg);
  `,
  go: css`
    background: var(--color-status-go-bg);
    border-color: var(--color-status-go-bg);
    color: var(--color-status-go-fg);
  `,
  nogo: css`
    background: var(--color-status-nogo-bg);
    border-color: var(--color-status-nogo-bg);
    color: var(--color-status-nogo-fg);
  `,
  warn: css`
    background: var(--color-status-warning-bg);
    border-color: var(--color-status-warning-bg);
    color: var(--color-status-warning-fg);
  `,
} as const;

const SIZE_STYLES = {
  sm: css`
    font-size: var(--font-size-xs);
    padding: 3px 8px;
  `,
  md: css`
    font-size: var(--font-size-sm);
    padding: 5px 12px;
  `,
} as const;

const ToggleButton__Body = styled.button<{
  $active: boolean;
  $tone: ToggleButtonTone;
  $size: ToggleButtonSize;
}>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-family: inherit;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s, color 0.1s;

  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-subtle);
  color: var(--color-text-muted);

  ${({ $size }) => SIZE_STYLES[$size]}
  ${({ $active, $tone }) => ($active ? TONE_ACTIVE[$tone] : "")}

  @media (hover: hover) {
    &:hover:not(:disabled) {
      border-color: var(--color-text-faint);
      color: var(--color-text-primary);
    }
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  @media (pointer: coarse) {
    min-height: 44px;
    padding: ${({ $size }) => ($size === "sm" ? "6px 10px" : "8px 14px")};
  }
`;
