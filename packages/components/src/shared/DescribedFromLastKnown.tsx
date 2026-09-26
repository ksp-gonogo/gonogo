import { ReadoutCaption } from "@ksp-gonogo/ui-kit";

/**
 * Names the readings a widget is drawing from that are no longer current.
 * Not a live region: currency flips with the link, and announcing every flip
 * would bury the widget's own status region. Renders nothing for an empty list.
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
