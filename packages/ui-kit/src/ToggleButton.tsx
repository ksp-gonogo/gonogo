import type { ButtonHTMLAttributes } from "react";
import { forwardRef } from "react";
import styled, { css } from "styled-components";
import { focusRing } from "./focusRing";

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
 * automatically, for controls that switch between an "on" and "off"
 * presentation (mode pickers, filter toggles, rate pickers).
 *
 * ToggleButton or `Switch`? They are different ARIA patterns for different
 * jobs:
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
    font-size: var(--font-size-caption);
    padding: var(--inset-control-small);
  `,
  md: css`
    font-size: var(--font-size-compact);
    padding: var(--inset-control);
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
  gap: var(--gap-glyph);
  font-family: inherit;
  font-weight: 600;
  /* The kit's one control height; the size prop picks type scale and inset, never the height. */
  min-height: var(--control-height);
  line-height: var(--line-height-flush);
  /* Sentence case, like Button: a row of shouted choices reads as an alarm. */
  border-radius: var(--radius-regular);
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

  ${focusRing}

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &[data-failed="true"] {
    border-color: var(--color-status-warning-bg);
    color: var(--color-status-warning-fg-muted);
    background: color-mix(
      in srgb,
      var(--color-status-warning-bg) 18%,
      var(--color-surface-raised)
    );
  }

  @media (pointer: coarse) {
    min-height: 44px;
    /* Wider on both axes: min-height only covers the vertical target. */
    padding: ${({ $size }) =>
      $size === "sm"
        ? "var(--inset-control-small-touch)"
        : "var(--inset-control-touch)"};
  }
`;
