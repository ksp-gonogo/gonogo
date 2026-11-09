import { useActionInput } from "@ksp-gonogo/core";
import { useCommand } from "@ksp-gonogo/sitrep-client";
import { useCommandControl } from "@ksp-gonogo/ui-kit";
import type { TargetPickerActions } from "./config";

/**
 * The clear-target control, with the clear-target action bound to it, whichever
 * size the widget is drawn at. `before` runs as the command is sent.
 */
export function useClearTarget(before?: () => void) {
  // Clearing the target is subject to signal delay.
  const clearTargetCmd = useCommand("vessel.target.clear");
  const control = useCommandControl({
    command: clearTargetCmd.with(undefined, { label: "Clear target", before }),
  });
  useActionInput<TargetPickerActions>({
    "clear-target": (payload) => {
      if (payload.kind !== "button" || payload.value !== true) return;
      // A blocked control is drawn dark and a bound key leaves it alone too.
      if (control.isBlocked) return;
      control.press(false);
    },
  });
  return control;
}
