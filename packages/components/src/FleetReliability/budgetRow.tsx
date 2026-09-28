import { type ReliabilityBudget, value } from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf, Unit } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import type { Row } from "./partRows";

const seconds = (magnitude: number) => value("s", magnitude);
const count = (magnitude: number) => value("count", magnitude);
const ratio = (magnitude: number) => value("ratio", magnitude);

/** How far into its allowance a budget is, when it says. */
export function consumedOf(budget: ReliabilityBudget): number | null {
  return magnitudeOf(budget.consumed);
}

interface BudgetMagnitudes {
  usedSeconds: number | null;
  limitSeconds: number | null;
  usedCount: number | null;
  limitCount: number | null;
}

function magnitudesOf(budget: ReliabilityBudget): BudgetMagnitudes {
  return {
    usedSeconds: magnitudeOf(budget.usedSeconds),
    limitSeconds: magnitudeOf(budget.limitSeconds),
    usedCount: magnitudeOf(budget.usedCount),
    limitCount: magnitudeOf(budget.limitCount),
  };
}

/** What is left before the limit, off the seconds pair when it is whole, else the count pair. */
function remainingOf(m: BudgetMagnitudes): ReactNode | undefined {
  if (m.usedSeconds !== null && m.limitSeconds !== null) {
    return <Unit value={seconds(m.limitSeconds - m.usedSeconds)} />;
  }
  if (m.usedCount !== null && m.limitCount !== null) {
    return <Unit value={count(m.limitCount - m.usedCount)} />;
  }
  return undefined;
}

/** How far past the limit, off the same pair as {@link remainingOf}. */
function excessOf(m: BudgetMagnitudes): ReactNode | undefined {
  if (m.usedSeconds !== null && m.limitSeconds !== null) {
    return <Unit value={seconds(m.usedSeconds - m.limitSeconds)} />;
  }
  if (m.usedCount !== null && m.limitCount !== null) {
    return <Unit value={count(m.usedCount - m.limitCount)} />;
  }
  return undefined;
}

function limitOf(m: BudgetMagnitudes): ReactNode | undefined {
  if (m.limitSeconds !== null) return <Unit value={seconds(m.limitSeconds)} />;
  if (m.limitCount !== null) return <Unit value={count(m.limitCount)} />;
  return undefined;
}

/** Only the fraction is known, so that is all the row may claim. */
function fractionRow(label: string, consumed: number, word: string): Row {
  return {
    severity: "caution",
    word,
    clause: (
      <>
        {label} <Unit value={ratio(consumed)} /> used
      </>
    ),
  };
}

/**
 * How a budget reads out loud, by what crossing its limit MEANS: "due in",
 * "left" and "past" are different situations. Without the seconds pair, the
 * same sentences take a count.
 */
export function budgetRow(budget: ReliabilityBudget): Row {
  const label = budget.label ?? budget.id ?? "budget";
  const consumed = consumedOf(budget) ?? 0;
  const over = consumed >= 1;

  const m = magnitudesOf(budget);
  const remaining = remainingOf(m);
  const excess = excessOf(m);
  const limit = limitOf(m);

  if (remaining === undefined || limit === undefined || excess === undefined) {
    return fractionRow(
      label,
      consumed,
      budget.kind === "schedule" ? "service" : "wear",
    );
  }

  if (budget.kind === "schedule") {
    if (over) {
      return {
        severity: "caution",
        word: "service",
        clause: (
          <>
            {label} overdue by {excess}
          </>
        ),
      };
    }
    return {
      severity: "caution",
      word: "service",
      clause: (
        <>
          {label} due in {remaining}
        </>
      ),
    };
  }
  if (budget.kind === "hard-limit") {
    if (over) {
      return {
        severity: "nogo",
        word: "wear",
        clause: (
          <>
            past {label} limit by {excess}
          </>
        ),
      };
    }
    return {
      severity: "warn",
      word: "wear",
      clause: (
        <>
          {remaining} of {limit} {label} left
        </>
      ),
    };
  }
  if (budget.kind === "risk-ramp") {
    if (over) {
      return {
        severity: "warn",
        word: "wear",
        clause: (
          <>
            past {label} rating by {excess}
          </>
        ),
      };
    }
    return {
      severity: "warn",
      word: "wear",
      clause: (
        <>
          {remaining} of {limit} {label} left
        </>
      ),
    };
  }
  // "advisory", or a kind we have never heard of: the numbers, no verb.
  return fractionRow(label, consumed, "wear");
}
