#!/usr/bin/env tsx
/**
 * Golden-fixture generator for `mod/sitrep-server/src/clock.ts`'s `ManualClock`.
 *
 * Unlike the pure-function semver fixture (`{args, expected}`), `ManualClock`
 * is stateful: a fixture here is a **scripted scenario** — a sequence of
 * operations (`schedule` / `advanceTo` / `cancel`) run against a real
 * `ManualClock` instance, plus the OBSERVABLE OUTPUT that instance actually
 * produced (the order callbacks fired in, and the final `now()`).
 *
 * Callbacks are represented by string ids instead of real closures so the
 * scenario is JSON-serializable. A callback that itself schedules another
 * callback (the re-entrancy-safe-drain case) is expressed via a nested
 * `onFire` list on the `schedule` op — when the outer callback fires, it
 * records its own id, then (still inside the same `advanceTo` drain) issues
 * each nested schedule against the same clock instance, exactly like the TS
 * reference's `clock.schedule(3, () => { order.push("three"); clock.schedule(8,
 * () => order.push("eight")); })` pattern in `clock.test.ts`.
 *
 * The `expected` block is NEVER hand-authored: `runScenario` executes the ops
 * against the real `ManualClock` and records what actually happened. Both the
 * TS reference (already covered by `clock.test.ts`) and the C# port
 * (`Sitrep.Core.Tests/ClockGoldenFixtureTests.cs`) are checked against this
 * same file.
 *
 * Run with: `pnpm --filter @gonogo/sitrep-server gen:golden-fixtures`
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ManualClock } from "../../sitrep-server/src/clock.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, "..", "clock.json");

interface ScheduleOp {
  op: "schedule";
  id: string;
  atUt: number;
  /** Nested schedules issued (against the same clock) when this callback fires. */
  onFire?: ScheduleOp[];
}

interface AdvanceToOp {
  op: "advanceTo";
  ut: number;
}

interface CancelOp {
  op: "cancel";
  /** id of a previously-issued `schedule` op to cancel. */
  id: string;
}

type Op = ScheduleOp | AdvanceToOp | CancelOp;

interface Scenario {
  name: string;
  description: string;
  startUt?: number;
  ops: Op[];
}

interface ScenarioResult {
  name: string;
  description: string;
  startUt: number;
  ops: Op[];
  expected: {
    fired: string[];
    nowAfter: number;
  };
}

/** Issues one `schedule` op (and, recursively, its `onFire` children) against `clock`. */
function issueSchedule(
  clock: ManualClock,
  op: ScheduleOp,
  fired: string[],
  cancelHandles: Map<string, () => void>,
): void {
  const cancel = clock.schedule(op.atUt, () => {
    fired.push(op.id);
    for (const nested of op.onFire ?? []) {
      issueSchedule(clock, nested, fired, cancelHandles);
    }
  });
  cancelHandles.set(op.id, cancel);
}

/** Runs a scenario's ops against a real `ManualClock` and records what happened. */
function runScenario(scenario: Scenario): ScenarioResult {
  const startUt = scenario.startUt ?? 0;
  const clock = new ManualClock(startUt);
  const fired: string[] = [];
  const cancelHandles = new Map<string, () => void>();

  for (const op of scenario.ops) {
    switch (op.op) {
      case "schedule":
        issueSchedule(clock, op, fired, cancelHandles);
        break;
      case "advanceTo":
        clock.advanceTo(op.ut);
        break;
      case "cancel": {
        const cancel = cancelHandles.get(op.id);
        if (!cancel) {
          throw new Error(
            `cancel op referenced unknown schedule id "${op.id}"`,
          );
        }
        cancel();
        break;
      }
    }
  }

  return {
    name: scenario.name,
    description: scenario.description,
    startUt,
    ops: scenario.ops,
    expected: { fired, nowAfter: clock.now() },
  };
}

