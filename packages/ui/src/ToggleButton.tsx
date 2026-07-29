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
    color: var(--color-status-nogo-on-bg);
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
    padding: var(--space-2) var(--space-8);
  `,
  md: css`
    font-size: var(--font-size-sm);
    padding: var(--space-6) var(--space-12);
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
  gap: var(--space-4);
  font-family: inherit;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--duration-fast), border-color var(--duration-fast), color var(--duration-fast);

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
    /* md goes one rung wider than its base inset (--space-12), same as ui-kit
       Button: the old 14px would have snapped onto the base rung and erased
       the horizontal widening this block exists for. sm was already on rungs. */
    padding: ${({ $size }) =>
      $size === "sm"
        ? "var(--space-6) var(--space-10)"
        : "var(--space-8) var(--space-16)"};
  }
`;
