import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import type { ButtonHTMLAttributes } from "react";
import { forwardRef } from "react";
import { Button } from "./Button";

/**
 * The fill an active {@link ToggleButton} takes: `go`, or `nogo` / `warn` when
 * being on is destructive or needs attention.
 *
 * @category Button
 */
export type ToggleButtonTone = Extract<Tone, "go" | "nogo" | "warn">;

/**
 * {@link ToggleButton}'s size, the same steps as {@link ButtonSize}.
 *
 * @category Button
 */
export type ToggleButtonSize = "sm" | "md";

/**
 * Props for {@link ToggleButton}. Any other `button` attribute passes through.
 *
 * @category Button
 */
export interface ToggleButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Whether the toggle is on. Drives `aria-pressed` and the filled look. Defaults to `false`. */
  active?: boolean;
  /** The fill while active. Defaults to `go`. */
  tone?: ToggleButtonTone;
  /** Defaults to `md`. */
  size?: ToggleButtonSize;
}

/**
 * A two-state toggle: a real `<button>` whose `aria-pressed` follows `active`,
 * for controls that switch between on and off (mode pickers, filter toggles,
 * rate pickers). It draws as a {@link Button}, filled in `tone` while active
 * and plain while not.
 *
 * ToggleButton or {@link Switch}? They are different ARIA patterns:
 *
 * - ToggleButton is a button whose label is the thing being chosen, usually
 *   one of several peers (warp rates, a filter row, a view mode). Pressing it
 *   acts, and `aria-pressed` says which peer is on
 * - `Switch` is a single boolean setting with a label beside it, rendered as a
 *   checkbox with a track and thumb. It configures rather than acts
 *
 * If the control sits in a row of alternatives, it is a ToggleButton. If it
 * sits in a settings list next to its own label, it is a Switch.
 *
 * @example
 * ```tsx
 * <Inline>
 *   {RATES.map((rate) => (
 *     <ToggleButton
 *       key={rate}
 *       size="sm"
 *       active={rate === current}
 *       onClick={() => setRate(rate)}
 *     >
 *       {rate}x
 *     </ToggleButton>
 *   ))}
 * </Inline>
 * ```
 *
 * @category Button
 */
export const ToggleButton = forwardRef<HTMLButtonElement, ToggleButtonProps>(
  function ToggleButton(
    {
      active = false,
      tone = "go",
      size = "md",
      type = "button",
      "aria-pressed": ariaPressed,
      ...rest
    },
    ref,
  ) {
    return (
      <Button
        ref={ref}
        type={type}
        /* The tone colours the pressed fill only; an inactive toggle is a plain button. */
        tone={active ? tone : undefined}
        size={size}
        pressed={active}
        aria-pressed={ariaPressed ?? active}
        {...rest}
      />
    );
  },
);
