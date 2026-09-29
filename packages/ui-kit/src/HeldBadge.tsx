import type { HeldGrade } from "@ksp-gonogo/sitrep-sdk";
import { Badge, type BadgeSize } from "./Badge";
import { severityFromStreamStatus } from "./status/severity";
import { heldWord } from "./status/streamStatusWord";

/**
 * Props for {@link HeldBadge}.
 *
 * @category Stream status
 */
export interface HeldBadgeProps {
  /** Why the reading behind this part of the widget stopped updating. */
  grade: HeldGrade;
  /** What is held, in the operator's terms, for the hover text: "Contract board", a part's title. */
  subject?: string;
  size?: BadgeSize;
}

/**
 * The chip a widget draws beside one part of itself whose reading is held: a
 * row, a card, a totals cell. It prints the grade's word and severity, so it
 * always agrees with the panel's own badge.
 *
 * Not a live region, unlike {@link StreamStatusBadge}: many rows going held at
 * once is one event, and the panel's badge already announces it.
 *
 * @category Stream status
 */
export function HeldBadge({ grade, subject, size }: HeldBadgeProps) {
  const word = heldWord(grade);
  return (
    <Badge
      severity={severityFromStreamStatus(grade)}
      size={size}
      title={subject === undefined ? undefined : `${subject}: ${word}`}
    >
      {word}
    </Badge>
  );
}
