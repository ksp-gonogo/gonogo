import type { Reading, SlotProps } from "@ksp-gonogo/sitrep-sdk";
import { registerAugment, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Card,
  Inline,
  MissionDate,
  magnitudeOf,
  ReadoutCaption,
  Stack,
} from "@ksp-gonogo/ui-kit";
import type { Rp1CrewEntry } from "../__generated__/contract";
import { RP1 } from "../uplink";
import "../topics";
import { kindOf } from "./template";

/**
 * One kerbal's RP-1 schedule, rendered into the Astronaut Complex row the host
 * already drew for them.
 *
 * <para>An RP-1 career is substantially a personnel-scheduling game and none of
 * it reached an operator. A kerbal has a date their career ends, a date the
 * training that qualifies them for a mission lapses, and a course they may be
 * halfway through, and every one of those decides whether a crew can fly the
 * vehicle currently being integrated. The Astronaut Complex under stock rules
 * has nothing to say about any of them, because stock has none of the
 * concepts.</para>
 *
 * <para><b>Dates only, and no controls.</b> A roster row's question is WHERE
 * this kerbal stands, and it answers that in at most three lines. It used to
 * carry a training picker and two leave buttons as well, which put a full
 * enrolment form on every idle naut and rendered one shared course's cancel
 * button once per student. The way onto a course is `enrolment.tsx`, which can
 * name a whole crew where a row can only ever name one kerbal; the specifics of
 * a running course, and the two ways off it, are `courses.tsx`.</para>
 *
 * <para><b>No tab strip of its own.</b> This renders inside ONE roster row, and
 * the Astronaut Complex builds a tab per crew standing around those rows: the
 * scenes press "Active" to reach them. A second tab strip inside a row would be
 * tabs over one kerbal, under the tabs that already sort the kerbals. What the
 * row does get is a Card, so the RP-1 block reads as one thing rather than as
 * loose lines trailing off the host's own readout.</para>
 *
 * <para>It carries no standing and draws no fatality distinction. Whether a
 * kerbal is RETIRED rather than dead rides the stock roster's own `standing`
 * field through the crewStanding capability, so the host has already put a
 * retiree in their own tab before this renders. That is deliberate: a widget
 * that has never heard of RP-1 must not report a retiree as a fatality, and it
 * could not have been fixed from here.</para>
 */
export function CrewSchedule({
  kerbalName,
}: Readonly<SlotProps<"astronaut-complex.crew">>) {
  const available = current(useTelemetry("rp1.available"));
  const crew = current(useTelemetry("rp1.crew"));
  const program = current(useTelemetry("rp1.crewProgram"));

  // Invisible without RP-1, rather than a row of dashes on a stock game.
  if (available !== true) {
    return null;
  }

  // The slot's props type is the loose record out here: the host widget's
  // `SlotRegistry` declaration lives in a package this Uplink may not import,
  // which is the out-of-repo case the augment model deliberately leaves loose.
  // So the name is narrowed rather than trusted, and an absent one renders
  // nothing instead of matching the first row with a null name.
  const name = typeof kerbalName === "string" ? kerbalName : "";
  if (name === "") {
    return null;
  }
  const row = (crew ?? []).find((c) => c.name === name);
  // A kerbal RP-1 has no record of is not a kerbal with an unknown schedule: it
  // is a kerbal RP-1 is not scheduling, and there is nothing to say about them.
  if (!row) {
    return null;
  }

  const retirement = retirementLine(row, program?.retirementEnabled);
  const training = trainingLine(row);
  const expiry = expiryLine(row, program?.missionTrainingEnabled);
  // A row with no date to state renders no wrapper at all rather than an empty
  // one, which is most rows on most careers.
  if (!retirement && !training && !expiry) {
    return null;
  }

  return (
    /*
      ONE Card for the whole contribution, on the operator's "reaching for the
      Card component more": what a roster row grows here is a block of dates, so
      the boundary belongs around all of them rather than in the middle.
    */
    <Card>
      <Stack gap="xs">
        {retirement}
        {training}
        {expiry}
      </Stack>
    </Card>
  );
}

/**
 * When this career ends, and how far the date can still be pushed.
 *
 * <para>The ceiling is the half that makes the date actionable: a retirement
 * three years out that interesting flights can push to fifteen is a different
 * planning problem from one that cannot move, and RP-1 caps the total extension
 * per kerbal so the two states both exist.</para>
 *
 * <para>Absent when RP-1 holds no date, which is a real state and NOT a
 * retirement due now: RP-1's own getter answers zero there, and the mod side
 * turns that into an absence rather than a date. Also silent when retirement is
 * switched off for the save, because a date nothing will act on is worse than no
 * date at all.</para>
 */
