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

const STREAM_STATUS_WORD: Readonly<Record<StreamStatusValue, string | null>> = {
  ...HELD_GRADE_WORD,
  live: null,
  resyncing: "SYNCING",
  absent: "NO DATA",
};

/**
 * `StreamStatusValue` -> the short word a badge or a caption prints, or `null`
 * for `"live"`.
 *
 * A healthy stream shows nothing: a pill present in the normal case teaches
 * the operator to stop seeing it.
 *
 * @category Stream status
 */
export function formatStreamStatus(status: StreamStatusValue): string | null {
  return STREAM_STATUS_WORD[status];
}

/**
 * The word for a held reading: its grade's, or HELD where the reading names no
 * grade, as a value combined from several readings does.
 *
 * @category Stream status
 */
export function heldWord(grade: HeldGrade | undefined): string {
  return HELD_GRADE_WORD[grade ?? "held"];
}
