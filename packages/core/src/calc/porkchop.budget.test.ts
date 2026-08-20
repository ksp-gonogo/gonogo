import { beforeEach, describe, expect, it } from "vitest";
import {
  buildPorkchop,
  PORKCHOP_SOLVE_BUDGET,
  type StateLike,
} from "./porkchop";

/**
 * The instrument for a bug a test cannot express.
 *
 * A 32x32 porkchop is 1,024 Lambert solves and measures ~7ms. That FITS in a 16.7ms
 * frame, so rebuilding it every frame drops nothing and fails nothing: it just burns
 * about 42% of a core, continuously, on the main thread, for an answer that is identical
 * frame to frame. Nothing in a correctness suite can see that.
 *
 * So the budget is the test. These two cases pin what it is for: it must fire on a
 * frame-rate rebuild, and it must NOT fire on the interaction rate a real operator
 * produces. A budget that only ever passes is not protecting anything.
 */

const MU = 1.32712440018e20;
const R1 = 1.495978707e11;
const R2 = 2.279392e11;
const DAY = 86400;

/** Circular coplanar motion: enough for Lambert to converge on every cell. */
function circular(radius: number, periodSec: number) {
  const n = (2 * Math.PI) / periodSec;
  return (ut: number): StateLike => {
    const a = n * ut;
    const v = (2 * Math.PI * radius) / periodSec;
    return {
      position: [radius * Math.cos(a), radius * Math.sin(a), 0],
      velocity: [-v * Math.sin(a), v * Math.cos(a), 0],
    };
  };
}

function buildOneGrid(centreUt: number) {
  const span = 200 * DAY;
  const linspace = (from: number, to: number, n: number) =>
    Array.from({ length: n }, (_, k) => from + ((to - from) * k) / (n - 1));
  return buildPorkchop({
    muParent: MU,
    propagateOrigin: circular(R1, 365.256 * DAY),
    propagateDest: circular(R2, 686.98 * DAY),
    departureUts: linspace(centreUt, centreUt + span, 32),
    arrivalUts: linspace(centreUt + 250 * DAY, centreUt + 450 * DAY, 32),
  });
}

describe("porkchop solve budget", () => {
  beforeEach(() => PORKCHOP_SOLVE_BUDGET.reset());

  it("breaches when the grid is rebuilt at frame rate", () => {
    // One second of a 60Hz clock, which is what `nowUt` in a memo's dependency array
    // produces: `useViewUt` notifies every frame the clock moves.
    const now = 1_000_000;
    for (let frame = 0; frame < 60; frame++) {
      buildOneGrid(0);
      PORKCHOP_SOLVE_BUDGET.record(0, now + frame * 16.7);
    }

    expect(PORKCHOP_SOLVE_BUDGET.rate(now + 999)).toBeGreaterThan(4 * 32 * 32);
    expect(PORKCHOP_SOLVE_BUDGET.getExceedanceCount()).toBeGreaterThan(0);

    // Clear before the global test gate reads it: this breach is the assertion, not a
    // regression. See `PerfBudget.installTestGate`.
    PORKCHOP_SOLVE_BUDGET.reset();
  });

  it("stays clear at the rate an operator actually produces", () => {
    // Picking a window, changing destination, nudging a slider: a handful of rebuilds a
    // second, each a deliberate act. The budget must not cry at this or it gets muted.
    const now = 2_000_000;
    for (let interaction = 0; interaction < 3; interaction++) {
      buildOneGrid(interaction * DAY);
      PORKCHOP_SOLVE_BUDGET.record(0, now + interaction * 300);
    }

    expect(PORKCHOP_SOLVE_BUDGET.rate(now + 999)).toBeLessThanOrEqual(
      4 * 32 * 32,
    );
    expect(PORKCHOP_SOLVE_BUDGET.getExceedanceCount()).toBe(0);
  });
});
