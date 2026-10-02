import type { RailDirection } from "@ksp-gonogo/sitrep-sdk";
import type { InFlightListItem } from "./InFlightList";

/** The structural subset of an in-flight command that this mapping reads. */
export interface InFlightCommandLike {
  id: string;
  label: string;
  command: string;
  reachEtaSeconds: number | null;
  replyEtaSeconds: number | null;
  predictedPhase: InFlightListItem["phase"];
  /** The issuing button's own terse glyph ("PRO", "RET"). Defaults to an abbreviation of `label`. */
  glyph?: string;
  /** Which way the entry crosses the link. Absent reads as a command going up. */
  direction?: RailDirection;
  /** The one-way delay the entry was sent under, which places an entry with no reply leg. */
  oneWaySeconds?: number;
}

/**
 * Fallback queue glyph: the significant word of the label, upper-cased and cut
 * to 4 chars ("SAS Prograde" -> "PROG"). An identity, never a status word.
 */
export function deriveGlyph(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const pick = words.length > 1 ? words[words.length - 1] : (words[0] ?? "");
  const letters = pick.replace(/[^a-zA-Z0-9]/g, "");
  return (letters || label).slice(0, 4).toUpperCase();
}

/** Progress anchored by phase, for when the eta geometry is missing (overdue, lost, zero delay, or a hand-built item). */
export const PHASE_PROGRESS: Record<InFlightListItem["phase"], number> = {
  "in-transit": 0.18,
  "awaiting-reply": 0.5,
  due: 0.62,
  overdue: 0.82,
  lost: 0.95,
};

/**
 * An entry's TRUE progress along the 3-stage delay axis (0 just sent, 1 the
 * end of the 3T span). `T = replyEtaSeconds - reachEtaSeconds`, which holds even once
 * `reachEtaSeconds` goes negative, or the sent-under delay for an entry with no reply
 * leg; elapsed is `T - reachEtaSeconds`. Falls back to a phase anchor when `T` or the
 * reach eta is absent.
 */
export function journeyProgress(item: InFlightCommandLike): number {
  const reach = item.reachEtaSeconds;
  const t = oneWayOf(item);
  if (reach === null || t === null) return PHASE_PROGRESS[item.predictedPhase];
  const elapsed = t - reach;
  return Math.max(0, Math.min(1, elapsed / (3 * t)));
}

/** `T` from the reply leg when there is one, else from the delay the entry was sent under. */
function oneWayOf(item: InFlightCommandLike): number | null {
  const reach = item.reachEtaSeconds;
  const reply = item.replyEtaSeconds;
  if (reach !== null && reply !== null && reply > reach) return reply - reach;
  if (
    reply === null &&
    item.oneWaySeconds !== undefined &&
    item.oneWaySeconds > 0
  ) {
    return item.oneWaySeconds;
  }
  return null;
}

/**
 * Maps a handle's in-flight commands (`useCommand().inFlight`) to
 * {@link InFlightListItem}s for {@link InFlightList}. While `in-transit` a row
 * counts down to the command REACHING the craft; after that, to the
 * acknowledgement coming back. `label` falls back to the command id.
 *
 * @category CommandDelay
 */
export function toInFlightListItems(
  items: readonly InFlightCommandLike[],
): InFlightListItem[] {
  return items.map((item) => ({
    id: item.id,
    label: item.label || item.command,
    etaSeconds:
      item.predictedPhase === "in-transit"
        ? item.reachEtaSeconds
        : item.replyEtaSeconds,
    phase: item.predictedPhase,
    progress: journeyProgress(item),
    glyph: item.glyph ?? deriveGlyph(item.label || item.command),
    ...(item.direction === "telemetry" ? { flow: "inbound" as const } : {}),
  }));
}
