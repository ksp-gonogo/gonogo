import {
  MissionObjectiveState,
  type MissionStatus,
  type ObjectiveSlotItem,
  type ObjectiveSlotState,
  type ObjectiveSourceContext,
  registerAugment,
  stillTrue,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import { Text, Unit } from "@ksp-gonogo/ui-kit";
import { MAKING_HISTORY } from "../uplink";

const STATES: Record<MissionObjectiveState, ObjectiveSlotState> = {
  [MissionObjectiveState.Pending]: "pending",
  [MissionObjectiveState.Active]: "active",
  [MissionObjectiveState.Reached]: "reached",
  [MissionObjectiveState.Failed]: "failed",
};

/** A withheld or unknown state reads as pending: it is never claimed as reached or failed. */
function slotState(state: MissionObjectiveState | null | undefined) {
  return (state != null && STATES[state]) || "pending";
}

/** The mission's objectives as Objectives widget rows, in the order the mission flows. */
export function missionObjectiveItems(
  mission: MissionStatus | null | undefined,
): ObjectiveSlotItem[] {
  if (!mission?.objectives) return [];
  const source = mission.name || "Mission";
  return mission.objectives.map((o, index) => ({
    id: `mh:${o.id || `${index}:${o.title ?? ""}`}`,
    title: o.title || "Objective",
    ...(o.description ? { description: o.description } : {}),
    state: slotState(o.state),
    source,
  }));
}

/** What the mission is doing: its outcome once it has ended, else its phase, then the score when it awards one. */
function missionStatusWords(mission: MissionStatus): string {
  if (mission.finished) {
    return mission.succeeded ? "Mission complete" : "Mission failed";
  }
  if (mission.started === false) return "Not started";
  return mission.phase ? `Phase: ${mission.phase}` : "";
}

/** The mission's phase, outcome and score as one line, from the fields the objective rows do not carry. */
export function MissionStatusLine({ mission }: { mission: MissionStatus }) {
  const words = missionStatusWords(mission);
  const showScore = mission.scoreEnabled === true && mission.score != null;
  if (!words && !showScore) return null;
  return (
    <Text level="muted" size="sm">
      {words}
      {words && showScore ? " · " : null}
      {showScore && mission.score ? (
        <>
          Score <Unit value={mission.score} />
          {mission.maxScore ? (
            <>
              {" / "}
              <Unit value={mission.maxScore} />
            </>
          ) : null}
        </>
      ) : null}
    </Text>
  );
}

/** The running mission's objectives, fed to the Objectives widget's `objectives.source` slot. */
export function MissionObjectivesSource({ Section }: ObjectiveSourceContext) {
  // A mission changes only on events, so the last frame received is still the mission.
  const mission = stillTrue(useTelemetry("missions.active"), undefined);
  const items = missionObjectiveItems(mission);
  if (items.length === 0) return null;
  return (
    <>
      {mission ? <MissionStatusLine mission={mission} /> : null}
      <Section items={items} />
    </>
  );
}

registerAugment({
  id: "objectives-making-history",
  augments: "objectives.source",
  component: MissionObjectivesSource,
  channels: ["missions.active"],
  // Ahead of the contracts source (priority 20), as the mission was before it was removed.
  priority: 10,
  owner: MAKING_HISTORY,
});
