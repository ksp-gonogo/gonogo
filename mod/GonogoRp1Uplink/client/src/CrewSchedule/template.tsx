import { magnitudeOf, Unit } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import type {
  Rp1TrainingCourseEntry,
  Rp1TrainingTemplateEntry,
} from "../__generated__/contract";

/**
 * The facts about a training that every surface reads: what it is called, which
 * of RP-1's two KINDS it is, and how many students it seats.
 *
 * <para>Shared rather than copied because the seat bounds decide a refusal on
 * each surface and the two refusals have to agree. A naut's row cannot fill a
 * course seating two; the crew picker can, and it draws the same bounds beside
 * the same picker to say so. Two implementations of "seats 2 to 4" would drift
 * into two different claims about one course.</para>
 */

/** Either shape carrying RP-1's kind, name and target: a catalogue entry or a live course. */
type Training = Rp1TrainingTemplateEntry | Rp1TrainingCourseEntry;

/**
 * RP-1's two kinds of training, in words that say which is which.
 *
 * <para><b>"Mission" is a KIND OF TRAINING and not a mission.</b> RP-1 generates
 * up to two templates per crewed part and names them
 * <c>"Proficiency: &lt;part&gt;"</c> and <c>"Mission: &lt;part&gt;"</c>; the enum
 * behind them is <c>TrainingTemplate.TrainingType</c>, whose two members are
 * <c>Proficiency</c> and <c>Mission</c>. Rendering that second name raw puts the
 * word "MISSION" beside a duration and a seat count, which reads as a flight
 * lasting thirty days rather than as the training for one. RP-1's own prose form
 * says the longer thing (<c>GetPrettyCourseName</c> answers "Mission training
 * for "), and so does this.</para>
 *
 * <para>The difference is worth the extra word because the two behave
 * differently in the one way an operator plans around: a proficiency is a
 * permanent qualification on the part, while mission training LAPSES a set
 * interval after the course completes and has to be taken again. A kerbal's row
 * says when theirs lapses; this says which kind can.</para>
 */
export function kindOf(type: string | null | undefined): string | null {
  if (type === "Mission") return "Mission training";
  if (type === "Proficiency") return "Proficiency";
  // An unrecognised kind is carried rather than dropped: a kind RP-1 adds is
  // still a fact, and a blank would say the training has no kind at all.
  return type ?? null;
}

/**
 * What this training is called, kind first.
 *
 * <para>Built from the kind and the target rather than taken from RP-1's own
 * <c>name</c>, which already carries a kind word of its own: reading the name
 * and then stating the type beside it said "Mission" twice on one line. The name
 * is the fallback for a training whose target did not arrive, so nothing is
 * unnamed.</para>
 */
export function titleOf(training: Training): string {
  const kind = kindOf(training.type);
  if (kind !== null && training.target) {
    return `${kind}: ${training.target}`;
  }
  return training.name ?? training.target ?? training.id ?? "";
}

/**
 * Whether this training stays true once it is finished, which is the whole
 * difference between RP-1's two kinds and the thing a picker cannot show.
 *
 * <para>Read off the KIND rather than off an expiry on the wire, and that is
 * sound rather than a shortcut: every template in the game is generated in code
 * (<c>CrewHandler.AddPartCourses</c>, there is no config-defined path), and
 * <c>GenerateCourseMission</c> is the only one of the two generators that sets
 * <c>expiration</c>. <c>TrainingCourse.CompleteCourse</c> then writes an expiry
 * record only where that field is above zero, and
 * <c>NautHasTrainingForPart</c> accepts a proficiency record with no expiry
 * check at all.</para>
 *
 * <para>It renders here because the picker cannot: RP-1's own name for the
 * training carries the kind, but a closed <c>select</c> shows one option and the
 * operator is choosing between two trainings on the same part. The consequence
 * of that choice is a sentence, and this is it.</para>
 */
export function lapseRule(template: Rp1TrainingTemplateEntry): string | null {
  if (template.type === "Mission") return "Lapses after completion";
  if (template.type === "Proficiency") return "Permanent once complete";
  return null;
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
