import type { Reading, SlotProps } from "@ksp-gonogo/sitrep-sdk";
import {
  isOffTheBooks,
  registerAugment,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Inline,
  MissionDate,
  magnitudeOf,
  ReadoutCaption,
  Stack,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { Rp1CrewEntry } from "../__generated__/contract";
import { RP1 } from "../uplink";
import "../topics";
import { TrainingControls } from "./training";

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
 * <para>The dates are read alongside the controls that change them, because
 * they are the same decision: a course finishing after a kerbal's retirement,
 * or after the mission training it is meant to support has lapsed, is a course
 * an operator wants off the roster. See `training.tsx` for the three
 * commands.</para>
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
  standing,
  isApplicant,
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
  const expiry = expiryLine(row);
  // The same two facts the controls read to decide they have nothing to draw,
  // asked here so a row with neither dates nor a control renders no wrapper at
  // all rather than an empty one. The narrowing is the slot's loose props
  // again: an unread standing is not a standing that bars anybody.
  const schedulable =
    isApplicant !== true &&
    !isOffTheBooks(typeof standing === "number" ? standing : null);
  if (!retirement && !training && !expiry && !schedulable) {
    return null;
  }

  return (
    <Stack gap="xs">
      {retirement}
      {training}
      {expiry}
      <TrainingControls
        isApplicant={isApplicant === true}
        kerbalName={name}
        onCourse={Boolean(row.trainingTarget ?? row.trainingCourse)}
        standing={typeof standing === "number" ? standing : null}
      />
    </Stack>
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
 * The course this kerbal is on, and when it finishes.
 *
 * <para>Enrolment and progress are separate facts and both are shown, because
 * an operator who reads enrolment as progress will plan a mission around a crew
 * that is not being trained: RP-1 lets a course sit unstarted indefinitely. An
 * unstarted course therefore says so instead of quoting a completion it is not
 * working toward.</para>
 *
 * <para>The finish date is absent while RP-1 has not rated the course's build
 * rate, which is the state a freshly queued course sits in. That absence is
 * carried rather than filled: RP-1's own helper divides by the unrated rate and
 * produces an infinity, and an infinity is not a date.</para>
 */
function trainingLine(row: Rp1CrewEntry) {
  const target = row.trainingTarget ?? row.trainingCourse;
  if (!target) {
    return null;
  }
  const started = row.trainingStarted === true;
  const finishes = magnitudeOf(row.trainingFinishesAtUt);
  const fraction = magnitudeOf(row.trainingFractionComplete);
  return (
    <Inline gap="xs" key="training">
      <Badge severity={started ? "nominal" : "caution"} size="sm">
        {started ? "TRAINING" : "ENROLLED"}
      </Badge>
      <ReadoutCaption>
        {row.trainingType ? `${row.trainingType}: ` : ""}
        {target}
        {fraction !== null && (
          <>
            {" · "}
            <Unit value={row.trainingFractionComplete} />
          </>
        )}
        {finishes !== null && (
          <>
            {" · finishes "}
            <MissionDate value={row.trainingFinishesAtUt} />
          </>
        )}
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
 */
function expiryLine(row: Rp1CrewEntry) {
  const at = magnitudeOf(row.nextTrainingExpiryUt);
  if (at === null) {
    return null;
  }
  const count = magnitudeOf(row.trainingExpiryCount) ?? 0;
  return (
    <ReadoutCaption key="expiry">
      {row.nextTrainingExpiryTarget ?? "Mission"} training lapses{" "}
      <MissionDate value={row.nextTrainingExpiryUt} />
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
