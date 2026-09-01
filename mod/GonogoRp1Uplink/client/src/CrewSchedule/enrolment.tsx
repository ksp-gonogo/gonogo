import type { CrewRosterEntry } from "@ksp-gonogo/sitrep-sdk";
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
  magnitudeOf,
  ReadoutCaption,
  Section,
  SectionTitle,
  Select,
  Stack,
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
import { Seats, titleOf } from "./template";
import { RP1_TRAINING_ENROL_COMMAND } from "./training";

/**
 * A training and the crew to put through it, picked together and sent as one
 * press.
 *
 * <para><b>What was missing.</b> `rp1.training.enrol` names a LIST of kerbals
 * and RP-1 refuses the whole command rather than starting a course a seat short,
 * so a training seating more than one has to be filled in a single dispatch. The
 * only control that sent the command was on a naut's row, which names one
 * kerbal, so every multi-seat training in the catalogue was unstartable from
 * anywhere in the app. Gemini seats two; RP-1's whole mission-training tier for
 * crewed capsules seats more than one.</para>
 *
 * <para><b>Its own section rather than a row on the Crew Programme.</b> The
 * Programme states the career-wide RULES a kerbal's dates are read under and it
 * has something to say on every RP-1 save. This has something to say only when
 * the career has unlocked a training and holds crew who could take it, and it
 * renders nothing otherwise. Folding them together would make one of those two
 * visibility rules lose.</para>
 *
 * <para><b>ONE press, and that is RP-1's own shape rather than a
 * simplification.</b> RP-1 builds a course from a template, collects its
 * students and only puts it on the roster once it has started, so there is no
 * enrolled-but-unstarted course to add anybody to and nothing to compose across
 * two presses.</para>
 *
 * <para><b>Nothing here spends funds.</b> The catalogue carries no cost, and
 * RP-1's own enrolment path charges nothing: it starts the course and tells the
 * maintenance handler its upkeep figure is stale. So no funds readout, which the
 * repo would otherwise require of a control that spends career funds.</para>
 */
export function TrainingEnrolment() {
  const available = current(useTelemetry("rp1.available"));
  const catalogue = current(useTelemetry("rp1.trainingCatalogue"));
  const roster = current(useTelemetry("spaceCenter.crewRoster"));
  const crew = current(useTelemetry("rp1.crew"));
  const courses = current(useTelemetry("rp1.training"));

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
  // unreadable state is otherwise worth. Neither absence is unsaid: the crew
  // roster is the HOST's channel and the Astronaut Complex says so above this,
  // and an unread catalogue is stated on every naut's row by the per-row
  // control. That coverage holds rather than nearly holding, because the rows
  // that would go quiet are the ones whose kerbal is already on a course, and a
  // career whose every naut is on one leaves this section nobody to offer
  // anyway.
  if (catalogue === undefined) {
    return null;
  }

  /* The trainings the career has UNLOCKED and no others, the same rule the
     per-row control follows and for the same reason: `rp1.training.enrol` does
     not ask whether a training is unlocked, because RP-1's own screen answers
     that by not listing it. */
  const offered = catalogue.filter(
    (template) => template.unlocked === true && template.id,
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
        <Stack gap="xs">
          <Cluster gap="sm" justify="start" wrap>
            <Select
              aria-label="Training to start"
              onChange={(e) => setPickedTemplate(e.target.value)}
              value={selected.id ?? ""}
            >
              {offered.map((template) => (
                <option key={template.id} value={template.id ?? ""}>
                  {titleOf(template)}
                </option>
              ))}
            </Select>
            <CommandButton
              args={{
                crew: chosen.map((candidate) => candidate.name),
                templateId: selected.id,
              }}
              /* Named by the student count while it can act, and the bare
                 visible label once it cannot: a refused control announcing an
                 enrolment describes something that will not happen. The reason
                 rides `title`. */
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
          <ReadoutCaption>
            {selected.type ? `${selected.type} · ` : ""}
            <Unit value={selected.baseTime} />
            <Seats template={selected} />
          </ReadoutCaption>
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
      </Card>
    </Section>
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
  augments: "astronaut-complex.sections",
  channels: [
    "rp1.available",
    "rp1.trainingCatalogue",
    "rp1.crew",
    "rp1.training",
    /* The roster the command itself keys on. Named here rather than taken from
       the host, so this section carries its own reads the way ProgramDetail
       names `career.status`. */
    "spaceCenter.crewRoster",
  ],
  component: TrainingEnrolment,
  // After the Crew Programme's rules. An operator opens the Astronaut Complex to
  // read where their crew stands; starting a course is what they do once they
  // have, which is the order Buildable takes below the build queue.
  priority: 20,
  owner: RP1,
});
