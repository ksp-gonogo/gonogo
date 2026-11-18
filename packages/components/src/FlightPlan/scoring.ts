import { type Value, value } from "@ksp-gonogo/sitrep-sdk";
import type { FlightPlan, PlanIntent, PlanStep } from "./plan";
import { reserveDv } from "./plan";

/** The flight as the plan reads it. Every field is `undefined` when the stream has not given it; none of them defaults to zero. */
export interface PlanLive {
  /** Time since lift-off. */
  missionTime: Value<"s"> | undefined;
  /** Height above the body's datum. */
  altitude: Value<"m"> | undefined;
  apoapsis: Value<"m"> | undefined;
  periapsis: Value<"m"> | undefined;
  /** The name of the body the craft is at. */
  body: string | undefined;
  /** Whether the craft is landed or splashed down. */
  landed: boolean | undefined;
  /** The craft's remaining Δv, from the game's stage simulation, at the air pressure it is in. */
  dvLeft: Value<"m/s"> | undefined;
  /** The craft's remaining Δv in vacuum. Its fall since lift-off is the Δv spent, whatever the air pressure did to `dvLeft`. */
  dvVacuum: Value<"m/s"> | undefined;
  /** Mission time at which each action group first changed state after the plan was applied, by group number. */
  firedAt: ReadonlyMap<number, Value<"s">>;
}

/** What the flight has latched while flying the plan. */
export interface PlanProgress {
  /** Mission time each completed step finished at, by step id. */
  doneAt: ReadonlyMap<string, Value<"s">>;
  /** The craft's vacuum Δv on the pad, before lift-off. `undefined` when the flight was first seen already flying. */
  vacuumDvAtLaunch: Value<"m/s"> | undefined;
}

/** A step's result from a prediction: how many of the runs met it. */
export interface PredictedStep {
  met: number;
  of: number;
}

export type IntentStatus =
  | { kind: "fired"; at: Value<"s"> }
  | { kind: "pending" }
  | { kind: "overdue" };

export type StepStatus =
  | { kind: "done"; at: Value<"s"> }
  | { kind: "current" }
  | { kind: "met" }
  | { kind: "marginal" }
  | { kind: "short"; by: Value<"m/s"> }
  | { kind: "likely-to-fail"; met: number; of: number }
  | { kind: "unscored" };

export interface ScoredStep {
  step: PlanStep;
  status: StepStatus;
  intents: ReadonlyArray<{ intent: PlanIntent; status: IntentStatus }>;
  /** True when an intent in the step is overdue: the step is the one flagged. */
  flagged: boolean;
  /** The Δv left when the step starts, for a step still ahead. */
  has?: Value<"m/s">;
  /** How many of a prediction's runs met the step. */
  runs?: PredictedStep;
}

export type PlanState =
  | { kind: "on-plan" }
  | { kind: "marginal" }
  | { kind: "off-plan" }
  | { kind: "fails-at"; step: number };

export interface ScoredPlan {
  steps: readonly ScoredStep[];
  current: number | undefined;
  state: PlanState;
  /** Δv the remaining steps need. `undefined` while the Δv left is unknown. */
  need: Value<"m/s"> | undefined;
  left: Value<"m/s"> | undefined;
  margin: Value<"m/s"> | undefined;
  reserve: Value<"m/s">;
}

const ms = (n: number) => value("m/s", n);
const ZERO = ms(0);

/** Whether a step's own goal is reached in the live flight. */
export function stepReached(step: PlanStep, live: PlanLive): boolean {
  const num = (k: string) => {
    const v = step.inputs[k];
    return typeof v === "number" ? v : undefined;
  };
  const str = (k: string) => {
    const v = step.inputs[k];
    return typeof v === "string" ? v : undefined;
  };
  switch (step.kind) {
    case "launch":
      return (
        live.altitude !== undefined &&
        live.altitude.compare(num("clearAltitude") ?? 10_000) >= 0
      );
    case "reach-orbit": {
      const target = num("periapsis");
      if (target === undefined || live.periapsis === undefined) return false;
      const body = str("body");
      if (body !== undefined && live.body !== body) return false;
      return live.periapsis.compare(target * 0.95) >= 0;
    }
    case "transfer":
      return live.body !== undefined && live.body === str("to");
    case "land":
      return (
        live.body !== undefined &&
        live.body === str("on") &&
        live.landed === true
      );
    default:
      return false;
  }
}

/** Whether an intent's trigger has passed in the live flight. */
export function triggerPassed(intent: PlanIntent, live: PlanLive): boolean {
  const t = intent.trigger;
  if (t.kind === "time") {
    return (
      live.missionTime !== undefined && live.missionTime.compare(t.at) >= 0
    );
  }
  if (t.body !== undefined && live.body !== t.body) return false;
  const v = t.quantity === "altitude" ? live.altitude : live.apoapsis;
  if (v === undefined) return false;
  const c = v.compare(t.value);
  return t.op === ">=" ? c >= 0 : c <= 0;
}

export function intentStatus(intent: PlanIntent, live: PlanLive): IntentStatus {
  const at = live.firedAt.get(intent.group);
  if (at !== undefined) return { kind: "fired", at };
  return triggerPassed(intent, live)
    ? { kind: "overdue" }
    : { kind: "pending" };
}

/** The index of the first step the flight has not reached, or `undefined` when every step is done. */
export function currentStepIndex(
  plan: FlightPlan,
  progress: PlanProgress,
): number | undefined {
  const i = plan.steps.findIndex((s) => !progress.doneAt.has(s.id));
  return i < 0 ? undefined : i;
}

