/**
 * What fires an intent: a mission time, or a live value crossing a threshold.
 * Times are seconds from lift-off; altitudes and apsides are metres above the
 * body's datum.
 */
export type IntentTrigger =
  | { kind: "time"; at: number }
  | {
      kind: "value";
      quantity: "altitude" | "apoapsis";
      op: ">=" | "<=";
      value: number;
      /** The body the value is measured over; any body when absent. */
      body?: string;
    };

/** An action group the plan fires inside a step, at a time or a value. */
export interface PlanIntent {
  /** 1-based action group number, as `vessel.control.actionGroups[].index`. */
  group: number;
  label: string;
  trigger: IntentTrigger;
}

/** The step kinds core scores. A contributed step type uses its own id. */
export type CoreStepKind = "launch" | "reach-orbit" | "transfer" | "land";

export interface PlanStep {
  id: string;
  kind: CoreStepKind | (string & {});
  /** The step's own inputs, such as `{ heading: 90 }` or `{ periapsis: 80000 }`. */
  inputs: Readonly<Record<string, number | string>>;
  /** The Δv the step needs, in m/s, recorded when the plan was scored. Absent for a step with no Δv of its own. */
  needsDv?: number;
  /** The script that flies the step, by name, and the processor it runs on. */
  script?: { name: string; cpu?: string };
  intents: readonly PlanIntent[];
}

export interface FlightPlan {
  id: string;
  name: string;
  /** The reserve held back from the margin, as a fraction of the plan's total need (0.1 is 10%). */
  reserve: number;
  steps: readonly PlanStep[];
}

/** The plan's total Δv need, in m/s. */
export function totalNeed(plan: FlightPlan): number {
  return plan.steps.reduce((sum, s) => sum + (s.needsDv ?? 0), 0);
}

/** The reserve in m/s. */
export function reserveDv(plan: FlightPlan): number {
  return plan.reserve * totalNeed(plan);
}