const scenarios: Scenario[] = [
  {
    name: "ascending-order",
    description:
      "Due callbacks fire in ascending atUt order regardless of schedule/insertion order.",
    ops: [
      { op: "schedule", id: "eight", atUt: 8 },
      { op: "schedule", id: "three", atUt: 3 },
      { op: "advanceTo", ut: 10 },
    ],
  },
  {
    name: "inclusive-boundary",
    description:
      "A callback scheduled exactly at the target UT fires (atUt <= ut is inclusive).",
    ops: [
      { op: "schedule", id: "at-five", atUt: 5 },
      { op: "advanceTo", ut: 5 },
    ],
  },
  {
    name: "not-yet-due-is-held",
    description:
      "advanceTo only fires callbacks with atUt <= target; later ones stay pending until a later advance.",
    ops: [
      { op: "schedule", id: "ten", atUt: 10 },
      { op: "schedule", id: "five", atUt: 5 },
      { op: "advanceTo", ut: 7 },
      { op: "advanceTo", ut: 12 },
    ],
  },
  {
    name: "future-schedule-not-fired",
    description:
      "A callback scheduled after the target UT never fires on that advance.",
    ops: [
      { op: "schedule", id: "twenty", atUt: 20 },
      { op: "advanceTo", ut: 10 },
    ],
  },
  {
    name: "cancel-before-due",
    description:
      "A cancelled callback never fires even once its atUt is reached.",
    ops: [
      { op: "schedule", id: "a", atUt: 10 },
      { op: "cancel", id: "a" },
      { op: "advanceTo", ut: 10 },
    ],
  },
  {
    name: "backward-advance-is-strict-noop",
    description:
      "advanceTo to a UT strictly before currentUt is a full no-op: now() doesn't move and nothing fires (strict '<' guard, not '<=').",
    startUt: 10,
    ops: [
      { op: "schedule", id: "five", atUt: 5 },
      { op: "advanceTo", ut: 3 },
    ],
  },
  {
    name: "same-ut-reschedule-drains",
    description:
      "A callback that schedules another callback at the SAME ut it just fired at is drained within the same advanceTo (re-entrancy-safe drain), not stranded for a later advance.",
    ops: [
      {
        op: "schedule",
        id: "outer",
        atUt: 5,
        onFire: [{ op: "schedule", id: "inner-same-ut", atUt: 5 }],
      },
      { op: "advanceTo", ut: 5 },
    ],
  },
  {
    name: "reentrant-future-due-drains-in-order",
    description:
      "A callback that re-entrantly schedules another callback at a still-due future UT (<= target) fires it within the SAME advanceTo, in ascending-atUt order relative to anything else pending.",
    ops: [
      {
        op: "schedule",
        id: "three",
        atUt: 3,
        onFire: [{ op: "schedule", id: "eight", atUt: 8 }],
      },
      { op: "advanceTo", ut: 10 },
    ],
  },
  {
    name: "repeat-advance-to-same-ut-still-fires-new-schedule",
    description:
      "advanceTo(ut) is idempotent w.r.t. now() but NOT a no-op for freshly scheduled callbacks: scheduling at the current ut and calling advanceTo(ut) again still fires it.",
    ops: [
      { op: "advanceTo", ut: 5 },
      { op: "schedule", id: "late-at-five", atUt: 5 },
      { op: "advanceTo", ut: 5 },
    ],
  },
  {
    name: "chained-reentrant-drain-multiple-levels",
    description:
      "Re-entrancy drains through more than one level: a fires, schedules b at <= ut, b fires and schedules c at <= ut, all within one advanceTo, plus an unrelated already-pending callback interleaves by atUt order.",
    ops: [
      { op: "schedule", id: "mid", atUt: 6 },
      {
        op: "schedule",
        id: "a",
        atUt: 2,
        onFire: [
          {
            op: "schedule",
            id: "b",
            atUt: 4,
            onFire: [{ op: "schedule", id: "c", atUt: 6 }],
          },
        ],
      },
      { op: "advanceTo", ut: 10 },
    ],
  },
];

const results = scenarios.map(runScenario);

writeFileSync(OUT_FILE, `${JSON.stringify(results, null, 2)}\n`);
console.log(`golden-fixtures -> ${OUT_FILE} (${results.length} scenarios)`);
