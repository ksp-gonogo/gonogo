import {
  TargetKnowledge,
  type TargetListEntry,
  type Value,
} from "@ksp-gonogo/sitrep-sdk";
import { speakQuantity } from "@ksp-gonogo/ui-kit";

/**
 * Whether the active craft sees this entry as it is: a craft within physics
 * range, a part (which is always on one), a body, and any entry from a mod that
 * does not say how the craft knows of it.
 */
export function seenAsItIs(entry: TargetListEntry): boolean {
  return entry.source == null || entry.source === TargetKnowledge.InRange;
}

/**
 * Whether the entry is taken not to have changed since it was last heard,
 * because its radio link to the active craft is up and has brought nothing
 * newer. That is worked out from silence, so it is shown as modelled.
 */
export function unchangedSinceHeard(entry: TargetListEntry): boolean {
  return (
    entry.unchangedToUt != null &&
    entry.asOfUt != null &&
    entry.unchangedToUt.valueOf() > entry.asOfUt.valueOf()
  );
}

/**
 * How the craft came to know of the entry and how long ago, as the words under
 * a held or modelled mark: "Last heard 4 minutes ago via KSC". `null` for an
 * entry the craft sees as it is, which needs no telling.
 */
export function knowledgeCaption(
  entry: TargetListEntry,
  viewUt: Value<"ut"> | undefined,
): string | null {
  if (seenAsItIs(entry)) return null;
  if (unchangedSinceHeard(entry) && entry.unchangedToUt != null) {
    const how =
      entry.source === TargetKnowledge.DirectLink
        ? "over a direct radio link that is up"
        : entry.via
          ? `at ${entry.via}, which holds its link as up`
          : "at its command centre, which holds its link as up";
    return viewUt === undefined
      ? `No change heard ${how}`
      : `No change heard as of ${speakQuantity(viewUt.minus(entry.unchangedToUt))} ago, ${how}`;
  }
  const when =
    entry.asOfUt == null || viewUt === undefined
      ? "Last heard"
      : `Last heard ${speakQuantity(viewUt.minus(entry.asOfUt))} ago`;
  if (entry.source === TargetKnowledge.DirectLink) {
    return `${when} over a direct radio link`;
  }
  return entry.via
    ? `${when} via ${entry.via}`
    : `${when} from its command centre`;
}
