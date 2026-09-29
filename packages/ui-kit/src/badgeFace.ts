import type { BadgeEntry, HeldGrade, Tone } from "@ksp-gonogo/sitrep-sdk";
import { severityFromStreamStatus } from "./status/severity";
import { heldWord } from "./status/streamStatusWord";

/**
 * What a badge entry draws: its words, its tone and its tooltip.
 *
 * @category Panel
 */
export interface BadgeFace {
  label: string;
  tone: Tone | undefined;
  title: string | undefined;
}

/**
 * How a badge entry reads once its `held` grade is taken into account. Live,
 * that is its own `label` and `tone`; held, the grade's own word and severity
 * replace the verdict computed from it, since a reading that stopped arriving
 * cannot still be asserted as current, and the tooltip keeps the verdict it
 * replaced. Every surface that draws a `BadgeEntry` goes through this, so a
 * held badge reads the same in a panel header as in the screen header.
 *
 * @category Panel
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
