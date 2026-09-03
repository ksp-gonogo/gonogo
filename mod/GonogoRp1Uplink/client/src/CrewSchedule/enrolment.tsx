import type { CareerStatus, CrewRosterEntry } from "@ksp-gonogo/sitrep-sdk";
import {
  CrewStanding,
  isOffTheBooks,
  registerAugment,
  useCommand,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Card,
  Cluster,
  CommandButton,
  DataLine,
  magnitudeOf,
  ReadoutCaption,
  Section,
  SectionTitle,
  SelectableRow,
  Stack,
  Text,
  ToggleButton,
  Unit,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import type {
  Rp1CrewEntry,
  Rp1TrainingCourseEntry,
  Rp1TrainingTemplateEntry,
} from "../__generated__/contract";
import { current } from "../shared/current";
import { RP1 } from "../uplink";
// Side-effect import: hydrates these Topics' units at decode time, so a base
// time decodes as a duration rather than a bare number of seconds.
import "../topics";
import { lapseRule, Seats, titleOf } from "./template";
import { RP1_TRAINING_ENROL_COMMAND } from "./training";

/**
 * A training and the crew to put through it, picked together and sent as one
 * press.
 *
 * <para><b>The ONLY way onto a course, and the only one that ever worked for a
 * multi-seat training.</b> `rp1.training.enrol` names a LIST of kerbals and RP-1
 * refuses the whole command rather than starting a course a seat short, so a
 * training seating more than one has to be filled in a single dispatch. A naut's
 * roster row names one kerbal, so the picker that used to sit on every row could
 * not start Gemini at all, and RP-1's whole mission-training tier for crewed
 * capsules seats more than one. That row control is gone; this is what
 * replaced it.</para>
 *
 * <para><b>ONE press, and that is RP-1's own shape rather than a
 * simplification.</b> RP-1 builds a course from a template, collects its
 * students and only puts it on the roster once it has started, so there is no
 * enrolled-but-unstarted course to add anybody to and nothing to compose across
 * two presses.</para>
 *
 * <para><b>Nothing is charged at the press, and something is charged for as long
 * as the course runs.</b> The first half is why there is no balance here and why
 * "cannot afford" would be a falsehood: `TrainingCourse.StartCourse` charges
 * nothing, checks nothing but its seat counts, and there is no affordability arm
 * anywhere on RP-1's enrolment path. The second half is what this file used to
 * miss. Starting a course puts a line on `MaintenanceHandler.TrainingUpkeepPerDay`
 * that `FixedUpdate` deducts every tick with no balance test at all, so the press
 * commits the career to a per-day drain for the length of the training and a
 * shortfall neither slows it nor refuses it. `TrainingUpkeep` draws that rate; see
 * it for why the rate and not a balance, and why RP-1's own line rather than a
 * marginal figure derived here.</para>
 */
export function TrainingEnrolment() {
  const available = current(useTelemetry("rp1.available"));
  const catalogue = current(useTelemetry("rp1.trainingCatalogue"));
  const roster = current(useTelemetry("spaceCenter.crewRoster"));
  const crew = current(useTelemetry("rp1.crew"));
  const courses = current(useTelemetry("rp1.training"));
  const program = current(useTelemetry("rp1.crewProgram"));
  /* Named here rather than taken from the host, the way ProgramDetail names
     `career.status`: an augment carries its own reads. */
  const career = current(useTelemetry("career.status"));

  const [pickedTemplate, setPickedTemplate] = useState<string | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(NOBODY);

  // Unconditional and above the early returns, for the reason Buildable's is: a
  // hook after one would change count the first frame RP-1 answers.
  const enrol = useCommand(RP1_TRAINING_ENROL_COMMAND);
  usePanelDelay(enrol);

  // Invisible without RP-1, rather than a section of dashes on a stock game.
  if (available !== true) {
    return null;
  }

  // Silent on an unread channel, both of them, rather than the one short line an
  // unreadable state is otherwise worth. A section offering no training is
  // indistinguishable from a career that has unlocked none, and neither is worth
  // a row of chrome on the Astronaut Complex; the crew roster is the HOST's
  // channel and the panel above already says when that has not arrived.
  if (catalogue === undefined) {
    return null;
  }

  /* The trainings the career has UNLOCKED and no others. `rp1.training.enrol`
     does not ask whether a training is unlocked, because RP-1's own screen
     answers that by not listing it, so an offered locked training would start a
     course on hardware the career has not researched rather than be refused.

     Mission training goes with the SETTING as well as with the unlock. RP-1
     generates a mission template only while `IsMissionTrainingEnabled`
     (`CrewHandler.AddPartCourses`), so on a save with the mechanic off the
     catalogue should carry none; the filter holds anyway, because a template
     generated before the switch was thrown would otherwise still be offered and
     would start a course nothing will ever check. */
  const offered = catalogue.filter(
    (template) =>
      template.unlocked === true &&
      template.id &&
      !(
        template.type === "Mission" && program?.missionTrainingEnabled === false
      ),
  );
  const candidates = candidatesOf(roster, crew, courses);
  if (offered.length === 0 || candidates.length === 0) {
    return null;
  }

  const selected =
    offered.find((template) => template.id === pickedTemplate) ?? offered[0];
  const name = titleOf(selected);
  const chosen = candidates.filter((candidate) => picked.has(candidate.name));
  const refusal = enrolRefusal(selected, chosen);

  return (
    <Section>
      <SectionTitle>START A TRAINING</SectionTitle>
      <Card>
        {/* THE ORDER IS THE ANSWER TO "how do you enrol a kerbal?".

            The send control used to share a line with the training picker, above
            both the bounds and the names, so the screen read: pick a training,
            press Enrol, and then meet the kerbals the press was supposed to
            name. Read top to bottom that is a dark button with no way to make it
            live, which is exactly what an operator reported. A training, then
            the crew, then what it costs, then the press: each step sits above
            the one it decides. */}
        <Stack gap="md">
          <Stack gap="xs">
            <ReadoutCaption>Training</ReadoutCaption>
            {/* EVERY offered training on screen at once, one press to pick one,
                which is the gesture RP-1's own Astronaut Complex uses.
                `TrainingGUI.RenderCourseSelector` is a scroll view holding one
                `GUILayout.Button` per `TrainingTemplate`; pressing one opens
                that course with the roster underneath it, the students are
                toggled on and off there, and a single Start Training sends it.
                So RP-1's interaction is course first, then as many students as
                the seats allow, then one press, and the only part of it this
                section did differently was collapsing the catalogue into a
                dropdown.

                That difference is not cosmetic. A `<select>` shows ONE training
                and hides the rest behind an interaction, so the screen cannot
                answer "what can this career train on?" without being opened, and
                the training an operator wants is one they have to remember the
                name of. RP-1's list answers that question and carries the
                control at the same time.

                A list rather than the chips the students use, because a training
                is named in full ("Mission training: Gemini") where a kerbal is
                one short name: chipped, the titles wrap mid-name and the row
                stops being scannable. `SelectableRow` is the kit's pick-one list
                row and sets `aria-pressed` from `selected` itself. */}
            <Stack aria-label="Training to start" gap="xs" role="group">
              {offered.map((template) => (
                <SelectableRow
                  key={template.id}
                  onClick={() => setPickedTemplate(template.id ?? null)}
                  selected={template.id === selected.id}
                >
                  {titleOf(template)}
                </SelectableRow>
              ))}
            </Stack>
            {/* The CONSEQUENCE of the pick rather than the kind word, which
                `titleOf` has already put at the front of every row above.
                Stating the kind twice said "Mission" twice on one line; the
                lapse rule is what an operator choosing between the two trainings
                on one part is actually deciding between.

                "at standard rate" is not a hedge, it is what the number IS.
                `baseTime` is RP-1's `template.time`, and the elapsed time a save
                actually sees is that divided by
                `TrainingCourse.CalculateBuildRate`, three factors of which only
                one could ever reach a client: the Astronaut Complex tier (1 to
                1.4 in CrewSettings.cfg), the training rate slider, and
                `CurrencyUtils.Rate(RateTraining)`, which three shipped Flight
                Director leaders modify. That last one cannot be READ at all,
                only run, because its body fires a modifier query at every
                modifier in the save, which is the fence Rp1CrewMath stands
                behind. So the rate-corrected figure is unavailable here, and the
                base quoted as though it were the duration is the one thing that
                would be a lie. A running course states its real finish date, and
                that one is RP-1's own. */}
            <ReadoutCaption>
              {lapseRule(selected) === null ? "" : `${lapseRule(selected)} · `}
              <Unit value={selected.baseTime} /> at standard rate
              <Seats template={selected} />
            </ReadoutCaption>
          </Stack>
          <Stack gap="xs">
            <ReadoutCaption>Students</ReadoutCaption>
            <Cluster
              aria-label={`Students for ${name}`}
              gap="xs"
              justify="start"
              role="group"
              wrap
            >
              {candidates.map((candidate) => (
                <Student
                  candidate={candidate}
                  key={candidate.name}
                  onToggle={() => setPicked(toggled(picked, candidate.name))}
                  picked={picked.has(candidate.name)}
                />
              ))}
            </Cluster>
          </Stack>
          <Stack gap="xs">
            <TrainingUpkeep career={career} />
            {/* The refusal on SCREEN, not only in `title`. The dark-control-with
                -its-reason-in-the-title pattern assumes a pointer, and the
                picture this section exists for is one where a dark Enrol sat
                under a picker with nothing anywhere saying which arithmetic had
                failed. `title` stays for the pointer; the sentence is here for
                everyone else. */}
            {refusal !== null && (
              <Text size="xs" tone="warn">
                {refusal}
              </Text>
            )}
            <Cluster gap="sm" justify="start" wrap>
              <CommandButton
                args={{
                  crew: chosen.map((candidate) => candidate.name),
                  templateId: selected.id,
                }}
                /* Named by the student count while it can act, and the bare
                   visible label once it cannot: a refused control announcing an
                   enrolment describes something that will not happen. The reason
                   rides `title` and the line above. */
                aria-label={
                  refusal === null
                    ? `Enrol ${students(chosen.length)} on ${name}`
                    : undefined
                }
                commandLabel={`Enrol ${students(chosen.length)} on ${name}`}
                confirmAriaLabel={`Confirm enrolling ${students(chosen.length)} on ${name}`}
                confirmLabel={`Enrol ${students(chosen.length)} on ${name}`}
                disabled={refusal !== null}
                handle={enrol}
                label="Enrol"
                size="sm"
                title={refusal ?? undefined}
              />
            </Cluster>
          </Stack>
        </Stack>
      </Card>
    </Section>
  );
}

/**
 * What crew training draws from the career, per day, beside the control that
 * adds to it.
 *
 * <para><b>A RATE, and never a balance.</b> Verified against the shipped RP-1
 * assemblies: <c>TrainingCourse.StartCourse</c> charges nothing and checks
 * nothing, and there is no affordability arm anywhere on the enrolment path, so
 * "cannot afford this training" would be a falsehood. What enrolling does is
 * start a per-day drain that runs for the length of the course:
 * <c>MaintenanceHandler.UpdateUpkeep</c> adds a line per STARTED course and
 * <c>FixedUpdate</c> deducts it every tick with no balance test at all. A
 * shortfall neither slows the training nor refuses it; it takes the career
 * negative. So the honest reading is the rate the career already pays, which is
 * the figure this press moves.</para>
 *
 * <para>RP-1's own line rather than one derived here. The marginal cost of one
 * more student is <c>nautTrainingCostPerFacLevel[ACLevel]</c> plus an adder that
 * depends on what the target covers, and computing that client-side would mean
 * mirroring an expression that mutates RP-1's own shared settings bools on the
 * way through. The standing line is exact and costs nothing.</para>
 *
 * <para>Absent, never zero, when the career reports no economy: a money model
 * with no upkeep concept does not levy nothing, it levies nothing KNOWN, and a
 * zero would be a claim about the first.</para>
 */
function TrainingUpkeep({
  career,
}: Readonly<{ career: CareerStatus | undefined }>) {
  const training = career?.economy?.upkeep?.training;
  if (magnitudeOf(training) === null) {
    return null;
  }
  return (
    <DataLine aligned label="Upkeep">
      <Unit value={training} />
    </DataLine>
  );
}

/**
 * One kerbal, on or off the crew being assembled.
 *
 * <para>The name, no trait or rank: the Astronaut Complex's own Active tab
 * carries both for every kerbal a few inches above this, and nothing RP-1 checks
 * when it takes a student reads either.</para>
 *
 * <para><b>A refused kerbal wears their reason, and that is not decoration.</b>
 * The dark-control-with-its-reason-in-the-title pattern relies on a live peer to
 * be dark AGAINST: a build refusal reads as dark because "Build at LC-2" sits
 * beside it lit. Here every peer is a kerbal's name in the same chip, so dimming
 * alone leaves "cannot be picked" and "not picked yet" looking the same, and the
 * one picture this section exists for is the one where that distinction is the
 * whole reading. Two words on the label carry it; the full sentence stays in the
 * title.</para>
 *
 * <para><b>A refused kerbal who is PICKED stays pressable</b>, which is where
 * this does depart from the pattern. Their state can change under a standing
 * pick: a kerbal picked while idle and then grounded elsewhere would otherwise
 * be locked into a crew that cannot be sent and could not be taken back
 * out.</para>
 */
function Student({
  candidate,
  onToggle,
  picked,
}: Readonly<{
  candidate: Candidate;
  onToggle: () => void;
  picked: boolean;
}>) {
  return (
    <ToggleButton
      active={picked}
      disabled={candidate.refusal !== null && !picked}
      onClick={onToggle}
      size="sm"
      title={candidate.refusal?.sentence}
      tone={candidate.refusal === null ? "neutral" : "nogo"}
    >
      {candidate.name}
      {candidate.refusal !== null && ` · ${candidate.refusal.tag}`}
    </ToggleButton>
  );
}

/** A kerbal this section can offer, and why RP-1 would turn them down. */
interface Candidate {
  name: string;
  /** Why this kerbal cannot be a student, or null. */
  refusal: Refusal | null;
}

/** One reason, said twice: at the length a control's label has room for, and whole. */
interface Refusal {
  /** Two or three words, for the label of the control that carries the refusal. */
  tag: string;
  /** The whole sentence, naming the kerbal, for the title and the send control. */
  sentence: string;
}

/**
 * Everybody a course could be started for, refusals stated, pickable first.
 *
 * <para>Driven off `spaceCenter.crewRoster` because that is the roster the
 * command itself keys on: RP-1 looks each named kerbal up on KSP's own roster,
 * not on its scheduling table. `rp1.crew` and `rp1.training` come in for the
 * one refusal the standing might not carry.</para>
 *
 * <para>An applicant and anyone off the books are dropped rather than refused.
 * They are not candidates whose turn has not come; a retiree is not somebody a
 * course can be started for at all, and the host already sorts both into their
 * own tabs.</para>
 *
 * <para>Pickable first, refused after, stable within each group so the roster's
 * own order survives. A reading order rather than a sort: the names an operator
 * can act on are the ones they are looking for.</para>
 */
function candidatesOf(
  roster: CrewRosterEntry[] | undefined,
  crew: Rp1CrewEntry[] | undefined,
  courses: Rp1TrainingCourseEntry[] | undefined,
): Candidate[] {
  const training = trainingNames(crew, courses);
  const candidates: Candidate[] = [];
  for (const row of roster ?? []) {
    const name = row.name;
    if (!name || row.isApplicant === true || isOffTheBooks(row.standing)) {
      continue;
    }
    candidates.push({ name, refusal: studentRefusal(row, training) });
  }
  return [
    ...candidates.filter((candidate) => candidate.refusal === null),
    ...candidates.filter((candidate) => candidate.refusal !== null),
  ];
}

/**
 * Why RP-1 would refuse this kerbal as a student, or null.
 *
 * <para>The three conditions a client can establish, in RP-1's own terms:
 * `MeetsStudentReqs` turns down a kerbal who is already training, grounded, or
 * off-world. It also turns down one missing the training's own prerequisite, and
 * the Astronaut Complex tier gates the course itself; NEITHER is on the wire, so
 * both leave the control pressable and let the command refuse in RP-1's own
 * words. That is the same call the build controls make about a condition nobody
 * could evaluate here.</para>
 *
 * <para>A standing this build cannot read bars nobody. It falls through to the
 * course listing, which answers the one condition that matters most and answers
 * it from RP-1's own channels rather than from the derived standing.</para>
 */
function studentRefusal(
  row: CrewRosterEntry,
  training: ReadonlySet<string>,
): Refusal | null {
  const name = row.name ?? "";
  if (training.has(name) || row.standing === CrewStanding.Training) {
    return {
      sentence: `${name} is already on a training course`,
      tag: "in training",
    };
  }
  if (row.standing === CrewStanding.Resting) {
    return {
      sentence: `${name} is standing down after a flight`,
      tag: "resting",
    };
  }
  if (row.standing === CrewStanding.Assigned) {
    return { sentence: `${name} is off-world`, tag: "off-world" };
  }
  return null;
}

/**
 * Everyone RP-1 currently has in training, from both channels that say so.
 *
 * <para>Two sources because they answer at different moments. `rp1.training`
 * carries the live courses and their student lists, which is the authority; a
 * completed course is skipped, the same as the mod side skips it. `rp1.crew`
 * carries the per-kerbal course and is read alongside it because a kerbal RP-1
 * is scheduling a course for is one this section must not offer, whichever
 * channel arrived first.</para>
 */
function trainingNames(
  crew: Rp1CrewEntry[] | undefined,
  courses: Rp1TrainingCourseEntry[] | undefined,
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const course of courses ?? []) {
    if (course.completed === true) {
      continue;
    }
    for (const student of course.students ?? []) {
      names.add(student);
    }
  }
  for (const row of crew ?? []) {
    if (row.name && (row.trainingTarget ?? row.trainingCourse)) {
      names.add(row.name);
    }
  }
  return names;
}

