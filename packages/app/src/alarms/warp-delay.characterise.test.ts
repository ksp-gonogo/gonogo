import { memoryStorage } from "@ksp-gonogo/core/test";
import {
  getWarpState,
  StubTransport,
  setActiveCarriedChannelsForTests,
  setActiveTelemetryClientForTests,
  setActiveTimelineStoreForTests,
  setActiveViewClockForTests,
  TelemetryClient,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { WarpMode } from "@ksp-gonogo/sitrep-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlarmHostService } from "./AlarmHostService";

/**
 * What a warp STOP does to a command centre a light-minute away, measured
 * rather than reasoned about.
 *
 * Two facts are pinned here. The first is still a defect, written as
 * characterisation so the tree stays honest about what it does today: the day
 * it is fixed, this file goes red and is the place the fix is recorded. The
 * second WAS one and is now the assertion that it stays fixed.
 *
 * ## 1. The channel's `DelayRole` does not decide when the client can READ it
 *
 * `time.warp` is `DelayRole.TrueNow` as of the 2026-09-11 ruling ("warp has to
 * be truenow, it's a meta state, effectively scene 'changing'"). On the mod that
 * is real and load-bearing: `ChannelEngine.RevealDelayFor` returns 0 and the
 * topic rides `MetaVantage`, so the frame reaches the wire on the tick it was
 * captured instead of a light-time later.
 *
 * It buys the client nothing, because nothing on the client is delay-role
 * aware. `TimelineStore.sample` reads EVERY topic at the frame's frozen
 * `viewUt`, and `ViewClock.viewUt()` in confirmed mode is
 * `min(utNowEstimate() - delaySeconds(), maxSampleUt)`. A frame stamped
 * `validAt = <true now>` is therefore unreadable until view time has crawled
 * the whole one-way light time up to it, whether it arrived instantly or was
 * held back by the reveal gate for exactly that long. The two wire shapes are
 * run side by side below and produce the same number, which is the proof: the
 * classification is correct on the merits and inert at the read.
 *
 * This is not specific to warp. Every TrueNow channel in the mod (career funds,
 * uplink health, the RP-1 ground state, `system.*`) is read a light-time late
 * for the same structural reason. It has never been visible because a craft in
 * Kerbin orbit has a light-time of milliseconds.
 *
 * ## 2. A warp-to session ENDS on a stop it did not ask for (fixed)
 *
 * `WarpControl.reconcile` used to re-command the ladder whenever the observed
 * index differed from the computed target. While the client still believed warp
 * was elevated the two agreed and it commanded nothing; the moment the stop
 * surfaced they disagreed and the client warped back up, undoing the stop from
 * the operator's own screen at exactly `t0 + owlt`.
 *
 * Fixing (1) would only have made that PROMPT rather than late, so the fix is in
 * the controller: it remembers the index it asked for and the reading that was
 * current when it asked, and a reading that has moved to 0 on its own ends the
 * session rather than being reconciled against. It ends WITHOUT a second
 * `SetWarp(0)`, because the warp is already stopped.
 *
 * The same memory is what stops the controller re-dispatching while it is blind.
 * Measured on this fixture before the fix: 120 and 122 `time.setWarpIndex`
 * dispatches across one session, where one is correct.
 */

/** One-way light time, seconds. A craft four minutes out. */
const OWLT = 240;
const UT_START = 10_000;
/** The UT the game's own warp drops to index 0, for a reason the client did not cause. */
const UT_STOP = 10_400;
const UT_END = UT_STOP + 2 * OWLT;
/** UT (and wall) seconds per simulated step, and the host's tick interval. */
const DT = 4;

/**
 * The two wire shapes under test, as the mod produces them.
 *
 * Both stamp `deliveredAt` with the true UT at send (`ChannelEngine` uses
 * `_clock.Now()`), which is what anchors the client's UT/wall fit. They differ
 * only in the UT the payload was captured at, which is what a reveal gate
 * changes: a `Delayed` channel's newest frame is a light-time old on arrival, a
 * `TrueNow` channel's is current.
 */
const WIRE_SHAPES = {
  delayed: (trueUt: number) => trueUt - OWLT,
  truenow: (trueUt: number) => trueUt,
} as const;

type WireShape = keyof typeof WIRE_SHAPES;

/** The index a `time.setWarpIndex` dispatch is asking for, or null when the args do not carry one. */
function commandedIndex(args: unknown): number | null {
  if (typeof args !== "object" || args === null) return null;
  if (!("index" in args)) return null;
  const index = args.index;
  return typeof index === "number" ? index : null;
}

interface WarpSession {
  /** Advance the world to `trueUt` and publish the frames the mod would have sent by then. */
  emitAt(ut: number): void;
  /** The game's own warp index, as the command handler and the scripted stop leave it. */
  gameIndex(): number;
  /** Force the game's warp to `index` at the current true UT, as the game itself would. */
  forceIndex(ut: number, index: number): void;
  /** The true UTs at which the client's commands actually changed the game's warp. */
  commandedAt: readonly number[];
  /**
   * The true UT of every `time.setWarpIndex` the client dispatched, including
   * the ones that asked for the index the game was already at.
   *
   * Separate from `commandedAt` because the game silently absorbs a redundant
   * command, so counting only the ones that moved the warp hides a controller
   * re-sending the same index on every tick for a whole light-time.
   */
  dispatchedAt: readonly number[];
}

/**
 * A stream that behaves the way the mod does at a non-zero delay: a `Delayed`
 * vessel channel always flowing to anchor the view clock, and `time.warp`
 * published under whichever wire shape is being measured.
 *
 * The game's warp index is real state here, not a script: the client's
 * `time.setWarpIndex` dispatches move it, so "the client undid the stop" is
 * something the fixture can be asked rather than inferred.
 */
function startSession(shape: WireShape): WarpSession {
  const capturedAtFor = WIRE_SHAPES[shape];
  let wall = 0;
  let trueUt = UT_START;
  let index = 0;
  /** Every change to the game's warp index, so a frame captured in the past carries the value it had then. */
  const timeline: { ut: number; index: number }[] = [
    { ut: UT_START - OWLT - 1, index: 0 },
  ];
  const commandedAt: number[] = [];
  const dispatchedAt: number[] = [];

  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  client.setDelaySource(() => OWLT);
  transport.setCommandHandler((command, args) => {
    if (command === "time.setWarpIndex") {
      const commanded = commandedIndex(args);
      if (commanded !== null) dispatchedAt.push(trueUt);
      if (commanded !== null && commanded !== index) {
        commandedAt.push(trueUt);
        index = commanded;
        timeline.push({ ut: trueUt, index });
      }
    }
    return null;
  });

  const clock = new ViewClock({
    nowWall: () => wall,
    warpRate: () => 1,
    delaySeconds: () => OWLT,
  });
  const store = new TimelineStore(clock);
  client.attachStore(store);
  setActiveTimelineStoreForTests(store);
  setActiveTelemetryClientForTests(client);
  setActiveViewClockForTests(clock);
  setActiveCarriedChannelsForTests(new Set(["time.setWarpIndex"]));
  client.subscribe("time.warp", () => {});
  client.subscribe("vessel.identity", () => {});

  function indexAtCapture(ut: number): number {
    let found = 0;
    for (const entry of timeline) if (entry.ut <= ut) found = entry.index;
    return found;
  }

  return {
    commandedAt,
    dispatchedAt,
    gameIndex: () => index,
    forceIndex: (ut, next) => {
      index = next;
      timeline.push({ ut, index: next });
    },
    emitAt(ut) {
      trueUt = ut;
      wall = ut - UT_START;
      // An ordinary Delayed vessel channel, always arriving. It is what puts a
      // true-now `deliveredAt` into the client's fit in a real session, so the
      // measurement never depends on warp being alone on the wire.
      transport.emit(
        "vessel.identity",
        { name: "Probe" },
        { validAt: ut - OWLT, deliveredAt: ut },
      );
      const capturedAt = capturedAtFor(ut);
      const captured = indexAtCapture(capturedAt);
      transport.emit(
        "time.warp",
        {
          warpRate: captured === 0 ? 1 : 1000,
          warpRateIndex: captured,
          /* A STOCK install, said out loud: the client no longer assumes a
             ladder, so a fixture that omits the table is modelling a game whose
             rungs have no known meaning. Rung 5 is the 1000x this fixture
             already reported itself running at. */
          warpRates: [1, 5, 10, 50, 100, 1000, 10000, 100000],
          warpMode: WarpMode.High,
          paused: false,
        },
        { validAt: capturedAt, deliveredAt: ut },
      );
      store.beginFrame();
    },
  };
}

describe("warp at a light-minute", () => {
  let nowMs: number;

  beforeEach(() => {
    vi.useFakeTimers();
    nowMs = 1_700_000_000_000;
  });

  afterEach(() => {
    vi.useRealTimers();
    setActiveViewClockForTests(undefined);
    setActiveTimelineStoreForTests(undefined);
    setActiveTelemetryClientForTests(undefined);
    setActiveCarriedChannelsForTests(undefined);
  });

  for (const shape of Object.keys(WIRE_SHAPES) as WireShape[]) {
    it(`surfaces a stop one light-time after it happened (${shape} wire shape)`, () => {
      const session = startSession(shape);
      // The game is already warping when the measurement starts, so a read of
      // 0 can only mean the client has seen the stop.
      session.forceIndex(UT_START - OWLT - 1, 5);
      session.emitAt(UT_START);

      let stopped = false;
      let firstReadAsStopped: number | null = null;
      for (let ut = UT_START + DT; ut <= UT_END; ut += DT) {
        if (!stopped && ut >= UT_STOP) {
          stopped = true;
          session.forceIndex(ut, 0);
        }
        session.emitAt(ut);
        if (
          firstReadAsStopped === null &&
          getWarpState()?.warpRateIndex === 0
        ) {
          firstReadAsStopped = ut;
        }
      }

      // The lag is the whole one-way light time, and it is the SAME lag under
      // both wire shapes. Delivering the frame a light-time earlier changes
      // nothing a reader can see.
      expect(firstReadAsStopped).toBe(UT_STOP + OWLT);
    });

    it(`ends the warp-to session on a stop it did not ask for (${shape} wire shape)`, async () => {
      const session = startSession(shape);
      /* Two frames, so both wire shapes have delivered one the view clock can
         actually read by the time the session starts: under `truenow` a frame
         stamped at the true UT is still a light-time in the view clock's
         future, and the controller commands no warp at all until the game has
         told it what its warp is doing. The subject here is the stop, not the
         first light-time of silence. */
      session.emitAt(UT_START - OWLT);
      session.emitAt(UT_START);

      const svc = new AlarmHostService(null, {
        nowMs: () => nowMs,
        tickIntervalMs: DT * 1000,
        storage: memoryStorage(),
        getOwltSeconds: () => OWLT,
      });
      svc.addAlarm({
        name: "Far",
        trigger: { kind: "time", ut: 1_000_000, leadSeconds: 10 },
      });
      // Ladders up to 1000x: the alarm is far enough that even a light-time of
      // safety margin leaves room for it.
      svc.beginWarpTo();
      // The dispatch settles on a microtask; drain it before the loop so the
      // first command is attributed to UT_START.
      await Promise.resolve();
      await Promise.resolve();
      expect(session.gameIndex()).toBe(5);

      let stopped = false;
      for (let ut = UT_START + DT; ut <= UT_END; ut += DT) {
        // Stopped ONCE, by the game, for a reason the client did not cause.
        if (!stopped && ut >= UT_STOP) {
          stopped = true;
          session.forceIndex(ut, 0);
        }
        session.emitAt(ut);
        nowMs += DT * 1000;
        await vi.advanceTimersByTimeAsync(DT * 1000);
      }
      svc.dispose();

      // One command, the one that started the session. The stop that follows
      // is not one the controller asked for, so it ends the session instead of
      // reconciling against it.
      expect(session.commandedAt).toEqual([UT_START]);
      // And it ends it WITHOUT a second `SetWarp(0)`: the warp is already
      // stopped, and re-commanding it is a second authority for one state.
      expect(session.dispatchedAt).toEqual([UT_START]);
      // The assertion the operator asked for: warp is still 0 two light-times
      // after the game stopped it.
      expect(session.gameIndex()).toBe(0);
    });
  }
});
