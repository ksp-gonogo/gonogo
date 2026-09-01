import {
  isOffTheBooks,
  useCommand,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Button,
  Card,
  Cluster,
  CommandButton,
  magnitudeOf,
  ReadoutCaption,
  Select,
  Stack,
  Unit,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import { type ReactNode, useState } from "react";
import type {
  Rp1TrainingCourseEntry,
  Rp1TrainingTemplateEntry,
} from "../__generated__/contract";
import { current } from "../shared/current";
// Side-effect import: hydrates these Topics' units at decode time, so a base
// time decodes as a duration rather than a bare number of seconds.
import "../topics";

/** Must match `Rp1TrainingCommands.EnrolCommand`. */
export const RP1_TRAINING_ENROL_COMMAND = "rp1.training.enrol";

/** Must match `Rp1TrainingCommands.CancelCommand`. */
export const RP1_TRAINING_CANCEL_COMMAND = "rp1.training.cancel";

/** Must match `Rp1TrainingCommands.RemoveCommand`. */
export const RP1_TRAINING_REMOVE_COMMAND = "rp1.training.remove";

export interface TrainingControlsProps {
  /** The kerbal this row is about, and the name every one of the three commands keys on. */
  kerbalName: string;
  /** `CrewStanding`, as the host's slot passes it, or null when it sent none. */
  standing: number | null;
  /** Whether this row is a hireable candidate rather than owned crew. */
  isApplicant: boolean;
  /** Whether `rp1.crew` holds a course for this kerbal. */
  onCourse: boolean;
}

/**
 * The three training commands, drawn on the naut they are about.
 *
 * <para>A kerbal is on at most one course, so a row is in one of two states and
 * shows the controls for the one it is in: a way onto a course, or RP-1's two
 * distinct ways off one. Nothing is drawn for a state that is not the row's,
 * because a dark Enrol on a kerbal who is already training says nothing an
 * operator can act on.</para>
 *
 * <para>Enrolling is ONE press rather than two, which is RP-1's own shape:
 * there is no enrolled-but-unstarted course to add anybody to, so the command
 * names a training and a crew together and starts it.</para>
 *
 * <para>Silent for an applicant and for anyone off the books. RP-1 refuses a
 * kerbal who is not yet crew, and a retired or dead one is not somebody a
 * course can be started for; the standing rides down the slot precisely so an
 * augment can tell without joining the roster again.</para>
 */
export function TrainingControls({
  kerbalName,
  standing,
  isApplicant,
  onCourse,
}: Readonly<TrainingControlsProps>) {
  const catalogue = current(useTelemetry("rp1.trainingCatalogue"));
  const courses = current(useTelemetry("rp1.training"));

  // Unconditional and above the early returns, for the reason Buildable's are:
  // a hook after one would change count the first frame RP-1 answers.
  const enrol = useCommand(RP1_TRAINING_ENROL_COMMAND);
  const cancel = useCommand(RP1_TRAINING_CANCEL_COMMAND);
  const remove = useCommand(RP1_TRAINING_REMOVE_COMMAND);
  usePanelDelay(enrol);
  usePanelDelay(cancel);
  usePanelDelay(remove);

  if (isApplicant || isOffTheBooks(standing)) {
    return null;
  }

  const course = courseOf(courses, kerbalName);
  if (course !== undefined || onCourse) {
    return (
      <LeaveControls
        cancel={cancel}
        course={course}
        kerbalName={kerbalName}
        remove={remove}
      />
    );
  }
  return (
    <EnrolControl
      catalogue={catalogue}
      handle={enrol}
      kerbalName={kerbalName}
    />
  );
}

/**
 * Start a training, by naming one.
 *
 * <para>The picker carries the trainings the career has UNLOCKED and no others.
 * Deliberately stricter than the pressable-until-refused rule the build
 * controls follow: `rp1.training.enrol` does not ask whether a training is
 * unlocked, because RP-1's own screen answers that by not listing it, so an
 * offered locked training would start a course on hardware the career has not
 * researched rather than being refused.</para>
 */
function EnrolControl({
  catalogue,
  handle,
  kerbalName,
}: Readonly<{
  catalogue: Rp1TrainingTemplateEntry[] | undefined;
  handle: Parameters<typeof CommandButton>[0]["handle"];
  kerbalName: string;
}>) {
  const [picked, setPicked] = useState<string | null>(null);

  if (catalogue === undefined) {
    return <ReadoutCaption>Training catalogue unread</ReadoutCaption>;
  }
  const offered = catalogue.filter(
    (template) => template.unlocked === true && template.id,
  );
  if (offered.length === 0) {
    return null;
  }

  const selected =
    offered.find((template) => template.id === picked) ?? offered[0];
  const name = titleOf(selected);
  const refusal = seatRefusal(selected);

  return (
    <Card>
      <Stack gap="xs">
        <Cluster gap="sm" justify="start" wrap>
          <Select
            aria-label={`Training for ${kerbalName}`}
            onChange={(e) => setPicked(e.target.value)}
            value={selected.id ?? ""}
          >
            {offered.map((template) => (
              <option key={template.id} value={template.id ?? ""}>
                {titleOf(template)}
              </option>
            ))}
          </Select>
          {refusal === null ? (
            <CommandButton
              args={{ crew: [kerbalName], templateId: selected.id }}
              aria-label={`Enrol ${kerbalName} on ${name}`}
              commandLabel={`Enrol ${kerbalName} on ${name}`}
              confirmAriaLabel={`Confirm enrolling ${kerbalName} on ${name}`}
              confirmLabel={`Enrol on ${name}`}
              handle={handle}
              label="Enrol"
              size="sm"
            />
          ) : (
            <Button disabled title={refusal}>
              Enrol
            </Button>
          )}
        </Cluster>
        <ReadoutCaption>
          {selected.type ? `${selected.type} · ` : ""}
          <Unit value={selected.baseTime} />
          <Seats template={selected} />
        </ReadoutCaption>
      </Stack>
    </Card>
  );
}

/**
 * RP-1's two ways off a course, both addressed by kerbal.
 *
 * <para>They are different acts and the labels are what says so: cancelling
 * ends the course and takes every student on it off, removing takes this one
 * student off and leaves it running for the rest. Neither grants anything,
 * which is on the confirm wording rather than in a warning: RP-1 short-circuits
 * a cancelled course's reward block, and a student who leaves early has no
 * course to be rewarded by.</para>
 *
 * <para>Remove is dark on a course RP-1 seats more than one kerbal on, because
 * taking one out would strand the rest below its minimum, and that is the
 * refusal RP-1 expresses by not drawing the button at all. It stays pressable
 * while the course listing has not arrived, which is the same call the build
 * controls make about an unanswerable condition: the command asks RP-1 itself
 * and refuses in its own words.</para>
 */
function LeaveControls({
  cancel,
  course,
  kerbalName,
  remove,
}: Readonly<{
  cancel: Parameters<typeof CommandButton>[0]["handle"];
  course: Rp1TrainingCourseEntry | undefined;
  kerbalName: string;
  remove: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  const students = course?.students ?? [];
  const others = students.filter((student) => student !== kerbalName);
  const seatMin = magnitudeOf(course?.seatMin);
  const stranded =
    seatMin !== null && seatMin > 1
      ? `This course seats ${seatMin} at least, so one student cannot leave it`
      : null;

  return (
    <Card>
      <Stack gap="xs">
        {others.length > 0 && (
          <ReadoutCaption>Also on it: {others.join(", ")}</ReadoutCaption>
        )}
        <Cluster gap="sm" justify="start" wrap>
          <CommandButton
            args={{ crewName: kerbalName }}
            aria-label={`Cancel the course ${kerbalName} is on`}
            commandLabel={`Cancel the course ${kerbalName} is on`}
            confirmAriaLabel={`Confirm cancelling the course ${kerbalName} is on`}
            confirmLabel={
              students.length > 1
                ? `All ${students.length} off, no credit`
                : "Course ends, no credit"
            }
            handle={cancel}
            label={
              students.length > 1
                ? `Cancel course, ${students.length} off`
                : "Cancel course"
            }
            size="sm"
            tone="warn"
          />
          {stranded === null ? (
            <CommandButton
              args={{ crewName: kerbalName }}
              aria-label={`Take ${kerbalName} off the course`}
              commandLabel={`Take ${kerbalName} off the course`}
              confirmAriaLabel={`Confirm taking ${kerbalName} off the course`}
              confirmLabel={`${kerbalName} off, no credit`}
              handle={remove}
              label={`Take ${kerbalName} off`}
              size="sm"
            />
          ) : (
            <Button disabled title={stranded}>
              Take {kerbalName} off
            </Button>
          )}
        </Cluster>
      </Stack>
    </Card>
  );
}

/**
 * The seat bounds, which are what decides whether this row can start the
 * training at all. Absent when RP-1 sent no minimum, rather than assumed: the
 * refusal below reads the same field and would then be guessing too.
 */
function Seats({
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

/**
 * Why this row cannot start this training, or null.
 *
 * <para>The one refusal a naut's row can state on its own, and it exists
 * because the command names a CREW where the row names a kerbal: enrolling is
 * all-or-none, so a training RP-1 will not run below two students cannot be
 * started from a control that can only name one. Starting it takes a crew, and
 * a crew is not what a row addresses.</para>
 */
function seatRefusal(template: Rp1TrainingTemplateEntry): string | null {
  const min = magnitudeOf(template.seatMin);
  if (min === null || min <= 1) {
    return null;
  }
  return `${titleOf(template)} needs ${min} students and a naut's row enrols one`;
}

/** RP-1's own name for a training, or the parts of one it did send. */
function titleOf(template: Rp1TrainingTemplateEntry): string {
  return template.name ?? template.target ?? template.id ?? "";
}

/**
 * The live course this kerbal is a student on.
 *
 * <para>Matched on the student list rather than on `rp1.crew`'s
 * `trainingCourse`, which carries the TEMPLATE's id: two live courses can share
 * one, and the seat bounds this reads decide which control is drawn.</para>
 *
 * <para>A completed course is skipped, the same as the mod side skips it: a
 * kerbal whose course has finished is not on a course, and its students are
 * still listed on it.</para>
 */
function courseOf(
  courses: Rp1TrainingCourseEntry[] | undefined,
  kerbalName: string,
): Rp1TrainingCourseEntry | undefined {
  return (courses ?? []).find(
    (course) =>
      course.completed !== true && (course.students ?? []).includes(kerbalName),
  );
}
