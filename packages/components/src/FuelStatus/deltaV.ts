import type { DeltaVBudget, DeltaVStage } from "@ksp-gonogo/sitrep-client";
import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import type { DeltaVMode } from "./config";

/** Stable empty stack: `useProcessor` answers undefined before the first frame. */
export const NO_STAGES: DeltaVStage[] = [];

/** A budget figure as a reading dated as the budget it is part of; the budget's model is dropped because it speaks about the whole budget. */
export function budgetFigure<Unit extends string>(
  budget: Reading<DeltaVBudget>,
  figure: Value<Unit>,
): Reading<Value<Unit>> {
  return {
    state: budget.state,
    value: figure,
    atUt: budget.atUt,
    asOfUt: budget.asOfUt,
    grade: budget.grade,
    reckoning: { status: "none" },
  };
}

export function pickDeltaV(s: DeltaVStage, mode: DeltaVMode): number {
  switch (mode) {
    case "vac":
      return s.deltaVVac;
    case "asl":
      return s.deltaVASL;
    default:
      return s.deltaVActual;
  }
}

export function pickTWR(s: DeltaVStage, mode: DeltaVMode): number {
  switch (mode) {
    case "vac":
      return s.TWRVac;
    case "asl":
      return s.TWRASL;
    default:
      return s.TWRActual;
  }
}

/** The vessel-total ΔV for the chosen situation. */
export function pickTotal(
  budget: DeltaVBudget | undefined,
  mode: DeltaVMode,
): Value<"m/s"> | null | undefined {
  switch (mode) {
    case "vac":
      return budget?.totalVac;
    case "asl":
      return budget?.totalAsl;
    default:
      return budget?.totalActual;
  }
}

/** The largest finite stage ΔV, floored above zero so a stack of spent stages still has an axis. */
export function maxStageDeltaV(
  stages: readonly DeltaVStage[],
  mode: DeltaVMode,
): Value<"m/s"> {
  const finiteDvs = stages
    .map((s) => pickDeltaV(s, mode))
    .filter((v): v is number => Number.isFinite(v));
  return value("m/s", Math.max(...finiteDvs, 0.001));
}

/** A stage row can lack TWR or ΔV (engine-less stage, decoupler-only, a just-ejected engine). */
export function fmtFixed(value: unknown, digits: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return NULL_DISPLAY;
  return value.toFixed(digits);
}
