import { type Tone, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY, writeQuantity } from "@ksp-gonogo/ui-kit";
import type { IntentTrigger, PlanStep } from "./plan";
import type { IntentStatus, PlanState, StepStatus } from "./scoring";
import { stepKind } from "./stepKinds";

/** Δv, headings and percentages read in whole units; lengths keep the kit's precision. */
const WHOLE = { decimals: 0 } as const;

/** A figure, or the null display when there is none. */
export const wholeFigure = (v: Value<string> | undefined): string =>
  v === undefined ? NULL_DISPLAY : writeQuantity(v, WHOLE);

/** A Δv margin, signed so a surplus reads as one. */
export function signed(v: Value<"m/s"> | undefined): string {
  if (v === undefined) return NULL_DISPLAY;
  return v.isPositive()
    ? `+${writeQuantity(v, WHOLE)}`
    : writeQuantity(v, WHOLE);
}

/** A time since lift-off, as the launch clock shows it. */
export const missionClock = (t: Value<"s">): string => `T+${writeQuantity(t)}`;

export function stepName(step: PlanStep): string {
  return stepKind(step.kind)?.name ?? step.kind;
}

/** The step's own target, drawn beside its name. */
export function stepTarget(step: PlanStep): string | undefined {
  const v = (k: string) => step.inputs[k];
  switch (step.kind) {
    case "launch":
      return typeof v("heading") === "number"
        ? writeQuantity(value("°", v("heading") as number), WHOLE)
        : undefined;
    case "reach-orbit":
      return typeof v("periapsis") === "number"
        ? writeQuantity(value("m", v("periapsis") as number))
        : undefined;
    case "transfer":
      return typeof v("to") === "string" ? (v("to") as string) : undefined;
    case "land":
      return typeof v("on") === "string" ? (v("on") as string) : undefined;
    default:
      return undefined;
  }
}

export function triggerText(t: IntentTrigger): string {
  if (t.kind === "time") return missionClock(value("s", t.at));
  return `${t.op === ">=" ? "≥" : "≤"} ${writeQuantity(value("m", t.value))}`;
}

/** A prediction's count of the runs that met a step, such as "9 of 9". */
const count = (runs: { met: number; of: number } | undefined) =>
  runs ? `${runs.met} of ${runs.of}` : undefined;

/**
 * A step's state as a badge word, with the figure that goes beside it: when a
 * done step finished, or how far short a step is. The figure stays out of the
 * badge so its unit keeps its case.
 */
export function stepBadge(
  status: StepStatus,
  /** A prediction's count of the runs that met the step, drawn beside the state. */
  runs?: { met: number; of: number },
): { label: string; tone: Tone; figure?: string } | undefined {
  switch (status.kind) {
    case "done":
      return {
        label: "Done",
        tone: "neutral",
        figure: missionClock(status.at),
      };
    case "met":
      return { label: "Met", tone: "go", figure: count(runs) };
    case "marginal":
      return { label: "Marginal", tone: "caution", figure: count(runs) };
    case "short":
      return {
        label: "Short",
        tone: "nogo",
        figure: writeQuantity(status.by.scaled(-1), WHOLE),
      };
    case "likely-to-fail":
      return {
        label: "Likely to fail",
        tone: "nogo",
        figure: `${status.met} of ${status.of}`,
      };
    default:
      return undefined;
  }
}

export function planBadge(state: PlanState): { label: string; tone: Tone } {
  switch (state.kind) {
    case "on-plan":
      return { label: "On plan", tone: "go" };
    case "marginal":
      return { label: "Marginal", tone: "caution" };
    case "off-plan":
      return { label: "Off plan", tone: "caution" };
    case "fails-at":
      return { label: `Fails at step ${state.step}`, tone: "nogo" };
  }
}

/** What an intent's right-hand column shows: when it fired, the live value or the time to go, and whether it is late. */
export function intentResult(
  trigger: IntentTrigger,
  status: IntentStatus,
  live: {
    missionTime?: Value<"s">;
    altitude?: Value<"m">;
    apoapsis?: Value<"m">;
    body?: string;
  },
): { text: string; late: boolean } | undefined {
  if (status.kind === "fired") {
    return { text: missionClock(status.at), late: false };
  }
  const late = status.kind === "overdue";
  if (trigger.kind === "time") {
    if (live.missionTime === undefined) return undefined;
    const to = value("s", trigger.at).minus(live.missionTime);
    return {
      text: to.isNegative()
        ? `+${writeQuantity(to.abs())}`
        : `in ${writeQuantity(to)}`,
      late,
    };
  }
  // A value measured over another body says nothing about this trigger yet.
  if (trigger.body !== undefined && live.body !== trigger.body)
    return undefined;
  const v = trigger.quantity === "altitude" ? live.altitude : live.apoapsis;
  return v === undefined ? undefined : { text: writeQuantity(v), late };
}
