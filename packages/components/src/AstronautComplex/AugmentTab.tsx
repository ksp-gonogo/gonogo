import { AugmentSlot } from "@ksp-gonogo/core";
import { AutoEmptyState } from "@ksp-gonogo/ui-kit";
import { ASTRONAUT_COMPLEX_TAB_SLOT, NO_SEGMENT_PROPS } from "./slots";
import { EMPTY_STYLE } from "./styles";

/** Whatever the bound augment renders into `astronaut-complex.tab`. */
export function AugmentTab() {
  // Rows spaced like the other tabs, and an empty state: a claimed slot is not a filled one, and only `AutoEmptyState` can tell.
  return (
    <AutoEmptyState
      fallback={<div style={EMPTY_STYLE}>Nothing here yet</div>}
      gap="section-compact"
    >
      <AugmentSlot name={ASTRONAUT_COMPLEX_TAB_SLOT} props={NO_SEGMENT_PROPS} />
    </AutoEmptyState>
  );
}
