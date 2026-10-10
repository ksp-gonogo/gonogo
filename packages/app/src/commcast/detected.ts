import type { CommcastTransmissionRow } from "@ksp-gonogo/sitrep-sdk";
import type { Seat } from "@ksp-gonogo/sitrep-sdk/spine";
import type { RecipientId } from "./types";

/** The listing of every keying this vantage can detect. */
export const TRANSMISSIONS_TOPIC = "commcast.transmissions";

/**
 * A keying this vantage can detect, from a `commcast.transmissions` row. Its
 * audio is addressed to a group's members only, so this carries who is
 * speaking and to whom and nothing of what is said.
 */
export interface DetectedTransmission {
  transmissionId: string;
  groupId: string;
  from: RecipientId;
  to: readonly RecipientId[];
  authorName: string;
  authorSeat: Seat;
  authorStationKey: string;
  startedUt: number;
  /** The UT of the newest row for this keying. */
  heardUt: number;
}

/**
 * Game seconds after its newest row that a keying still counts as on the air.
 * Rows repeat at least once a game second while a keying continues, so a gap
 * this long is a row that was lost rather than a speaker pausing.
 */
export const DETECTION_LAPSE_SECONDS = 5;

/** A UT as the raw frame carries it: a bare number of seconds, before any unit is attached. */
function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function seatOf(value: unknown): Seat {
  return value === "pilot" ? "pilot" : "mission-control";
}

/**
 * The next set of keyings after one `commcast.transmissions` row: an open row
 * adds or refreshes its keying and an ended row removes it. Returns the same
 * map for a row that is neither.
 */
export function applyTransmissionRow(
  held: ReadonlyMap<string, DetectedTransmission>,
  row: CommcastTransmissionRow,
  heardUt: number,
): ReadonlyMap<string, DetectedTransmission> {
  if (row.phase !== "open" && row.phase !== "ended") return held;
  const next = new Map(held);
  // A keying whose end row never arrived would otherwise be held for good.
  for (const [id, kept] of next) {
    if (heardUt - kept.heardUt > DETECTION_LAPSE_SECONDS) next.delete(id);
  }
  if (row.phase === "ended") {
    next.delete(row.transmissionId);
    return next;
  }
  next.set(row.transmissionId, {
    transmissionId: row.transmissionId,
    groupId: row.groupId,
    from: row.from,
    to: row.to,
    authorName: row.author.name,
    authorSeat: seatOf(row.author.seat),
    authorStationKey: row.author.stationKey,
    startedUt: numberOf(row.startedUt) ?? heardUt,
    heardUt,
  });
  return next;
}

/**
 * The keyings on the air at `utNow` that this screen is not already hearing:
 * not one it spoke itself, and not one to a group it belongs to, which the
 * transmission light draws from the audio.
 */
export function strangersOnAir(
  held: ReadonlyMap<string, DetectedTransmission>,
  utNow: number | undefined,
  screenKey: string | undefined,
  isMine: (groupId: string) => boolean,
): DetectedTransmission[] {
  if (utNow === undefined) return [];
  return [...held.values()].filter(
    (t) =>
      utNow - t.heardUt <= DETECTION_LAPSE_SECONDS &&
      t.authorStationKey !== screenKey &&
      !isMine(t.groupId),
  );
}
