import { AugmentSlot } from "@ksp-gonogo/core";
import { AutoEmptyState } from "@ksp-gonogo/ui-kit";
import { ASTRONAUT_COMPLEX_TRAINING_SLOT, NO_SEGMENT_PROPS } from "./slots";
import { EMPTY_STYLE } from "./styles";

/** The courses an Uplink claims the training slot for. */
export function TrainingTab() {
  // Rows spaced like the other tabs, and an empty state: a claimed slot is not a filled one, and only `AutoEmptyState` can tell.
  return (
    <AutoEmptyState
      fallback={<div style={EMPTY_STYLE}>No training right now</div>}
      gap="section-compact"
    >
      <AugmentSlot
        name={ASTRONAUT_COMPLEX_TRAINING_SLOT}
        props={NO_SEGMENT_PROPS}
      />
    </AutoEmptyState>
  );
}
