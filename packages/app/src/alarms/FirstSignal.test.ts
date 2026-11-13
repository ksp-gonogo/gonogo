import { describe, expect, it } from "vitest";
import {
  AlarmWarpPlanner,
  FIRST_SIGNAL_FLOOR_SECONDS,
  FIRST_SIGNAL_TARGET_ID,
} from "./AlarmWarpPlanner";
import { FirstSignalWatch, type KnownDelay } from "./FirstSignalWatch";
import { WarpControl } from "./WarpControl";
import { WarpRateTable } from "./WarpRateTable";

const RATES = [1, 10, 100, 1000, 10000, 100000, 1000000, 6000000];

function ladder(opts: {
  gameNow: number;
  waiting: { arrivesAtUt: number | null } | null;
  owlt: number;
}) {
  const table = new WarpRateTable();
  table.setPublished(RATES);
  const planner = new AlarmWarpPlanner(
    () => [],
    () => 1_000,
    () => opts.owlt,
    () => opts.waiting,
    () => opts.gameNow,
  );
  const control = new WarpControl(
    planner,
    {
      getObservedIndex: () => 0,
      getRateTable: () => table,
      getMaxIndex: () => null,
      registerOwnWarpIntent: () => {},
      getOwltSeconds: () => opts.owlt,
    },
    10,
  );
  return { control };
}

describe("a warp toward the first signal from a newly active craft", () => {
  it("ramps by the operator's margin, not by the delay it is waiting out", () => {
    const { control } = ladder({
      gameNow: 5_000,
      waiting: { arrivesAtUt: 6_800 },
      owlt: 1_800,
    });

    expect(control.begin("first-signal")).toBe(true);
    control.reconcile(1_000);

    expect(control.snapshot()).toMatchObject({
      alarmId: FIRST_SIGNAL_TARGET_ID,
      targetIndex: 2,
      targetRate: 100,
    });
  });

  it("warps with no target at all, capped by the floor, when no delay is known or estimated", () => {
    const { control } = ladder({
      gameNow: 5_000,
      waiting: { arrivesAtUt: null },
      owlt: 0,
    });

    expect(control.begin("first-signal")).toBe(true);
    control.reconcile(1_000);

    // The floor over the margin: 600 s / 10 s is a 60x cap, so the 10x rung.
    expect(FIRST_SIGNAL_FLOOR_SECONDS).toBe(600);
    expect(control.snapshot()).toMatchObject({
      targetIndex: 1,
      targetRate: 10,
    });
  });

  it("keeps warping at the floor's rung once the estimate has run out, since only the craft's own data ends it", () => {
    const { control } = ladder({
      gameNow: 7_000,
      waiting: { arrivesAtUt: 6_800 },
      owlt: 1_800,
    });
    control.begin("first-signal");
    control.reconcile(1_000);
    expect(control.snapshot()?.targetIndex).toBe(1);
  });

  it("holds a warp to an alarm to the delay, as before", () => {
    const planner = new AlarmWarpPlanner(
      () => [
        {
          id: "a",
          name: "burn",
          trigger: { kind: "time", ut: 4_800, leadSeconds: 0 },
          state: "pending",
          createdBy: "main",
          createdAt: 0,
        },
      ],
      () => 1_000,
      () => 1_800,
    );
    const table = new WarpRateTable();
    table.setPublished(RATES);
    const control = new WarpControl(
      planner,
      {
        getObservedIndex: () => 0,
        getRateTable: () => table,
        getMaxIndex: () => null,
        registerOwnWarpIntent: () => {},
        getOwltSeconds: () => 1_800,
      },
      10,
    );
    control.begin();
    control.reconcile(1_000);

    // 2 000 s left against an 1 800 s margin: no rung runs that slowly beyond 1x.
    expect(control.snapshot()?.targetIndex).toBe(0);
  });

  it("is offered only while a first signal is awaited, and never plans an alarm toward it", () => {
    const none = ladder({ gameNow: 5_000, waiting: null, owlt: 1_800 });
    expect(none.control.begin("first-signal")).toBe(false);

    const waiting = ladder({
      gameNow: 5_000,
      waiting: { arrivesAtUt: 6_800 },
      owlt: 1_800,
    });
    expect(waiting.control.begin()).toBe(false);
  });
});

function watch(initial: { id: string | null; name?: string }) {
  const state = {
    active: initial.id
      ? { vesselId: initial.id, name: initial.name ?? "" }
      : null,
    now: 100 as number | null,
    observed: false,
    arrived: false,
    delay: { kind: "unknown" } as KnownDelay,
    estimate: null as number | null,
  };
  const w = new FirstSignalWatch({
    readActive: () => state.active,
    gameUtNow: () => state.now,
    ownDataObserved: () => state.observed,
    ownDataArrived: () => state.arrived,
    readDelay: () => state.delay,
    readEstimate: () => state.estimate,
  });
  return { state, w };
}

