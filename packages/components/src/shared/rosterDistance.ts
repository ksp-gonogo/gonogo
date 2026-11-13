import type { TopicReading } from "@ksp-gonogo/sitrep-client";
import {
  type Reading,
  type TargetAvailable,
  TargetKind,
  type TargetListEntry,
  type Value,
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

/**
 * The distance of the vessel with this id as a reading of the roster, so a
 * held roster draws it held, or undefined where the roster does not list the
 * vessel: a craft the active vessel has no way of knowing of has no range here.
 */
export function rosterDistanceById(
  roster: TopicReading<TargetAvailable>,
): (vesselId: string) => Reading<Value<"m">> | undefined {
  const entries =
    roster.state === "observed" || roster.state === "held"
      ? (roster.value.entries ?? [])
      : [];
  const indexOf = new Map<string, number>();
  entries.forEach((entry, index) => {
    if (entry.kind === TargetKind.Vessel && entry.vesselId) {
      indexOf.set(entry.vesselId, index);
    }
  });
  return (vesselId) => {
    const index = indexOf.get(vesselId);
    return index === undefined ? undefined : roster.entries[index]?.distance;
  };
}
