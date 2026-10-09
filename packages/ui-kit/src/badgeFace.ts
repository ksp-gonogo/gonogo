import type { BadgeEntry, Tone } from "@ksp-gonogo/sitrep-sdk";
import { heldGradeOf } from "./readingCurrency";
import { severityFromStreamStatus } from "./status/severity";
import { heldWord } from "./status/streamStatusWord";

/**
 * What a badge entry draws: its words, its tone and its tooltip.
 *
 * @category Badge
 */
export interface BadgeFace {
  /** The words the badge shows: the held grade's word where the entry is held, its own label otherwise. */
  label: string;
  /** The badge's tone. `undefined` draws it neutral. */
  tone: Tone | undefined;
  /** The hover text. `undefined` where there is none. */
  title: string | undefined;
}

/**
 * How a `BadgeEntry` reads once its `held` grade is taken into account. With
 * no held grade it returns the entry's own `label`, `tone` and `title`. With
 * one, the grade's word and severity replace the label and tone, and the
 * title keeps the replaced label (`"<label>: <word>"`) unless the entry set
 * its own. Use it to draw a `BadgeEntry` the same way the panel header does.
 *
 * @category Badge
 */
export function badgeFace(entry: BadgeEntry & { title?: string }): BadgeFace {
  const grade = heldGradeOf(entry.held);
  if (grade === undefined) {
    return { label: entry.label, tone: entry.tone, title: entry.title };
  }
  const label = heldWord(grade);
  return {
    label,
    tone: severityFromStreamStatus(grade),
    title: entry.title ?? `${entry.label}: ${label}`,
  };
}