function switched(opts: { estimate?: number | null } = {}) {
  const { state, w } = watch({ id: "mk1", name: "MkI" });
  w.observe();
  state.active = { vesselId: "probe", name: "Mun Probe" };
  state.now = 500;
  state.estimate = opts.estimate ?? null;
  w.observe();
  return { state, w };
}

describe("FirstSignalWatch", () => {
  it("announces the wait from the switch, with no figure at all while the delay is unknown and cannot be estimated", () => {
    const { w } = switched();
    expect(w.snapshot()).toEqual({
      vesselName: "Mun Probe",
      owltSeconds: null,
      estimated: false,
    });
    expect(w.awaited()).toEqual({ arrivesAtUt: null });
  });

  it("shows the estimate as an estimate while the delay is unknown, and is expected at the switch plus it", () => {
    const { w } = switched({ estimate: 1_750 });
    expect(w.snapshot()).toEqual({
      vesselName: "Mun Probe",
      owltSeconds: 1_750,
      estimated: true,
    });
    expect(w.awaited()).toEqual({ arrivesAtUt: 2_250 });
  });

  it("replaces the estimate with the real delay once it is known", () => {
    const { state, w } = switched({ estimate: 1_750 });
    state.delay = { kind: "known", seconds: 1_800 };
    expect(w.snapshot()).toEqual({
      vesselName: "Mun Probe",
      owltSeconds: 1_800,
      estimated: false,
    });
    expect(w.awaited()).toEqual({ arrivesAtUt: 2_300 });
  });

  it("ends only when the craft's own data is observed, never on an estimate running out", () => {
    const { state, w } = switched({ estimate: 10 });
    state.now = 100_000;
    expect(w.observe()).toBeUndefined();
    expect(w.snapshot()).not.toBeNull();

    state.observed = true;
    expect(w.observe()).toBe("ended");
    expect(w.snapshot()).toBeNull();
    expect(w.awaited()).toBeNull();
  });

  it("offers nothing for a craft with no route, or a delay (real or estimated) too short to wait out", () => {
    const { state, w } = switched({ estimate: 2 });
    expect(w.snapshot()).toBeNull();
    state.estimate = 60;
    expect(w.snapshot()?.estimated).toBe(true);
    state.delay = { kind: "none" };
    expect(w.snapshot()).toBeNull();
    state.delay = { kind: "known", seconds: 2 };
    expect(w.snapshot()).toBeNull();
  });

  it("is quiet for the first craft it hears of, which is no switch", () => {
    const { state, w } = watch({ id: "mk1" });
    state.delay = { kind: "known", seconds: 1_800 };
    w.observe();
    expect(w.snapshot()).toBeNull();
  });

  it("drops the strip for the first craft on a switch back to it, since its readings already in flight are shown at once", () => {
    const { state, w } = switched({ estimate: 1_750 });
    expect(w.snapshot()?.vesselName).toBe("Mun Probe");

    // Back to MkI two minutes later: its readings made before the first switch are still arriving and show.
    state.active = { vesselId: "mk1", name: "MkI" };
    state.now = 620;
    state.observed = true;
    expect(w.observe()).toBe("ended");
    expect(w.snapshot()).toBeNull();
    expect(w.awaited()).toBeNull();
  });

  it("announces the wait for a craft switched back to when none of its readings is shown", () => {
    const { state, w } = switched({ estimate: 1_750 });
    state.active = { vesselId: "mk1", name: "MkI" };
    state.now = 620;
    expect(w.observe()).toBeUndefined();
    expect(w.snapshot()).toEqual({
      vesselName: "MkI",
      owltSeconds: 1_750,
      estimated: true,
    });
    expect(w.awaited()).toEqual({ arrivesAtUt: 2_370 });
  });

  it("shows nothing once the craft's own data has arrived and only a delay not yet known keeps it from the screen", () => {
    const { state, w } = switched();
    expect(w.snapshot()).not.toBeNull();

    state.arrived = true;
    expect(w.snapshot()).toBeNull();
    expect(w.awaited()).toBeNull();

    // The wait itself has not ended: it ends when the reading is observed.
    state.arrived = false;
    expect(w.snapshot()).not.toBeNull();
    state.arrived = true;
    state.observed = true;
    expect(w.observe()).toBe("ended");
  });
});
