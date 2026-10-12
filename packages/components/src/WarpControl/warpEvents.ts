import {
  type CommsNextLoss,
  type FleetSilence,
  TransitionType,
  type Value,
  type VesselIdentity,
  type VesselLight,
  type VesselOrbit,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import type { AlarmCreator } from "../shared/AlarmsLauncher";
import type { TimeTrigger } from "../TransferWindow/config";

/** Seconds before the alarm's instant at which the warp steps down, matching the alarm modal's own default. */
export const STEP_DOWN_SECONDS = 10;

/**
 * One event the operator can warp to, with the instant a Topic says it happens.
 *
 * `instant` is null when nothing publishes one: the target is then drawn absent
 * rather than as zero or as a client's own guess, with `absent` saying why when
 * the Topic does. A later target (the next project to finish) is one more entry
 * from {@link warpEventTargets}.
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
  /** Why there is no instant, in the Topic's own terms, or null when it gives no reason. */
  absent: string | null;
}

export interface WarpEventReadings {
  orbit: VesselOrbit | undefined;
  silence: FleetSilence | undefined;
  identity: VesselIdentity | undefined;
  /** The centre's predicted loss of the whole route to the active craft. */
  loss: CommsNextLoss | undefined;
  /** The active craft's predicted sunrise and sunset. */
  light: VesselLight | undefined;
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
    absent: null,
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
    absent: null,
  };
}

const LOSS_ABSENT: Readonly<Record<string, string>> = {
  "out-of-contact": "Out of contact now",
  "no-loss-in-window": "No loss predicted",
  "not-planned": "No contact plan",
  "no-craft": "No active craft",
};

/** The next moment the whole route between the active craft and this centre is predicted to close, relays included. */
function lossTarget({ loss, viewUt }: WarpEventReadings): WarpEventTarget {
  const ut = finiteUt(loss?.ut);
  const ahead = ut !== null && viewUt !== undefined && ut > viewUt;
  return {
    id: "loss",
    label: "Signal lost",
    alarmName: "Signal lost",
    instant: ahead ? ut : null,
    detail: loss?.lowConfidence === true ? "Rough prediction" : null,
    absent: ahead
      ? null
      : loss?.basis === "no-loss-in-window" && viewUt !== undefined
        ? `No loss in the next ${writeQuantity(value("s", Math.max(0, loss.coveredToUt.valueOf() - viewUt)))}`
        : (LOSS_ABSENT[loss?.basis ?? ""] ?? null),
  };
}

/** The craft's next sunrise or sunset, from the line to the star the mod swept ahead. */
function lightTarget(
  { light, viewUt }: WarpEventReadings,
  change: "sunrise" | "sunset",
): WarpEventTarget {
  const rising = change === "sunrise";
  const ut = finiteUt(rising ? light?.nextSunriseUt : light?.nextSunsetUt);
  const ahead = ut !== null && viewUt !== undefined && ut > viewUt;
  return {
    id: change,
    label: rising ? "Sunrise" : "Sunset",
    alarmName: rising ? "Sunrise" : "Sunset",
    instant: ahead ? ut : null,
    // A sunrise asked for while lit is the one after the coming night.
    detail:
      ahead && rising && light?.sunlit === true
        ? "After the next sunset"
        : null,
    absent: ahead
      ? null
      : light === undefined
        ? null
        : light.basis === "withheld" || viewUt === undefined
          ? "No prediction"
          : `No ${change} in the next ${writeQuantity(value("s", Math.max(0, light.sweptToUt.valueOf() - viewUt)))}`,
  };
}

/** Every event target, each with the instant its own Topic publishes or null. */
export function warpEventTargets(
  readings: WarpEventReadings,
): readonly WarpEventTarget[] {
  return [
    contactTarget(readings),
    soiTarget(readings),
    lossTarget(readings),
    lightTarget(readings, "sunrise"),
    lightTarget(readings, "sunset"),
  ];
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
