import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import type { ButtonHTMLAttributes } from "react";
import { forwardRef } from "react";
import { Button } from "./Button";

export type ToggleButtonTone = Extract<Tone, "go" | "nogo" | "warn">;
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
 * It draws with the kit's `Button`, pressed while active, so a toggle and a
 * command in effect look alike. `tone` colours the active fill: `go` by
 * default, `nogo` or `warn` when being on is destructive or needs attention.
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
