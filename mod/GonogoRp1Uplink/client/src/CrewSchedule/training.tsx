import {
  Cluster,
  CommandButton,
  magnitudeOf,
  ReadoutCaption,
} from "@ksp-gonogo/ui-kit";
import type { Rp1TrainingCourseEntry } from "../__generated__/contract";
// Side-effect import: hydrates these Topics' units at decode time, so a base
// time decodes as a duration rather than a bare number of seconds.
import "../topics";

/** Must match `Rp1TrainingCommands.EnrolCommand`. */
export const RP1_TRAINING_ENROL_COMMAND = "rp1.training.enrol";

/** Must match `Rp1TrainingCommands.CancelCommand`. */
export const RP1_TRAINING_CANCEL_COMMAND = "rp1.training.cancel";

/** Must match `Rp1TrainingCommands.RemoveCommand`. */
export const RP1_TRAINING_REMOVE_COMMAND = "rp1.training.remove";

export interface CourseControlsProps {
  /** The live course these controls act on. */
  course: Rp1TrainingCourseEntry;
  /** The shared `rp1.training.cancel` handle; each button holds its own arm state. */
  cancel: Parameters<typeof CommandButton>[0]["handle"];
  /** The shared `rp1.training.remove` handle. */
  remove: Parameters<typeof CommandButton>[0]["handle"];
}

/**
 * RP-1's two ways off a course, drawn on the COURSE rather than on the nauts.
 *
 * <para>They are different acts and their subjects are different too, which is
 * why they sit here: cancelling ends the course and takes every student on it
 * off, so it is about the course; removing takes one named student off and
 * leaves it running for the rest, so there is one of it per student. Drawn on a
 * roster row instead, the cancel appeared once per student and said "2 off" from
 * both of them, which is one act rendered twice.</para>
 *
 * <para>Neither grants anything, which is on the confirm wording rather than in
 * a warning: RP-1 short-circuits a cancelled course's reward block, and a
 * student who leaves early has no course to be rewarded by.</para>
 *
 * <para>Remove is dark on a course RP-1 seats more than one kerbal on, because
 * taking one out would strand the rest below its minimum, and that is the
 * refusal RP-1 expresses by not drawing the button at all.</para>
 */
export function CourseControls({
  course,
  cancel,
  remove,
}: Readonly<CourseControlsProps>) {
  const students = course.students ?? [];
  const seatMin = magnitudeOf(course.seatMin);
  const stranded =
    seatMin !== null && seatMin > 1
      ? `This course seats ${seatMin} at least, so one student cannot leave it`
      : null;

  return (
    /* No Card of its own: the courses section already carries one around each
       course, and a second would draw a border inside a border. */
    <Cluster gap="sm" justify="start" wrap>
      {/* RP-1 addresses a course by ONE of its students rather than by an id
          (`Rp1TrainingLeaveArgs.crewName` selects the course for cancel), so
          the first student names it and every student comes off. */}
      <CommandButton
        args={{ crewName: students[0] }}
        aria-label="Cancel this course"
        commandLabel="Cancel this course"
        confirmAriaLabel="Confirm cancelling this course"
        confirmLabel={
          students.length > 1
            ? `All ${students.length} off, no credit`
            : "Course ends, no credit"
        }
        disabled={students.length === 0}
        handle={cancel}
        label="Cancel course"
        size="sm"
        title={
          students.length === 0
            ? "RP-1 addresses a course by one of its students and this one has none"
            : undefined
        }
        tone="warn"
      />
      {students.map((student) => (
        <CommandButton
          args={{ crewName: student }}
          /* The visible label once the course strands them: the fuller name is
             the act, and this control cannot perform it. */
          aria-label={
            stranded === null ? `Take ${student} off the course` : undefined
          }
          commandLabel={`Take ${student} off the course`}
          confirmAriaLabel={`Confirm taking ${student} off the course`}
          confirmLabel={`${student} off, no credit`}
          disabled={stranded !== null}
          handle={remove}
          key={student}
          label={`${student} off`}
          size="sm"
          title={stranded ?? undefined}
        />
      ))}
    </Cluster>
  );
}

/**
 * The students on a course, or the fact that RP-1 is holding one with nobody on
 * it.
 *
 * <para>An empty list is a real state rather than a missing read: RP-1 builds a
 * course before it collects students, and the wire says so.</para>
 */
export function Students({
  course,
}: Readonly<{ course: Rp1TrainingCourseEntry }>) {
  const students = course.students ?? [];
  if (students.length === 0) {
    return <ReadoutCaption>No students on it</ReadoutCaption>;
  }
  return <ReadoutCaption>{students.join(", ")}</ReadoutCaption>;
}
