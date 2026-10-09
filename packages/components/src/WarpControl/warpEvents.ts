import {
  type FleetSilence,
  TransitionType,
  type Value,
  type VesselIdentity,
  type VesselOrbit,
} from "@ksp-gonogo/sitrep-sdk";
import type { AlarmCreator } from "../shared/AlarmsLauncher";
import type { TimeTrigger } from "../TransferWindow/config";

/** Seconds before the alarm's instant at which the warp steps down, matching the alarm modal's own default. */
export const STEP_DOWN_SECONDS = 10;

/**
 * One event the operator can warp to, with the instant a Topic says it happens.
 *
 * `instant` is null when nothing publishes one: the target is then drawn absent
 * rather than as zero or as a client's own guess. A later target (the next
 * project to finish) is one more entry from {@link warpEventTargets}.
 */
export interface WarpEventTarget {
  id: string;
  /** What the toggle says. */
  label: string;
  /** The name the armed alarm carries. */
  alarmName: string;
  /** The UT the event is published for, or null while no Topic gives one. */
  instant: number | null;
  /** Which body or craft the instant concerns, when more than a label is worth saying. */
  detail: string | null;
}

export interface WarpEventReadings {
  orbit: VesselOrbit | undefined;
  silence: FleetSilence | undefined;
  identity: VesselIdentity | undefined;
  /** The clock the widget shows, UT seconds. */
  viewUt: number | undefined;
}

function finiteUt(raw: Value<"ut"> | null | undefined): number | null {
  const ut = raw?.valueOf();
  return ut !== undefined && Number.isFinite(ut) ? ut : null;
}

/** The next sphere-of-influence change on the current trajectory, from the patch chain KSP has already solved. */
function soiTarget({ orbit, viewUt }: WarpEventReadings): WarpEventTarget {
  const patches = orbit?.patches ?? [];
  const current = patches[0];
  const crossing =
    current?.patchEndTransition === TransitionType.Encounter ||
    current?.patchEndTransition === TransitionType.Escape;
  const ut = crossing ? finiteUt(current.endUt) : null;
  const ahead = ut !== null && viewUt !== undefined && ut > viewUt;
  const entering = current?.patchEndTransition === TransitionType.Encounter;
  const body = entering ? patches[1]?.referenceBody : current?.referenceBody;
  return {
    id: "soi",
    label: "SOI change",
    alarmName: body
      ? `${entering ? "Enter" : "Leave"} ${body} SOI`
      : "SOI change",
    instant: ahead ? ut : null,
    detail: ahead && body ? `${entering ? "Enter" : "Leave"} ${body}` : null,
  };
}

/** When the active craft's radio path is predicted to re-open, which only exists while it is silent. */
function contactTarget({
  silence,
  identity,
  viewUt,
}: WarpEventReadings): WarpEventTarget {
  const entry = silence?.vessels.find(
    (v) => v.vesselId === identity?.vesselId && v.state === "Silent",
  );
  const ut = finiteUt(entry?.predictedReacquisitionUt);
  const ahead = ut !== null && viewUt !== undefined && ut > viewUt;
  return {
    id: "contact",
    label: "Signal back",
    alarmName: "Signal returns",
    instant: ahead ? ut : null,
    detail: null,
  };
}

/** Every event target, each with the instant its own Topic publishes or null. */
export function warpEventTargets(
  readings: WarpEventReadings,
): readonly WarpEventTarget[] {
  return [contactTarget(readings), soiTarget(readings)];
}

/** Arms the time alarm whose warp-kill the alarm pipeline already runs, and reports whether there was an instant to arm. */
export function armWarpEvent(
  createAlarm: AlarmCreator<TimeTrigger>,
  target: WarpEventTarget,
): boolean {
  if (target.instant === null) return false;
  createAlarm({
    name: target.alarmName,
    trigger: {
      kind: "time",
      ut: target.instant,
      leadSeconds: STEP_DOWN_SECONDS,
    },
  });
  return true;
}
