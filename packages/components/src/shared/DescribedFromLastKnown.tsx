import { ReadoutCaption } from "@ksp-gonogo/ui-kit";

/**
 * The caption a widget shows while it is drawing from readings that are no
 * longer current, naming which ones.
 *
 * An annotation and nothing more: the figures and drawings beside it stay at
 * full legibility, because a held reading is still the best one available.
 * Deliberately not a live region, since currency flips with the link and an
 * announcement on every flip would bury whatever the widget's own status
 * region says.
 *
 * Renders nothing for an empty list, so a widget passes whatever is dated and
 * a board with every reading current says nothing.
 */
export function DescribedFromLastKnown({
  readings,
}: Readonly<{ readings: readonly string[] }>) {
  if (readings.length === 0) return null;
  return (
    <ReadoutCaption>
      {`Described from last known ${readings.join(", ")}, not current`}
    </ReadoutCaption>
  );
}
