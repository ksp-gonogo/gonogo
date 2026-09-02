import {
  registerAugment,
  useCommand,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Card,
  Inline,
  MissionDate,
  magnitudeOf,
  ReadoutCaption,
  Section,
  SectionTitle,
  Stack,
  Unit,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import type {
  Rp1CrewEntry,
  Rp1TrainingCourseEntry,
} from "../__generated__/contract";
import { current } from "../shared/current";
import { RP1 } from "../uplink";
import "../topics";
import { titleOf } from "./template";
import {
  CourseControls,
  RP1_TRAINING_CANCEL_COMMAND,
  RP1_TRAINING_REMOVE_COMMAND,
  Students,
} from "./training";

/**
 * The courses the career is running, and the two ways off one.
 *
 * <para><b>Why a course list at all.</b> Every one of these facts used to be
 * drawn on the ROSTER ROW of each student, which meant a course two kerbals
 * share was rendered twice: two copies of its name, its progress and its finish
 * date, and two copies of a cancel button that ends the same single course. The
 * roster row's question is "where is this kerbal", and it answers that in one
 * line now; the course's own specifics, and the acts that are about the course
 * rather than about a kerbal, are here.</para>
 *
 * <para>It renders nothing when the career is running no courses, which is most
 * of a career: an empty section titled TRAINING COURSES is a row of chrome
 * saying nothing.</para>
 *
 * <para>The date a course FINISHES is not the date its crew can fly. RP-1
 * grounds each student for 120% of the course's length from the moment it
 * starts, so the students come free later, and that is the date a flight gets
 * planned against. Both are drawn because an operator watching a course and an
 * operator crewing a vehicle are asking different questions of it.</para>
 */
export function TrainingCourses() {
  const available = current(useTelemetry("rp1.available"));
  const courses = current(useTelemetry("rp1.training"));
  const crew = current(useTelemetry("rp1.crew"));

  // Unconditional and above the early returns, for the reason Buildable's are:
  // a hook after one would change count the first frame RP-1 answers.
  const cancel = useCommand(RP1_TRAINING_CANCEL_COMMAND);
  const remove = useCommand(RP1_TRAINING_REMOVE_COMMAND);
  usePanelDelay(cancel);
  usePanelDelay(remove);

  // Invisible without RP-1, rather than a section of dashes on a stock game.
  if (available !== true) {
    return null;
  }

  // A completed course is skipped, the same as the mod side skips it: it is not
  // a course anybody is on, and its students are still listed against it.
  const live = (courses ?? []).filter((course) => course.completed !== true);
  if (live.length === 0) {
    return null;
  }

  return (
    <Section>
      <SectionTitle>TRAINING COURSES</SectionTitle>
      <Stack gap="sm">
        {live.map((course) => (
          <Course
            cancel={cancel}
            course={course}
            crew={crew}
            /* The template id is NOT unique: two live courses can share one,
               which is why `training.tsx` matches a kerbal's course on the
               student list rather than on it. The students are what tell two
               courses off one template apart. */
            key={`${course.id ?? ""}:${(course.students ?? []).join()}`}
            remove={remove}
          />
        ))}
      </Stack>
    </Section>
  );
}

/**
 * One live course: what it is, how far along, who is on it, and the way off.
 *
 * <para>Enrolment and progress are separate facts and both are shown, because an
 * operator who reads enrolment as progress will plan a flight around a crew
 * that is not being trained: RP-1 lets a course sit unstarted indefinitely. An
 * unstarted course therefore says so instead of quoting a completion it is not
 * working toward.</para>
 */
function Course({
  cancel,
  course,
  crew,
  remove,
}: Readonly<{
  cancel: Parameters<typeof CourseControls>[0]["cancel"];
  course: Rp1TrainingCourseEntry;
  crew: Rp1CrewEntry[] | undefined;
  remove: Parameters<typeof CourseControls>[0]["remove"];
}>) {
  const started = course.started === true;
  const fraction = progressOf(course, crew);
  const finishes = magnitudeOf(course.completesAtUt);
  const free = magnitudeOf(course.studentsAvailableAtUt);

  return (
    <Card>
      <Stack gap="xs">
        <Inline gap="xs" wrap>
          <Badge severity={started ? "nominal" : "caution"} size="sm">
            {started ? "TRAINING" : "NOT STARTED"}
          </Badge>
          <ReadoutCaption>
            {titleOf(course)}
            {fraction !== null && started && (
              <>
                {" · "}
                <Unit value={fraction} />
              </>
            )}
            {finishes !== null && (
              <>
                {" · finishes "}
                <MissionDate value={course.completesAtUt} />
              </>
            )}
          </ReadoutCaption>
        </Inline>
        <Students course={course} />
        {free !== null && (
          <ReadoutCaption>
            Crew free <MissionDate value={course.studentsAvailableAtUt} />
          </ReadoutCaption>
        )}
        <CourseControls cancel={cancel} course={course} remove={remove} />
      </Stack>
    </Card>
  );
}

/**
 * How far along the course is, off any student's own crew row.
 *
 * <para>The fraction rides `rp1.crew` per kerbal rather than the course, which
 * is deliberate on the contract: a course with no students has no progress to
 * report. Every student on one course reads the same figure, so the first one
 * carrying it answers for the course.</para>
 */
function progressOf(
  course: Rp1TrainingCourseEntry,
  crew: Rp1CrewEntry[] | undefined,
): Rp1CrewEntry["trainingFractionComplete"] | null {
  for (const student of course.students ?? []) {
    const row = (crew ?? []).find((entry) => entry.name === student);
    if (row && magnitudeOf(row.trainingFractionComplete) !== null) {
      return row.trainingFractionComplete;
    }
  }
  return null;
}

registerAugment({
  id: "rp1-training-courses",
  augments: "astronaut-complex.training",
  channels: ["rp1.available", "rp1.training", "rp1.crew"],
  component: TrainingCourses,
  // Before the way onto a course: an operator reads what is already running
  // before deciding to start another.
  priority: 10,
  owner: RP1,
});