function retirementLine(
  row: Rp1CrewEntry,
  retirementEnabled: boolean | undefined,
) {
  if (retirementEnabled === false) {
    return null;
  }
  const retires = magnitudeOf(row.retiresAtUt);
  if (retires === null) {
    return null;
  }
  const latest = magnitudeOf(row.latestRetiresAtUt);
  const extendable = latest !== null && latest > retires;
  return (
    <ReadoutCaption key="retirement">
      Retires <MissionDate value={row.retiresAtUt} />
      {extendable && (
        <>
          {", extendable to "}
          <MissionDate value={row.latestRetiresAtUt} />
        </>
      )}
    </ReadoutCaption>
  );
}

/**
 * WHICH course this kerbal is on, and nothing else about it.
 *
 * <para>The course's own progress, its finish date, the date its crew comes free
 * and the two ways off it are one row down the panel in `courses.tsx`, on the
 * course itself. Drawn here they were drawn once per student, so a course two
 * kerbals share stated its percentage and its ETA twice on one screen and then a
 * third time in the course list. A roster row's question is which of them is
 * where, and this answers exactly that.</para>
 *
 * <para>Enrolment is still told from progress, because an operator who reads one
 * as the other will plan a flight around a crew nobody is training: RP-1 lets a
 * course sit unstarted indefinitely, and the badge is what says so.</para>
 *
 * <para>The kind is named in full ("Mission training", not "Mission") for the
 * reason `kindOf` gives: RP-1's raw enum beside a date and a seat count reads as
 * a flight rather than as the training for one.</para>
 */
function trainingLine(row: Rp1CrewEntry) {
  const target = row.trainingTarget ?? row.trainingCourse;
  if (!target) {
    return null;
  }
  const started = row.trainingStarted === true;
  const kind = kindOf(row.trainingType);
  return (
    <Inline gap="xs" key="training" wrap>
      <Badge severity={started ? "nominal" : "caution"} size="sm">
        {started ? "TRAINING" : "ENROLLED"}
      </Badge>
      <ReadoutCaption>
        {kind === null ? "" : `${kind}: `}
        {target}
      </ReadoutCaption>
    </Inline>
  );
}

/**
 * The soonest mission training this kerbal is about to lose, and how many more
 * are behind it.
 *
 * <para>The one an operator acts on: mission training lapsing is what turns a
 * qualified crew into an unqualified one while the vehicle is still being
 * integrated, and it happens on a date nothing else on the dashboard shows.</para>
 *
 * <para>The kind is stated rather than left to the target, because only ONE of
 * RP-1's two kinds can lapse at all: a proficiency is a permanent qualification
 * on the part, and mission training expires a set interval after the course
 * completes. "Atlas-D training lapses" left an operator to work out which of the
 * two they were about to lose.</para>
 *
 * <para>Absent entirely on a save with mission training switched off, and that
 * is not tidiness: RP-1 stops CHECKING mission training there, so a lapse date
 * that survived the switch being thrown is a deadline nothing will enforce.
 * <c>CheckCrewForPart</c> returns true without asking, and
 * <c>NautHasTrainingForPart</c> clears its mission branch on the same flag. A
 * date an operator would plan around and the game would never act on is worse
 * than no date.</para>
 */
function expiryLine(
  row: Rp1CrewEntry,
  missionTrainingEnabled: boolean | undefined,
) {
  if (missionTrainingEnabled === false) {
    return null;
  }
  const at = magnitudeOf(row.nextTrainingExpiryUt);
  if (at === null) {
    return null;
  }
  const count = magnitudeOf(row.trainingExpiryCount) ?? 0;
  return (
    <ReadoutCaption key="expiry">
      Mission training
      {row.nextTrainingExpiryTarget
        ? ` for ${row.nextTrainingExpiryTarget}`
        : ""}{" "}
      lapses <MissionDate value={row.nextTrainingExpiryUt} />
      {count > 1 && ` (+${count - 1} more)`}
    </ReadoutCaption>
  );
}

/** The value where one is current; see LaunchComplexStatus for why reckonable counts. */
function current<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

registerAugment({
  id: "rp1-crew-schedule",
  augments: "astronaut-complex.crew",
  component: CrewSchedule,
  owner: RP1,
});
