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
 * Two-state toggle button: a real `<button>` carrying `aria-pressed`, set
 * automatically. Subsumes the many ad-hoc styled buttons that switch between
 * an "on" and "off" presentation (mode pickers, filter toggles, rate
 * pickers).
 *
 * ToggleButton or `Switch`? They are different ARIA patterns for different
 * jobs, and the distinction is deliberate:
 *
 *   - ToggleButton is a BUTTON whose label IS the thing being chosen, and
 *     which is usually one of several peers: warp rates, a filter row, a
 *     view mode. Pressing it acts. `aria-pressed` says which peer is on.
 *   - `Switch` is a single boolean SETTING with a label beside it, rendered
 *     as a checkbox with a track and thumb. It configures rather than acts.
 *
 * If the control sits in a row of alternatives, it is a ToggleButton. If it
 * sits in a settings list next to its own label, it is a Switch.
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
    padding: var(--space-2, 2px) var(--space-8, 8px);
  `,
  md: css`
    font-size: var(--font-size-sm);
    padding: var(--space-6, 6px) var(--space-12, 12px);
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
  gap: var(--space-4, 4px);
  font-family: inherit;
  font-weight: 600;
  /* The kit's one control height, shared with Button and StatusIndicator, so a
     bar of mixed controls is one band rather than a ragged run. The size prop
     picks the type scale and the inset, never the height. See
     --control-height. */
  min-height: var(--control-height, 28px);
  line-height: var(--line-height-flush, 1);
  /* Sentence case, the same as the kit's Button: this label is the thing being
     chosen, and a row of shouted choices reads as an alarm rather than a
     picker. */
  border-radius: var(--radius-sm, 3px);
  cursor: pointer;
  transition: background var(--duration-fast, 100ms), border-color var(--duration-fast, 100ms), color var(--duration-fast, 100ms);

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

  /* Ext-1 shared \`data-failed\` styling convention: a control that issued a
     now-dead command (overdue / lost) echoes the failure ON ITSELF by carrying
     \`data-failed="true"\`, an amber attention tint that wins over the neutral and
     active states, so the operator sees WHICH control's command died without
     leaving the Panel-top queue (still the primary failure surface). Clicking
     such a control dismisses via the same shared \`dismiss\`, wiring is the
     control's own job (see useCommandFailures). Any control can adopt the same
     attribute + tint. */
  &[data-failed="true"] {
    border-color: var(--color-status-warning-bg);
    color: var(--color-status-warning-fg);
    background: color-mix(
      in srgb,
      var(--color-status-warning-bg) 18%,
      var(--color-surface-raised)
    );
  }

  @media (pointer: coarse) {
    min-height: 44px;
    /* md goes one rung wider than its base inset (--space-12), same as ui-kit
       Button: a 14px value snaps onto the base rung and erases the horizontal
       widening this block exists for. sm sits on rungs already. */
    padding: ${({ $size }) =>
      $size === "sm"
        ? "var(--space-6) var(--space-10)"
        : "var(--space-8) var(--space-16)"};
  }
`;
