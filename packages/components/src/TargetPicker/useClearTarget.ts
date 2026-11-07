import { useActionInput } from "@ksp-gonogo/core";
import { useCommand } from "@ksp-gonogo/sitrep-client";
import type { TargetPickerActions } from "./config";

/** The clear-target command, with the clear-target action bound to it, whichever size the widget is drawn at. */
export function useClearTarget() {
  // Clearing the target is subject to signal delay.
  const clearTargetCmd = useCommand("vessel.target.clear");
  useActionInput<TargetPickerActions>({
    "clear-target": (payload) => {
      if (payload.kind !== "button" || payload.value !== true) return;
      void clearTargetCmd.send(undefined, { label: "Clear target" });
    },
  });
  return clearTargetCmd;
}