/**
 * Why this crew cannot be sent on this training, or null.
 *
 * <para>A NAMED kerbal comes first, because that is what all-or-none means: RP-1
 * refuses the whole command by the name of the first student it will not take
 * rather than dropping them and starting a seat short, so the name is the whole
 * of the reason and a generic failure would send an operator looking through the
 * roster for it.</para>
 *
 * <para>Then the seat bounds, which are the refusal the per-row control could
 * only ever state and never clear. An absent minimum refuses nothing: RP-1
 * defaults it to one internally and a client that assumed the same would be
 * guessing at the one number this whole surface exists for.</para>
 */
function enrolRefusal(
  template: Rp1TrainingTemplateEntry,
  chosen: readonly Candidate[],
): string | null {
  const blocked = chosen.filter((candidate) => candidate.refusal !== null);
  if (blocked.length > 0) {
    return `${blocked.map((candidate) => candidate.name).join(", ")} cannot take this training, and RP-1 refuses the whole crew rather than starting a seat short`;
  }

  const name = titleOf(template);
  const min = magnitudeOf(template.seatMin);
  if (chosen.length === 0) {
    return min === null || min <= 1
      ? "Nobody is picked, and RP-1 has no such thing as an empty course"
      : `${name} needs ${min} students and nobody is picked`;
  }
  if (min !== null && chosen.length < min) {
    return `${name} needs ${min} students and ${students(chosen.length)} ${chosen.length === 1 ? "is" : "are"} picked`;
  }
  // A non-positive maximum is RP-1's "no ceiling", the same reading the seat
  // bounds beside the picker take of it.
  const max = magnitudeOf(template.seatMax);
  if (max !== null && max > 0 && chosen.length > max) {
    return `${name} seats ${max} and ${students(chosen.length)} are picked`;
  }
  return null;
}

