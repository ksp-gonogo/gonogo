import type { BadgeEntry, HeldGrade, Tone } from "@ksp-gonogo/sitrep-sdk";
import { heldTone } from "./heldTone";
import { heldGradeOf } from "./readingCurrency";
import { heldWord } from "./status/streamStatusWord";

/**
 * What a badge entry draws: its words, its tone, its tooltip and whether it is
 * held. Useful for telling the operator the state of a widget at a glance.
 * Returned by {@link badgeFace}.
 *
 * @category Badge
 */
export interface BadgeFace {
  /** The words the badge shows: the entry's own `label`, held or not. */
  label: string;
  /** The badge's tone: the entry's own, or its held tone while the entry is held. `undefined` draws it neutral. */
  tone: Tone | undefined;
  /** The hover text. `undefined` where there is none. */
  title: string | undefined;
  /** The held grade while the entry's reading is held, for the badge's `held` prop. Absent while it is current. */
  held?: HeldGrade;
}

/**
 * How a `BadgeEntry` reads once its `held` reading is taken into account. With
 * no held grade it returns the entry's own `label`, `tone` and `title`. With
 * one, the label stays, the tone becomes its held tone (`go` and `info` read
 * `caution`, every other tone is kept), the title names the grade
 * (`"<label>: <word>"`) unless the entry set its own, and `held` carries the
 * grade so the badge draws its held square. Useful for showing the operator a
 * widget's badge the same way the panel header does. Used by the panel header
 * and the screen header badges.
 *
 * @category Badge
 */
export function badgeFace(entry: BadgeEntry & { title?: string }): BadgeFace {
  const grade = heldGradeOf(entry.held);
  if (grade === undefined) {
    return { label: entry.label, tone: entry.tone, title: entry.title };
  }
  return {
    label: entry.label,
    tone: heldTone(entry.tone),
    title: entry.title ?? `${entry.label}: ${heldWord(grade)}`,
    held: grade,
  };
}
