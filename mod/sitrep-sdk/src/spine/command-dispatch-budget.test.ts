import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PerfBudget } from "../perf/PerfBudget";
import { StubTransport } from "../testing/stub-transport";
import { TelemetryClient } from "./client";
import type { Clock } from "./clock";

/**
 * A command storm is only visible where the command LEAVES, and until this
 * budget existed nothing in the tree counted there.
 *
 * The trap this file exists to close: the game silently absorbs a command
 * asking for the state it is already in. So a fixture that measures EFFECTS
 * counts one dispatch where the client sent a hundred, and the loop that sent
 * the other ninety-nine registers nowhere. The warp controller ran exactly that
 * way, about 120 `time.setWarpIndex` dispatches across one light-time where one
 * was correct, and every gate in the repo stayed green.
 *
 * The first test therefore asserts on the budget at `TelemetryClient.dispatch`
 * and on the effect count side by side. The gap between the two numbers IS the
 * storm, and it is the thing an outcome-watching test cannot report. The other
 * two hold the threshold from both sides: it trips on a runaway, and it stays
 * quiet through the loudest traffic a real operator produces.
 */

/** The budget under test, found through the registry it self-registers into. */
const BUDGET_NAME = "TelemetryClient command dispatch/sec";

/**
 * The dispatch budget, or a failure that says what is missing rather than
 * `undefined is not an object` twenty lines later. A budget nothing can find is
 * a budget the Perf Budgets widget cannot list and the test gate cannot read,
 * so its absence is the interesting failure, not a detail of this file.
 */
function dispatchBudget(): PerfBudget {
  const found = PerfBudget.getAll().find((b) => b.name === BUDGET_NAME);
  if (!found) {
    throw new Error(
      `no PerfBudget named "${BUDGET_NAME}" is registered: nothing is counting command dispatch`,
    );
  }
  return found;
}

/**
 * A clock that never fires anything. `TelemetryClient` arms a loss timer per
 * dispatch, and a storm of them firing mid-test would settle promises this file
 * has no opinion about.
 */
const FROZEN_CLOCK: Clock = {
  now: () => 0,
  schedule: () => () => {},
};

/** The warp index a dispatch is asking for, or null when its args do not carry one. */
function commandedIndex(args: unknown): number | null {
  if (typeof args !== "object" || args === null) return null;
  if (!("index" in args)) return null;
  const index = args.index;
  return typeof index === "number" ? index : null;
}

/** A client wired to a stub, with the game's warp index as real state behind it. */
function startSession() {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport, FROZEN_CLOCK);
  // A delay source so the client can predict a confirm eta. Without one it
  // warns, correctly, that an unanswered dispatch can never settle, which is
  // true and not this file's subject.
  client.setDelaySource(() => 0);

  /** The warp index the game is actually at, moved only by a command that asks for a different one. */
  let gameIndex = 0;
  /** Every command that CHANGED the game, the only thing an effect-watching fixture can see. */
  const effects: number[] = [];

  transport.setCommandHandler((command, args) => {
    if (command !== "time.setWarpIndex") return null;
    const index = commandedIndex(args);
    if (index === null) return null;
    // KSP absorbs a redundant SetWarp without complaint or effect.
    if (index === gameIndex) return null;
    gameIndex = index;
    effects.push(index);
    return null;
  });

  return {
    client,
    effects,
    sent: transport.sentCommands,
    gameIndex: () => gameIndex,
  };
}

describe("command dispatch budget", () => {
  let budget: PerfBudget;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    budget = dispatchBudget();
    budget.reset();
  });

  afterEach(() => {
    /* This package installs no `PerfBudget` test gate, but the budget is a
       module singleton shared with every other suite in the run, so a
       deliberate breach here is cleared rather than left lying about. */
    budget.reset();
    vi.useRealTimers();
  });

  it("counts a dispatch the game absorbs, which an effect-watching fixture cannot", async () => {
    const session = startSession();
    const REDUNDANT_TICKS = 40;

    // One command that moves the warp, then a controller re-asking for the
    // index it already asked for, once per tick, for as long as it is blind.
    session.client.dispatch("time.setWarpIndex", { index: 4 });
    for (let tick = 0; tick < REDUNDANT_TICKS; tick++) {
      session.client.dispatch("time.setWarpIndex", { index: 4 });
    }
    // The stub answers on a microtask, so the effects are not in yet.
    await vi.advanceTimersByTimeAsync(0);

    // What the game saw, and what every fixture watching the game would report.
    expect(session.effects).toEqual([4]);
    expect(session.gameIndex()).toBe(4);

    // What actually left the client. The gap is the storm.
    expect(budget.rate()).toBe(REDUNDANT_TICKS + 1);
    expect(session.sent).toHaveLength(REDUNDANT_TICKS + 1);
  });

  it("trips its soft cap when a loop dispatches faster than an operator can", async () => {
    const session = startSession();
    // One past the cap, so the assertion is about the threshold and not about
    // some round number chosen for looking big.
    const storm = budget.threshold + 1;

    for (let tick = 0; tick < storm; tick++) {
      session.client.dispatch("vessel.control.setThrottle", { value: 0.5 });
    }
    await vi.advanceTimersByTimeAsync(0);

    expect(budget.rate()).toBe(storm);
    expect(budget.getExceedanceCount()).toBeGreaterThan(0);
  });

  it("lets a whole second of hands-on control-stream traffic through", async () => {
    const session = startSession();
    // `useControlStream` coalesces at 10 Hz per channel and the Navball mounts
    // two, so this is the loudest thing a real operator produces. It has to
    // pass, or the budget is a false alarm on ordinary flying.
    for (let tenth = 0; tenth < 10; tenth++) {
      session.client.dispatch("vessel.control.setThrottle", { value: 0.5 });
      session.client.dispatch("vessel.control.setPitch", { value: 0.1 });
      vi.setSystemTime(1_700_000_000_000 + tenth * 100);
    }
    await vi.advanceTimersByTimeAsync(0);

    expect(budget.rate()).toBe(20);
    expect(budget.getExceedanceCount()).toBe(0);
  });
});
