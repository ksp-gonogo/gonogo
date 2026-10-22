import type { ScienceArrival, Value } from "@ksp-gonogo/sitrep-sdk";

/** The topic that lists the transmissions that have reached the command centre. */
export const ARRIVALS_TOPIC = "science.transmissions" as const;

/** A transmission that has reached the command centre, as `science.transmissions` lists it. */
export interface Arrival {
  /** Tells this arrival from every other in the list. */
  key: string;
  title: string | null;
  size: Value<"Mit"> | null;
  /** The instant the last packet left the vessel. */
  leftAt: Value<"ut">;
  /** How long the vessel took to send it, null when its start was not seen. */
  sendTime: Value<"s"> | null;
}

/**
 * Reads `science.transmissions`, newest first. Null for a list that has not
 * arrived, which says nothing about whether any transmission has.
 */
export function arrivalsOf(
  list: readonly ScienceArrival[] | null | undefined,
): Arrival[] | null {
  if (!list) return null;
  return list
    .map((entry, position) => ({
      key: `${entry.subjectId ?? "unnamed"}@${position}`,
      title: entry.title || entry.subjectId || null,
      size: entry.dataAmount ?? null,
      leftAt: entry.completedAt,
      sendTime: entry.startedAt
        ? entry.completedAt.minus(entry.startedAt)
        : null,
    }))
    .sort((a, b) => (a.leftAt.greaterThan(b.leftAt) ? -1 : 1));
}