/**
 * Scores a plan against the flight: each step's state, each intent's state,
 * and the Δv the remaining steps need against what is left.
 *
 * The current step's remaining need is what the steps up to and including it
 * need, less the Δv spent since lift-off, measured as the fall in vacuum Δv; for a flight first seen already
 * flying, whose pad Δv is unknown, it is the step's whole need. Each later step is scored with what will be left when it
 * starts: short when that is below its need, marginal when the margin it leaves
 * is under the reserve. A prediction's result replaces "met" with "likely to
 * fail" when fewer than half the runs met the step, and never overrides a
 * shortfall in m/s.
 */
export function scorePlan(
  plan: FlightPlan,
  live: PlanLive,
  progress: PlanProgress,
  predicted?: ReadonlyMap<string, PredictedStep>,
  /** Scoring a plan before flight: no step is current, and every step is scored from the Δv the craft has. */
  planning = false,
): ScoredPlan {
  const current = planning ? undefined : currentStepIndex(plan, progress);
  const reserve = ms(reserveDv(plan));
  const left = live.dvLeft;

  const start = startingCarry(plan, progress, live, current, planning);
  let carry = start?.carry;
  let need = start?.need ?? ZERO;

  const steps: ScoredStep[] = plan.steps.map((step, i) => {
    const intents = step.intents.map((intent) => ({
      intent,
      status: intentStatus(intent, live),
    }));
    const flagged =
      current !== undefined &&
      i <= current &&
      intents.some((x) => x.status.kind === "overdue");
    let has: Value<"m/s"> | undefined;
    let status: StepStatus = positionStatus(
      progress.doneAt.get(step.id),
      i === current,
    ) ?? { kind: "unscored" };
    if (
      status.kind === "unscored" &&
      carry !== undefined &&
      step.needsDv !== undefined
    ) {
      const stepNeed = ms(step.needsDv);
      has = carry;
      need = need.plus(stepNeed);
      const after = carry.minus(stepNeed);
      status = budgetStatus(after, stepNeed, reserve);
      carry = after;
    }
    const p = predicted?.get(step.id);
    if (
      p !== undefined &&
      p.of > 0 &&
      p.met / p.of < 0.5 &&
      (status.kind === "met" || status.kind === "marginal")
    ) {
      status = { kind: "likely-to-fail", met: p.met, of: p.of };
    }
    return { step, status, intents, flagged, has, runs: p };
  });

  return {
    steps,
    current,
    state: planState(steps),
    need: left === undefined ? undefined : need,
    left,
    margin: left === undefined ? undefined : left.minus(need),
    reserve,
  };
}

/** The plan's state: the first step that fails, else a late intent, else a marginal step, else on plan. */
function planState(steps: readonly ScoredStep[]): PlanState {
  const failing = steps.findIndex(
    (s) => s.status.kind === "short" || s.status.kind === "likely-to-fail",
  );
  if (failing >= 0) return { kind: "fails-at", step: failing + 1 };
  if (steps.some((s) => s.flagged)) return { kind: "off-plan" };
  return steps.some((s) => s.status.kind === "marginal")
    ? { kind: "marginal" }
    : { kind: "on-plan" };
}

/** What the steps after the current one have to start with: the Δv left less what the current step still needs. */
function startingCarry(
  plan: FlightPlan,
  progress: PlanProgress,
  live: PlanLive,
  current: number | undefined,
  planning: boolean,
): { carry: Value<"m/s">; need: Value<"m/s"> } | undefined {
  const left = live.dvLeft;
  if (left === undefined) return undefined;
  if (planning) return { carry: left, need: ZERO };
  if (current === undefined) return undefined;
  const remaining = currentRemaining(plan, progress, live, current);
  return { carry: left.minus(remaining), need: remaining };
}

/** A step's status from where the flight is: done, current, or `undefined` for one still ahead. */
function positionStatus(
  doneAt: Value<"s"> | undefined,
  current: boolean,
): StepStatus | undefined {
  if (doneAt !== undefined) return { kind: "done", at: doneAt };
  return current ? { kind: "current" } : undefined;
}

/** A step ahead, from the Δv it will leave: short below zero, marginal under the reserve. */
function budgetStatus(
  after: Value<"m/s">,
  need: Value<"m/s">,
  reserve: Value<"m/s">,
): StepStatus {
  if (after.isNegative()) {
    return { kind: "short", by: need.min(after.abs()) };
  }
  return after.compare(reserve) < 0 ? { kind: "marginal" } : { kind: "met" };
}

/** What the current step still needs: the steps through it, less the Δv spent since lift-off. */
function currentRemaining(
  plan: FlightPlan,
  progress: PlanProgress,
  live: PlanLive,
  current: number,
): Value<"m/s"> {
  const own = ms(plan.steps[current]?.needsDv ?? 0);
  const atLaunch = progress.vacuumDvAtLaunch;
  if (atLaunch === undefined || live.dvVacuum === undefined) return own;
  const through = plan.steps
    .slice(0, current + 1)
    .reduce((sum, s) => sum.plus(ms(s.needsDv ?? 0)), ZERO);
  /*
   * Spent is read from vacuum Δv because it depends only on the propellant
   * burnt. The Δv at the air pressure the craft is in rises through the climb
   * as the air thins, so its fall would read as nothing spent for the whole
   * ascent.
   */
  const spent = atLaunch.minus(live.dvVacuum).max(0);
  return through.minus(spent).max(0).min(own);
}
