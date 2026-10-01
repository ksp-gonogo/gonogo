import type { HeldGrade, StreamStatusValue } from "@ksp-gonogo/sitrep-sdk";

/**
 * The operator's word for each reason a held reading stopped updating.
 *
 * Blackout and recorded keep words of their own because they ask something
 * different of the operator: a blackout is waited out, and a recorded value is
 * exact for the instant it names. Only a Topic that simply went quiet is HELD.
 */
const HELD_GRADE_WORD: Readonly<Record<HeldGrade, string>> = {
  held: "HELD",
  disconnected: "OFFLINE",
  "last-before-blackout": "BLACKOUT",
  recorded: "RECORDED",
};

/** Every word a held mark's caption can open with, one per grade. */
export const HELD_WORDS: readonly string[] = Object.values(HELD_GRADE_WORD);

const STREAM_STATUS_WORD: Readonly<Record<StreamStatusValue, string | null>> = {
  ...HELD_GRADE_WORD,
  live: null,
  resyncing: "SYNCING",
  absent: "NO DATA",
};

/**
 * The short uppercase word a badge or caption prints for a `StreamStatusValue`
 * (HELD, OFFLINE, BLACKOUT, RECORDED, SYNCING, NO DATA), or `null` for `"live"`,
 * which shows nothing.
 *
 * @category Badge
 */
export function formatStreamStatus(status: StreamStatusValue): string | null {
  return STREAM_STATUS_WORD[status];
}

/**
 * The word for a held reading's grade (HELD, OFFLINE, BLACKOUT or RECORDED), or
 * HELD when no grade is given, as for a value combined from several readings.
 *
 * @category Badge
 */
export function heldWord(grade: HeldGrade | undefined): string {
  return HELD_GRADE_WORD[grade ?? "held"];
}
