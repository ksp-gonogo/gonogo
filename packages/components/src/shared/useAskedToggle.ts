import { useRef } from "react";
import {
  askedToggleValue,
  type ToggleConfirmation,
} from "./toggleConfirmation";

/**
 * The state a toggle's next press inverts. While the latest press is
 * outstanding the shown reading is still the old state, so the press inverts
 * the state that press asked for; otherwise it inverts the reading.
 * `asked` records the args of each press as it is sent.
 */
export function useAskedToggle(
  confirmation: ToggleConfirmation | null,
  shown: unknown,
): { base: unknown; asked: (args: unknown) => void } {
  const last = useRef<boolean | undefined>(undefined);
  const base =
    confirmation !== null && last.current !== undefined ? last.current : shown;
  return {
    base,
    asked: (args) => {
      last.current = askedToggleValue(args);
    },
  };
}
