import type { HeldGrade } from "@ksp-gonogo/sitrep-sdk";
import { Badge, type BadgeSize } from "./Badge";
import { severityFromStreamStatus } from "./status/severity";
import { heldWord } from "./status/streamStatusWord";
import { Tooltip } from "./Tooltip";

/**
 * Props for {@link HeldBadge}.
 *
 * @category Badge
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
 * It is not a live region, unlike {@link StreamStatusBadge}: the panel's own
 * badge announces the change once.
 *
 * @category Badge
 */
export function HeldBadge({ grade, subject, size }: HeldBadgeProps) {
  const word = heldWord(grade);
  return (
    <Tooltip
      text={subject === undefined ? undefined : `${subject}: ${word}`}
      focusable
    >
      <Badge tone={severityFromStreamStatus(grade)} size={size}>
        {word}
      </Badge>
    </Tooltip>
  );
}
