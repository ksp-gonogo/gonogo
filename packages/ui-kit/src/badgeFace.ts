import type { BadgeEntry, HeldGrade, Tone } from "@ksp-gonogo/sitrep-sdk";
import { severityFromStreamStatus } from "./status/severity";
import { heldWord } from "./status/streamStatusWord";

/**
 * What a badge entry draws: its words, its tone and its tooltip.
 *
 * @category Badge
 */
export interface BadgeFace {
  label: string;
  tone: Tone | undefined;
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
  const grade = heldGradeOf(entry);
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

/**
 * A badge's own grade, whether it names one directly or carries the whole
 * `Reading` it was derived from. `Reading.grade` is only ever set once the
 * reading itself is `"held"`, so a live reading passed through `held` yields
 * `undefined` here the same as no `held` at all.
 */
function heldGradeOf(entry: BadgeEntry): HeldGrade | undefined {
  const held = entry.held;
  if (held === undefined) return undefined;
  return typeof held === "string" ? held : held.grade;
}