/** A student count with its noun, since every use of one reads as a sentence. */
function students(count: number): string {
  return count === 1 ? "1 student" : `${count} students`;
}

/** The picked set with one name added or taken out. */
function toggled(
  picked: ReadonlySet<string>,
  name: string,
): ReadonlySet<string> {
  const next = new Set(picked);
  if (!next.delete(name)) {
    next.add(name);
  }
  return next;
}

/** One frozen empty set for the initial pick, rather than a fresh one per mount. */
const NOBODY: ReadonlySet<string> = new Set<string>();

registerAugment({
  id: "rp1-training-enrolment",
  augments: "astronaut-complex.training",
  channels: [
    "rp1.available",
    "rp1.trainingCatalogue",
    "rp1.crew",
    "rp1.crewProgram",
    "rp1.training",
    /* The roster the command itself keys on. Named here rather than taken from
       the host, so this section carries its own reads the way ProgramDetail
       names `career.status`. */
    "spaceCenter.crewRoster",
    /* What training draws from the career per day. RP-1's own upkeep line, read
       for the rate beside the press; see `TrainingUpkeep`. */
    "career.status",
  ],
  component: TrainingEnrolment,
  // After the running courses. An operator opens the tab to read what is
  // already under way; starting another is what they do once they have, which
  // is the order Buildable takes below the build queue.
  priority: 20,
  owner: RP1,
});
