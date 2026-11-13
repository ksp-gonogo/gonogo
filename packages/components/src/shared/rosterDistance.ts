import type { TopicReading } from "@ksp-gonogo/sitrep-client";
import type {
  Reading,
  TargetAvailable,
  TargetListEntry,
  Value,
} from "@ksp-gonogo/sitrep-sdk";

/**
 * Each roster entry's distance as a reading of the roster it came from, so a
 * held roster draws its ranges held.
 *
 * Looked up by identity: an entry taken off the roster's own payload (through
 * `stillTrue`, then filtered or sorted) is the same object the reading indexes.
 * An entry from anywhere else answers undefined.
 */
export function rosterDistance(
  roster: TopicReading<TargetAvailable>,
): (entry: TargetListEntry) => Reading<Value<"m">> | undefined {
  // A record missing `entries` is an empty roster, as the picker reads it.
  const entries =
    roster.state === "observed" || roster.state === "held"
      ? (roster.value.entries ?? [])
      : [];
  const indexOf = new Map(entries.map((entry, index) => [entry, index]));
  return (entry) => {
    const index = indexOf.get(entry);
    return index === undefined ? undefined : roster.entries[index]?.distance;
  };
}
