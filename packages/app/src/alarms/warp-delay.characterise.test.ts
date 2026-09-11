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
 * Two facts are pinned here, and both of them are defects. They are written as
 * characterisation so the tree stays honest about what it does today: the day
 * either one is fixed, this file goes red and is the place the fix is recorded.
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
 * ## 2. A warp-to session undoes the stop, one light-time late
 *
 * `WarpControl.reconcile` re-commands the ladder whenever the observed index
 * differs from the computed target. While the client still believes warp is
 * elevated the two agree and it commands nothing; the moment the stop finally
 * surfaces they disagree, and the client warps back up. The stop is undone by
 * the operator's own screen at exactly `t0 + owlt`, so warp is NOT 0 at
 * `t0 + 2 x owlt`.
 *
 * Fixing (1) alone would only make the undoing PROMPT rather than late: the
 * controller has to learn that a stop it did not ask for ends the session. That
 * is a controller change and it is not made here.
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

  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  client.setDelaySource(() => OWLT);
  transport.setCommandHandler((command, args) => {
    if (command === "time.setWarpIndex") {
      const commanded = commandedIndex(args);
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

    it(`lets a warp-to session undo the stop at t0 + owlt (${shape} wire shape)`, async () => {
      const session = startSession(shape);
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

      // Nothing while the client still believes warp is elevated, then one
      // command the moment the stop surfaces, which is the stop undone.
      expect(session.commandedAt).toEqual([UT_START, UT_STOP + OWLT]);
      // The assertion the operator asked for, and it does not hold: warp is
      // back at 1000x two light-times after the game stopped it.
      expect(session.gameIndex()).toBe(5);
    });
  }
});
