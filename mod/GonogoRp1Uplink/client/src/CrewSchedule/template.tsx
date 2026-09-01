import { magnitudeOf, Unit } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import type { Rp1TrainingTemplateEntry } from "../__generated__/contract";

/**
 * The two facts about a training that BOTH enrolment surfaces read: what RP-1
 * calls it, and how many students it seats.
 *
 * <para>Shared rather than copied because the seat bounds decide a refusal on
 * each surface and the two refusals have to agree. A naut's row cannot fill a
 * course seating two; the crew picker can, and it draws the same bounds beside
 * the same picker to say so. Two implementations of "seats 2 to 4" would drift
 * into two different claims about one course.</para>
 */

/** RP-1's own name for a training, or the parts of one it did send. */
export function titleOf(template: Rp1TrainingTemplateEntry): string {
  return template.name ?? template.target ?? template.id ?? "";
}

/**
 * The seat bounds, which are what decides whether a surface can start the
 * training at all. Absent when RP-1 sent no minimum, rather than assumed: the
 * refusals that read the same field would then be guessing too.
 */
export function Seats({
  template,
}: Readonly<{ template: Rp1TrainingTemplateEntry }>): ReactNode {
  const min = magnitudeOf(template.seatMin);
  if (min === null) {
    return null;
  }
  const max = magnitudeOf(template.seatMax);
  return (
    <>
      {" · seats "}
      <Unit value={template.seatMin} />
      {/* RP-1 stores -1 for no maximum and the wire carries it as it stands,
          so a non-positive maximum is a course with no ceiling rather than one
          that seats nobody. */}
      {max !== null && max <= 0 && ", no maximum"}
      {max !== null && max > min && (
        <>
          {" to "}
          <Unit value={template.seatMax} />
        </>
      )}
    </>
  );
}
