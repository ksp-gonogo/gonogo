import type { CommandHold, RailDirection } from "@ksp-gonogo/sitrep-sdk";
import type { InFlightListItem } from "./InFlightList";

/**
 * The structural subset of an in-flight command that this mapping reads. Useful
 * for passing the commands a widget has sent to the display that shows the
 * operator what is still on its way. Taken by {@link toInFlightListItems}.
 *
 * @category CommandDelay
 */
export interface InFlightCommandLike {
  /** Stable for the entry's lifetime, so the list keeps its row as it moves. */
  id: string;
  /** The entry in the operator's words, such as "SAS Prograde". */
  label: string;
  /** The command id it was sent as. */
  command: string;
  /** Seconds until it reaches the far end; `null` when there is no path. */
  reachEtaSeconds: number | null;
  /** Seconds until its reply is expected back; `null` when there is no path, and always for an entry that expects no reply. */
  replyEtaSeconds: number | null;
  /** Where it is expected to be now. */
  predictedPhase: InFlightListItem["phase"];
  /** The issuing button's own terse glyph ("PRO", "RET"). Defaults to an abbreviation of `label`. */
  glyph?: string;
  /** Which way the entry crosses the link. Absent reads as a command going up. */
  direction?: RailDirection;
  /** The one-way delay the entry was sent under, which places an entry with no reply leg. Absent or `null` for one sent with no route known. */
  oneWaySeconds?: number | null;
  /** When it was sent, as a UT, which orders a queue merged from several handles. */
  dispatchedAt?: number;
  /** True while the route holds the command at a relay, waiting for a link. */
  held?: boolean;
  /** Where a command held on its way out waits, which places it at the relay on the rail. */
  hold?: CommandHold;
  /**
   * Set on an entry that has just left. `confirmed` when it was answered: it is
   * drawn carrying on to the end of the rail over `settleSeconds`, then fading.
   * `failed` when it was refused, failed or dismissed: it is drawn fading where
   * it last was.
   */
  settling?: "confirmed" | "failed";
  /** How long a `confirmed` entry takes to reach the end of the rail, in seconds. */
  settleSeconds?: number;
}

/**
 * Fallback queue glyph: the significant word of the label, upper-cased and cut
 * to 4 chars ("SAS Prograde" -> "PROG"). An identity, never a status word.
 * Useful for labelling a command's tile in the operator's queue. Used by
 * {@link InFlightList} and {@link CommandList}.
 */
export function deriveGlyph(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const pick = words.length > 1 ? words[words.length - 1] : (words[0] ?? "");
  const letters = pick.replace(/[^a-zA-Z0-9]/g, "");
  return (letters || label).slice(0, 4).toUpperCase();
}

/**
 * Progress anchored by phase, for when the eta geometry is missing (overdue,
 * lost, zero delay, or a hand-built item). Used by {@link InFlightList}.
 */
export const PHASE_PROGRESS: Record<InFlightListItem["phase"], number> = {
  "in-transit": 1 / 6,
  "awaiting-reply": 1 / 2,
  due: 2 / 3,
  overdue: 2 / 3,
  lost: 2 / 3,
};

/**
 * An entry's progress along the rail's three equal stages, each one one-way
 * delay long: 0 when sent, 1/3 when it reaches the far end, 2/3 when its reply
 * is due back. The last third is the confirmed stage, which an entry enters
 * only once it is answered (see `settling`), so an entry still unanswered
 * waits at 2/3, or at 1/3 when it expects no reply. Falls back to a phase
 * anchor when the delay or the reach eta is absent. Useful for showing the
 * operator how far a command has travelled.
 */
export function journeyProgress(item: InFlightCommandLike): number {
  const reach = item.reachEtaSeconds;
  if (item.hold && reach !== null && reach > 0)
    return outboundWithHold(item.hold);
  const t = oneWayOf(item);
  if (reach === null || t === null) return PHASE_PROGRESS[item.predictedPhase];
  // T is the reply leg (reply - reach), which holds even once reach goes negative, or the sent-under delay with no reply leg.
  const elapsed = t - reach;
  const wait = item.replyEtaSeconds === null ? 1 / 3 : 2 / 3;
  return Math.max(0, Math.min(wait, elapsed / (3 * t)));
}

/**
 * How long an entry answered now takes to cross the rest of the rail at the
 * pace it travelled, in seconds; 0 when its delay is unknown. Useful for
 * drawing an answered command on through the confirmed stage. Used by the
 * panel delay rail.
 */
export function secondsToRailEnd(item: InFlightCommandLike): number {
  const t = oneWayOf(item);
  if (t === null) return 0;
  return Math.max(0, (1 - journeyProgress(item)) * 3 * t);
}

/* The first third is the way out: a command held on the way is drawn where its hold says it is along it. */
function outboundWithHold(hold: CommandHold): number {
  return Math.max(0, Math.min(1, hold.outbound)) / 3;
}

/** `T` from the reply leg when there is one, else from the delay the entry was sent under. */
function oneWayOf(item: InFlightCommandLike): number | null {
  const reach = item.reachEtaSeconds;
  const reply = item.replyEtaSeconds;
  if (reach !== null && reply !== null && reply > reach) return reply - reach;
  if (reply === null && item.oneWaySeconds != null && item.oneWaySeconds > 0) {
    return item.oneWaySeconds;
  }
  return null;
}

/**
 * Maps a handle's in-flight commands (`useCommand().inFlight`) to
 * {@link InFlightListItem}s for {@link InFlightList}. While `in-transit` a row
 * counts down to the command reaching the vessel; after that, to the
 * acknowledgement coming back. `label` falls back to the command id. Useful for
 * showing the operator the commands a widget has sent and when each arrives.
 * Used by {@link CommandDelay}.
 *
 * @category CommandDelay
 */
export function toInFlightListItems(
  items: readonly InFlightCommandLike[],
): InFlightListItem[] {
  return inSendOrder(items).map((item) => ({
    id: item.id,
    label: item.label || item.command,
    etaSeconds:
      item.predictedPhase === "in-transit"
        ? item.reachEtaSeconds
        : item.replyEtaSeconds,
    phase: item.predictedPhase,
    // An answered entry is drawn heading for the end, which it glides to over settleSeconds.
    progress: item.settling === "confirmed" ? 1 : journeyProgress(item),
    glyph: item.glyph ?? deriveGlyph(item.label || item.command),
    ...(item.held ? { held: true as const } : {}),
    ...(item.settling
      ? { settling: item.settling, settleSeconds: item.settleSeconds ?? 0 }
      : {}),
    ...(item.direction === "telemetry" ? { flow: "inbound" as const } : {}),
  }));
}

/** The entries in the order they were sent, an entry with no send time keeping its place. */
function inSendOrder(
  items: readonly InFlightCommandLike[],
): readonly InFlightCommandLike[] {
  if (!items.some((i) => i.dispatchedAt !== undefined)) return items;
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        (a.item.dispatchedAt ?? Number.NEGATIVE_INFINITY) -
          (b.item.dispatchedAt ?? Number.NEGATIVE_INFINITY) ||
        a.index - b.index,
    )
    .map(({ item }) => item);
}
