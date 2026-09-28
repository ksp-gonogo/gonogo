import {
  type ReliabilityBudget,
  type ReliabilityPartEntry,
  type Tone,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf, type Severity, Unit } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { budgetRow, consumedOf } from "./budgetRow";
import {
  budgetAttention,
  SURVIVAL_ATTENTION,
  SURVIVAL_WARNING,
} from "./thresholds";

const seconds = (magnitude: number) => value("s", magnitude);
const ratio = (magnitude: number) => value("ratio", magnitude);

export type Row = { severity: Severity; word: string; clause: ReactNode };

/** A card's leading-edge tone: coarser than the badge, since the edge is scanned for "anything bad" and the badge carries the precise word. */
export const CARD_TONE: Record<Severity, Tone> = {
  nogo: "nogo",
  warn: "warn",
  caution: "warn",
  offline: "neutral",
  go: "neutral",
  info: "neutral",
};

/**
 * Whether this part earns a row: a condition not plainly nominal, a budget past
 * its kind's threshold, or a survival probability worth mentioning. An
 * UNRECOGNISED condition selects, and the row table is total so it still renders.
 */
export function isNoteworthy(part: ReliabilityPartEntry): boolean {
  if (part.condition !== "nominal") return true;
  for (const budget of part.budgets ?? []) {
    const consumed = consumedOf(budget);
    if (consumed !== null && consumed >= budgetAttention(budget.kind))
      return true;
  }
  const survival = magnitudeOf(part.survival);
  return survival !== null && survival < SURVIVAL_ATTENTION;
}

/** The budget that has gone furthest past its own threshold, if any has. */
function drivingBudget(
  part: ReliabilityPartEntry,
): ReliabilityBudget | undefined {
  let best: ReliabilityBudget | undefined;
  let bestConsumed = -1;
  for (const budget of part.budgets ?? []) {
    const consumed = consumedOf(budget);
    if (consumed === null || consumed < budgetAttention(budget.kind)) continue;
    if (consumed > bestConsumed) {
      best = budget;
      bestConsumed = consumed;
    }
  }
  return best;
}

/** The `schedule` budget, when the provider models one. */
function scheduleBudget(
  part: ReliabilityPartEntry,
): ReliabilityBudget | undefined {
  return (part.budgets ?? []).find((budget) => budget.kind === "schedule");
}

function serviceDueClause(
  detail: string | undefined,
  overdue: ReactNode | undefined,
): ReactNode {
  if (detail && overdue) {
    return (
      <>
        {detail} · {overdue}
      </>
    );
  }
  return overdue ?? detail;
}

function serviceDueRow(
  part: ReliabilityPartEntry,
  detail: string | undefined,
): Row {
  const schedule = scheduleBudget(part);
  const consumed = schedule ? consumedOf(schedule) : null;
  const used = magnitudeOf(schedule?.usedSeconds);
  const limit = magnitudeOf(schedule?.limitSeconds);
  // Never a future countdown beside "service due": a part inspected and found worn is due NOW whatever its maintenance clock says.
  const overdue =
    consumed !== null && consumed >= 1 && used !== null && limit !== null ? (
      <>
        overdue by <Unit value={seconds(used - limit)} />
      </>
    ) : undefined;
  return {
    severity: "caution",
    word: "service due",
    clause: serviceDueClause(detail, overdue),
  };
}

function nominalRow(part: ReliabilityPartEntry): Row {
  const budget = drivingBudget(part);
  if (budget) return budgetRow(budget);

  const survival = magnitudeOf(part.survival);
  const horizon = magnitudeOf(part.survivalHorizonSeconds);
  if (survival !== null && horizon !== null) {
    // The horizon is IN the sentence: exp(-rate*t) is uninterpretable without t.
    return {
      severity: survival >= SURVIVAL_WARNING ? "caution" : "warn",
      word: "survival",
      clause: (
        <>
          <Unit value={ratio(survival)} /> to survive{" "}
          <Unit value={seconds(horizon)} /> of operation
        </>
      ),
    };
  }
  // Unreachable by construction; here so the table is total.
  return { severity: "caution", word: "wear", clause: "flagged" };
}

/** One row per noteworthy part, first match wins, and TOTAL: every selected part renders something. */
export function rowFor(part: ReliabilityPartEntry): Row {
  const detail = part.conditionDetail ?? undefined;

  if (part.condition === "failed-critical") {
    return { severity: "nogo", word: "critical failure", clause: detail };
  }
  if (part.condition === "failed") {
    return { severity: "nogo", word: "failed", clause: detail };
  }
  if (part.condition === "service-due") return serviceDueRow(part, detail);
  if (part.condition === "nominal") return nominalRow(part);

  // "unknown", or any value we have never heard of: a condition we cannot interpret is not nominal.
  return { severity: "offline", word: "unreadable", clause: detail };
}
