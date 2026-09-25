import { memoryStorage } from "@ksp-gonogo/core/test";
import {
  resolveValueTopic,
  setActiveTelemetryClientForTests,
  setActiveTimelineStoreForTests,
  setActiveViewClockForTests,
  TelemetryClient,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { WarpMode } from "@ksp-gonogo/sitrep-sdk";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeerMessage } from "../peer/protocol";
import { modFireNotice } from "../test/modFire";
import { AlarmHostService } from "./AlarmHostService";

interface FakeTelemetry {
  set(key: string, v: unknown): void;
  /**
   * Publish a WHOLE Topic record, the only shape the wire has.
   *
   * `set` addresses a field subtopic directly, which no server ever does: it
   * lands a bare literal on a timeline nothing publishes to, so a quantity
   * field never meets the decode's unit wrap. A threshold read off a real
   * Topic goes through the store's field walk into a wrapped payload instead,
   * and that is a different read. This is how a test asks for that one.
   */
  publishTopic(topic: string, record: unknown): void;
  /**
   * Make the game OBEY `time.setWarpIndex`: the observed rate and index become
   * what was commanded, as a real session's do.
   *
   * Off by default, because a fixture that starts answering a question every
   * existing case ignored would change what those cases assert.
   *
   * It is what gives the controller's reading-ORDER logic anything to be about.
   * `WarpControl` records the index it saw AT dispatch, and treats a later
   * reading equal to it as the game not having responded yet. With the game
   * never responding, every reading equals that one for ever, so a stop the
   * controller did not ask for is indistinguishable from a command that has not
   * landed, and the branch that ends a session on an unrequested stop can never
   * be reached.
   */
  obeyWarpCommands(): void;
  calls: string[];
}

/**
 * A dispatched `{command, args}` pair as one readable string, so an assertion
 * can name both what went and which one it was.
 */
function formatCommand(command: string, args: unknown): string {
  if (command === "time.setWarpIndex") {
    return `${command}[${Reflect.get(args ?? {}, "index")}]`;
  }
  if (command === "vessel.control.setActionGroup") {
    const { group, state } = (args ?? {}) as {
      group?: number;
      state?: boolean;
    };
    return `${command}[${group}=${state}]`;
  }
  return command;
}

/**
 * Real stream harness (`StubTransport` + `TelemetryClient` + `TimelineStore`,
 * registered via the non-hook `setActiveTimelineStoreForTests`/
 * `setActiveTelemetryClientForTests`:
 * see `@ksp-gonogo/sitrep-client`'s `context.tsx`): `AlarmHostService`'s warp
 * reads (`getWarpState`), threshold `dataKey` reads (`getValue`), and
 * `contracts.active`/command dispatch (`dispatchActiveCommand`) all ride
 * this same store/client.
 *
 * `set(key, value)` keeps the SAME call shape every test in this file
 * already uses: `t.universalTime` still registers the fake view clock,
 * `t.currentRateIndex`/`t.currentRate` merge into a running `WarpState` and
 * re-publish the whole `time.warp` record (the wire shape `getWarpState`
 * reads), and every other key routes through `mapTopic` onto its stream
 * topic: emitted as a bare literal topic (no derived-channel machinery
 * needed; `AlarmHostService` never reads `vessel.state`/orbit fields).
 */
function fakeTelemetry(): FakeTelemetry {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const store = new TimelineStore(
    new ViewClock({
      nowWall: () => 0,
      warpRate: () => 1,
      delaySeconds: () => 0,
    }),
  );
  client.attachStore(store);

  const calls: string[] = [];
  /* Late-bound because the warp record and the publish helper are declared
     below, and the handler has to be registered before anything dispatches. */
  let onWarpCommand: ((index: number) => void) | null = null;
  transport.setCommandHandler((command, args) => {
    calls.push(formatCommand(command, args));
    if (onWarpCommand && command === "time.setWarpIndex") {
      const index =
        typeof args === "object" && args !== null && "index" in args
          ? args.index
          : undefined;
      if (typeof index === "number") onWarpCommand(index);
    }
    return null;
  });

  setActiveTimelineStoreForTests(store);
  setActiveTelemetryClientForTests(client);

  const subscribed = new Set<string>();
  function ensureSubscribed(topic: string): void {
    if (subscribed.has(topic)) return;
    subscribed.add(topic);
    client.subscribe(topic, () => {});
  }
  function publish(topic: string, value: unknown): void {
    ensureSubscribed(topic);
    transport.emit(topic, value);
    store.beginFrame();
  }

  // Seed the action-group current-value read so `f.ag1`'s toggle -> absolute
  // bridge (`getCurrentValue` in `map-command.ts`) has a real boolean to
  // invert: without it, `buildArgs` returns INVALID and the command never
  // maps at all.
  //
  // Publishes the whole `vessel.control` record (the NAMED action-group list
  // the mod now sends), not the old `vessel.control.actionGroups.0` positional
  // subtopic: identity travels with each entry's `index` now, so the bridge
  // finds the group rather than indexing at a position.
  publish("vessel.control", {
    actionGroups: [{ index: 1, name: "AG1", state: false }],
  });

  /*
   * A STOCK install, said out loud. The ladder these tests assert against is
   * KSP's own, and the client no longer assumes it: `warpRates` is the table the
   * mod reads off `TimeWarp.fetch.warpRates`, so a fixture that omits it is
   * modelling an install whose rungs have no known meaning. Rung 4 is 100x here
   * because this fixture says so, not because the client believes it.
   */
  let warp = {
    warpRate: 1,
    warpRateIndex: 0,
    warpRates: [1, 5, 10, 50, 100, 1000, 10000, 100000],
    warpMode: WarpMode.Unknown,
    paused: false,
  };

  return {
    calls,
    publishTopic: publish,
    obeyWarpCommands() {
      onWarpCommand = (index) => {
        warp = {
          ...warp,
          warpRateIndex: index,
          warpRate: warp.warpRates[index] ?? warp.warpRate,
        };
        publish("time.warp", warp);
      };
    },
    set(key, v) {
      if (key === "t.universalTime" && typeof v === "number") {
        setActiveViewClockForTests({ viewUt: () => v });
        return;
      }
      if (key === "t.currentRateIndex" && typeof v === "number") {
        warp = { ...warp, warpRateIndex: v };
        publish("time.warp", warp);
        return;
      }
      if (key === "t.currentRate" && typeof v === "number") {
        warp = { ...warp, warpRate: v };
        publish("time.warp", warp);
        return;
      }
      const topic = resolveValueTopic("data", key);
      if (topic === undefined) {
        throw new Error(`fakeTelemetry: no stream home for "${key}"`);
      }
      publish(topic, v);
    },
  };
}

type AddCb = (
  peerId: string,
  msg: {
    name: string;
    notes?: string;
    trigger: import("./types").AlarmTrigger;
    onFire?: import("./types").AlarmFireAction[];
  },
) => void;
type UpdateCb = (
  peerId: string,
  msg: {
    id: string;
    patch: Partial<
      Pick<import("./types").Alarm, "name" | "notes" | "trigger" | "onFire">
    >;
  },
) => void;
type IdCb = (peerId: string, id: string) => void;
type VoidCb = (peerId: string) => void;
type PeerConnectCb = (peerId: string) => void;
interface CapturedHost {
  addCb: AddCb | null;
  updateCb: UpdateCb | null;
  deleteCb: IdCb | null;
  ackCb: IdCb | null;
  ackUnscheduledCb: VoidCb | null;
  warpIntentCb: VoidCb | null;
  peerConnectCb: PeerConnectCb | null;
  broadcasts: PeerMessage[];
  // Targeted sendToPeer messages keyed by peerId.
  sentToPeer: Array<{ peerId: string; msg: PeerMessage }>;
}

function makeHost(): {
  host: import("../peer/PeerHostService").PeerHostService;
  captured: CapturedHost;
} {
  const captured: CapturedHost = {
    addCb: null,
    updateCb: null,
    deleteCb: null,
    ackCb: null,
    ackUnscheduledCb: null,
    warpIntentCb: null,
    peerConnectCb: null,
    broadcasts: [],
    sentToPeer: [],
  };
  const host = {
    onAlarmAdd: (cb: AddCb) => {
      captured.addCb = cb;
      return () => {};
    },
    onAlarmUpdate: (cb: UpdateCb) => {
      captured.updateCb = cb;
      return () => {};
    },
    onAlarmDelete: (cb: IdCb) => {
      captured.deleteCb = cb;
      return () => {};
    },
    onAlarmAcknowledge: (cb: IdCb) => {
      captured.ackCb = cb;
      return () => {};
    },
    onAlarmAckUnscheduledWarp: (cb: VoidCb) => {
      captured.ackUnscheduledCb = cb;
      return () => {};
    },
    onAlarmWarpIntent: (cb: VoidCb) => {
      captured.warpIntentCb = cb;
      return () => {};
    },
    onPeerConnect: (cb: PeerConnectCb) => {
      captured.peerConnectCb = cb;
      return () => {};
    },
    /* Cloned, as the wire serialises it. A snapshot holds the host's own alarm
       objects, which it goes on mutating, so a kept reference reads every
       recorded snapshot as the latest state. */
    broadcast: (msg: PeerMessage) => {
      captured.broadcasts.push(structuredClone(msg));
    },
    sendToPeer: (peerId: string, msg: PeerMessage) => {
      captured.sentToPeer.push({ peerId, msg });
    },
  } as import("../peer/PeerHostService").PeerHostService;
  return { host, captured };
}

/** An alarm whose only job is to fire; `fireFromMod` is what fires it. */
const SOME_ALARM = { kind: "time", ut: 5000, leadSeconds: 10 } as const;

/** The simulation fires alarm `id` at `firedAtUt`, the only way any alarm fires. */
function fireFromMod(
  telemetry: FakeTelemetry,
  id: string,
  firedAtUt = 1000,
): void {
  const notice = modFireNotice(id, firedAtUt);
  telemetry.publishTopic(notice.topic, notice.record);
}

/** A threshold the simulation can be asked to watch. */
const ALTITUDE_ABOVE_70KM = {
  kind: "threshold",
  dataKey: "vessel.flight.altitudeAsl",
  op: ">=",
  value: 70_000,
  sustainSeconds: 0,
  topic: "vessel.flight",
  fieldPath: "altitudeAsl",
} as const;

describe("AlarmHostService", () => {
  let nowMs: number;
  beforeEach(() => {
    vi.useFakeTimers();
    nowMs = 1_700_000_000_000;
  });
  afterEach(() => {
    vi.useRealTimers();
    // A case that fails before its own `mockRestore` would otherwise hand its
    // recorded calls to the next case that spies on the same method.
    vi.restoreAllMocks();
    setActiveViewClockForTests(undefined);
    setActiveTimelineStoreForTests(undefined);
    setActiveTelemetryClientForTests(undefined);
  });

  function makeService(owltSeconds = 0): {
    svc: AlarmHostService;
    telemetry: FakeTelemetry;
  } {
    const telemetry = fakeTelemetry();
    telemetry.set("t.universalTime", 1000);
    telemetry.set("t.currentRateIndex", 0);
    telemetry.set("t.currentRate", 1);
    const svc = new AlarmHostService(null, {
      nowMs: () => nowMs,
      tickIntervalMs: 1000,
      storage: memoryStorage(),
      getOwltSeconds: () => owltSeconds,
    });
    return { svc, telemetry };
  }

  it("adds an alarm and surfaces it in the snapshot", async () => {
    const { svc } = makeService();
    svc.addAlarm({
      name: "Circularize",
      trigger: { kind: "time", ut: 2000, leadSeconds: 10 },
    });
    const snap = svc.snapshot();
    expect(snap.alarms).toHaveLength(1);
    expect(snap.alarms[0].name).toBe("Circularize");
    expect(snap.alarms[0].state).toBe("pending");
  });

  /**
   * The simulation stops the warp in the frame an alarm fires, so the fire
   * reaching this side is news of a stop already made. A command from here
   * would be a second authority for the same state, arriving late.
   */
  it("sends no warp command when an alarm fires", async () => {
    const { svc, telemetry } = makeService();
    const alarm = svc.addAlarm({
      name: "Tank",
      trigger: { ...ALTITUDE_ABOVE_70KM },
    });
    telemetry.set("t.currentRateIndex", 4);
    telemetry.set("t.currentRate", 50);
    telemetry.calls.length = 0;

    fireFromMod(telemetry, alarm.id);
    await vi.advanceTimersByTimeAsync(1100);

    expect(svc.snapshot().alarms[0].state).toBe("firing");
    expect(telemetry.calls).not.toContain("time.setWarpIndex[0]");
  });

  it("leaves a time alarm alone, because the mod decides when it comes due", async () => {
    const { svc, telemetry } = makeService();
    svc.addAlarm({
      name: "Burn",
      trigger: { kind: "time", ut: 1005, leadSeconds: 10 },
    });
    // Warping at 50x, so a client that still evaluated this would have
    // something to drop and would be seen dropping it.
    telemetry.set("t.currentRateIndex", 4);
    telemetry.set("t.currentRate", 50);
    telemetry.set("t.universalTime", 1006);
    await vi.advanceTimersByTimeAsync(1100);

    expect(svc.snapshot().alarms[0].state).toBe("pending");
    expect(telemetry.calls).not.toContain("time.setWarpIndex[0]");
  });

  it("flags unscheduled warp when none is set and the user didn't announce intent", async () => {
    const { svc, telemetry } = makeService();
    telemetry.set("t.universalTime", 1200);
    telemetry.set("t.currentRateIndex", 3);
    telemetry.set("t.currentRate", 10);
    await vi.advanceTimersByTimeAsync(1100);
    expect(svc.snapshot().unscheduledWarp).not.toBeNull();
  });

  it("suppresses the unscheduled-warp flag when a station just announced a warp intent", async () => {
    const { svc, telemetry } = makeService();
    svc.registerStationWarpIntent();
    telemetry.set("t.currentRateIndex", 3);
    telemetry.set("t.currentRate", 10);
    await vi.advanceTimersByTimeAsync(1100);
    expect(svc.snapshot().unscheduledWarp).toBeNull();
  });

  /**
   * The local half of the warp-intent fix: this is what the screen's own warp
   * control reaches through `WarpIntentProvider`, and it must quiet THIS
   * observer.
   */
  it("suppresses its own flag when the screen announces its own warp intent", async () => {
    const { svc, telemetry } = makeService();
    svc.announceWarpIntent();
    telemetry.set("t.currentRateIndex", 3);
    telemetry.set("t.currentRate", 10);
    await vi.advanceTimersByTimeAsync(1100);
    expect(svc.snapshot().unscheduledWarp).toBeNull();
  });

  /**
   * The property the operator asked for, and the reason announcing is local
   * rather than broadcast: a command centre must still be told about a warp it
   * did not ask for, because it "won't necessarily know what a pilot is doing".
   *
   * Two services stand in for two screens watching the same game. One announces
   * and goes quiet; the other never heard, and must still raise its flag.
   */
  it("leaves another screen's observer flagging a warp it never heard about", async () => {
    const mine = makeService();
    const theirs = makeService();

    mine.svc.announceWarpIntent();
    for (const s of [mine, theirs]) {
      s.telemetry.set("t.universalTime", 1200);
      s.telemetry.set("t.currentRateIndex", 3);
      s.telemetry.set("t.currentRate", 10);
    }
    await vi.advanceTimersByTimeAsync(1100);

    expect(mine.svc.snapshot().unscheduledWarp).toBeNull();
    expect(theirs.svc.snapshot().unscheduledWarp).not.toBeNull();
  });

  it("persists alarms across service instances", async () => {
    const storage = memoryStorage();
    const telemetry = fakeTelemetry();
    telemetry.set("t.universalTime", 1000);
    const a = new AlarmHostService(null, {
      nowMs: () => nowMs,
      storage,
    });
    a.addAlarm({
      name: "A",
      trigger: { kind: "time", ut: 2000, leadSeconds: 10 },
    });
    a.addAlarm({
      name: "B",
      trigger: { kind: "time", ut: 3000, leadSeconds: 10 },
    });
    a.dispose();

    const b = new AlarmHostService(null, {
      nowMs: () => nowMs,
      storage,
    });
    expect(
      b
        .snapshot()
        .alarms.map((x) => x.name)
        .sort(),
    ).toEqual(["A", "B"]);
  });

  it("persists onFire alongside the alarm and round-trips through reload", async () => {
    const storage = memoryStorage();
    const telemetry = fakeTelemetry();
    telemetry.set("t.universalTime", 1000);
    const a = new AlarmHostService(null, {
      nowMs: () => nowMs,
      storage,
    });
    a.addAlarm({
      name: "Stage",
      trigger: { kind: "time", ut: 2000, leadSeconds: 10 },
      onFire: [{ kind: "action-group", action: "AG1" }],
    });
    a.dispose();

    const b = new AlarmHostService(null, {
      nowMs: () => nowMs,
      storage,
    });
    expect(b.snapshot().alarms[0].onFire).toEqual([
      { kind: "action-group", action: "AG1" },
    ]);
  });

  it("loads pre-onFire persisted alarms cleanly with onFire undefined", async () => {
    // A record with no `onFire` field seeded directly into storage: it loads
    // with onFire undefined and is a no-side-effect alarm.
    const storage = memoryStorage();
    storage.setItem(
      "gonogo.alarms.list",
      JSON.stringify([
        {
          id: "legacy-1",
          name: "Legacy",
          state: "pending",
          createdBy: "main",
          createdAt: 1_700_000_000_000,
          trigger: { kind: "time", ut: 5000, leadSeconds: 10 },
        },
      ]),
    );
    const telemetry = fakeTelemetry();
    telemetry.set("t.universalTime", 1000);
    const svc = new AlarmHostService(null, {
      nowMs: () => nowMs,
      storage,
    });
    const alarms = svc.snapshot().alarms;
    expect(alarms).toHaveLength(1);
    expect(alarms[0].name).toBe("Legacy");
    expect(alarms[0].onFire).toBeUndefined();
  });

  describe("onFire side effects", () => {
    it("dispatches each onFire action via the telemetry execute path on transition to firing", async () => {
      const { svc, telemetry } = makeService();
      const alarm = svc.addAlarm({
        name: "Stage at 70km",
        trigger: { ...SOME_ALARM },
        onFire: [
          { kind: "action-group", action: "AG1" },
          { kind: "action-group", action: "Stage" },
        ],
      });
      fireFromMod(telemetry, alarm.id);
      telemetry.set("t.universalTime", 1100);
      await vi.advanceTimersByTimeAsync(1100);
      // Drain the dispatch microtasks (telemetry.execute is awaited).
      // Drain microtasks (telemetry.execute is async). Don't use
      // runAllTimersAsync: the host's own tick interval would loop
      // forever under fake timers.
      await Promise.resolve();
      await Promise.resolve();
      expect(telemetry.calls).toContain(
        "vessel.control.setActionGroup[1=true]",
      );
      expect(telemetry.calls).toContain("vessel.control.stage");
      // Order preserved.
      const ag1Idx = telemetry.calls.indexOf(
        "vessel.control.setActionGroup[1=true]",
      );
      const stageIdx = telemetry.calls.indexOf("vessel.control.stage");
      expect(ag1Idx).toBeLessThan(stageIdx);
    });

    it("does not call execute for alarms without onFire", async () => {
      const { svc, telemetry } = makeService();
      const alarm = svc.addAlarm({
        name: "Just notify",
        trigger: { ...SOME_ALARM },
      });
      fireFromMod(telemetry, alarm.id);
      await vi.advanceTimersByTimeAsync(1100);
      // Drain microtasks (telemetry.execute is async). Don't use
      // runAllTimersAsync: the host's own tick interval would loop
      // forever under fake timers.
      await Promise.resolve();
      await Promise.resolve();
      // It fired, or an empty list would say nothing about onFire at all.
      expect(svc.snapshot().alarms[0].state).toBe("firing");
      expect(telemetry.calls).toEqual([]);
    });
  });

  /**
   * The simulation judges every alarm. A reading crossing on this screen is a
   * light-time old and is not the verdict, so it moves nothing here.
   */
  it("never judges a threshold from its own reading", async () => {
    const { svc, telemetry } = makeService();
    svc.addAlarm({ name: "70km", trigger: { ...ALTITUDE_ABOVE_70KM } });
    telemetry.publishTopic("vessel.flight", { altitudeAsl: 70_500 });
    telemetry.set("t.universalTime", 1100);
    await vi.advanceTimersByTimeAsync(1100);

    expect(svc.snapshot().alarms[0].state).toBe("pending");
    expect(svc.snapshot().alarms[0].matchSinceUT).toBeNull();
  });

  it("drops a saved alarm in any shape but today's, and keeps the rest", async () => {
    const storage = memoryStorage();
    const today = {
      id: "today",
      name: "Burn",
      state: "pending",
      createdBy: "main",
      createdAt: 1_700_000_000_000,
      trigger: { kind: "time", ut: 5000, leadSeconds: 10 },
    };
    storage.setItem(
      "gonogo.alarms.list",
      JSON.stringify([
        today,
        // Top-level instant, from before triggers existed.
        { id: "v1", name: "Old", ut: 2500, leadSeconds: 10, state: "pending" },
        // A threshold with no Topic address, which nothing could watch.
        {
          ...today,
          id: "addressless",
          trigger: {
            kind: "threshold",
            dataKey: "vessel.state.altitudeAsl",
            op: ">=",
            value: 70_000,
            sustainSeconds: 0,
          },
        },
        // A kind that no longer exists.
        {
          ...today,
          id: "event",
          trigger: { kind: "event", topic: "kerbcast.events" },
        },
      ]),
    );
    const svc = new AlarmHostService(null, {
      nowMs: () => nowMs,
      storage,
    });

    expect(svc.snapshot().alarms.map((a) => a.id)).toEqual(["today"]);
    svc.dispose();
  });

  describe("warp-to manual session", () => {
    it("does nothing when there are no eligible alarms", async () => {
      const { svc, telemetry } = makeService();
      svc.beginWarpTo();
      // Command dispatch settles on a microtask: drain it before any
      // `telemetry.calls` assertion that follows.
      await Promise.resolve();
      await Promise.resolve();
      expect(svc.snapshot().warpTo).toBeNull();
      expect(telemetry.calls).toEqual([]);
    });

    it("does not start on a list with no time alarm, since the simulation stops the warp for the rest", async () => {
      const { svc, telemetry } = makeService();
      svc.addAlarm({ name: "Threshold", trigger: { ...ALTITUDE_ABOVE_70KM } });
      svc.beginWarpTo();
      await Promise.resolve();
      await Promise.resolve();
      expect(svc.snapshot().warpTo).toBeNull();
      expect(telemetry.calls).toEqual([]);
    });

    it("targets the highest ladder rate that respects the safety margin", async () => {
      const { svc, telemetry } = makeService();
      // utNow=1000, alarm at ut=100_000 lead=10
      // remaining=98_990; default margin=10 → maxRate=9899 → 1000× (idx 5)
      const a = svc.addAlarm({
        name: "Far",
        trigger: { kind: "time", ut: 100_000, leadSeconds: 10 },
      });
      svc.beginWarpTo();
      // Command dispatch settles on a microtask: drain it before any
      // `telemetry.calls` assertion that follows.
      await Promise.resolve();
      await Promise.resolve();
      expect(svc.snapshot().warpTo).toEqual({
        alarmId: a.id,
        targetIndex: 5,
        targetRate: 1000,
      });
      expect(telemetry.calls).toContain("time.setWarpIndex[5]");
    });

    /*
     * The margin is a REAL-TIME buffer and knew nothing about light-time, so a
     * craft four minutes away kept warping until the alarm was ten seconds off
     * the VIEW clock, by which point the craft had been past the event for
     * most of a light-time. A warp window cannot be aborted from inside, so
     * the light-time becomes the floor on how much room to leave.
     */
    it("leaves a light-time of room on a delayed craft, not the configured margin", async () => {
      const owlt = 240;
      const { svc, telemetry } = makeService(owlt);
      // Same alarm as the test above: remaining=98_990. At the default margin
      // of 10 that allowed 1000× (idx 5); against the 240s light-time the
      // ladder tops out at 100× (idx 4).
      svc.addAlarm({
        name: "Far",
        trigger: { kind: "time", ut: 100_000, leadSeconds: 10 },
      });
      svc.beginWarpTo();
      await Promise.resolve();
      await Promise.resolve();
      expect(svc.snapshot().warpTo?.targetIndex).toBe(4);
      expect(telemetry.calls).toContain("time.setWarpIndex[4]");
    });

    it("steps the rate down as remaining time shrinks", async () => {
      const { svc, telemetry } = makeService();
      // utNow=1000, ut=11_000, lead=10
      // remaining=9990 → maxRate=999 → 100× (idx 4)
      svc.addAlarm({
        name: "Approaching",
        trigger: { kind: "time", ut: 11_000, leadSeconds: 10 },
      });
      svc.beginWarpTo();
      // Command dispatch settles on a microtask: drain it before any
      // `telemetry.calls` assertion that follows.
      await Promise.resolve();
      await Promise.resolve();
      expect(svc.snapshot().warpTo?.targetIndex).toBe(4);

      // Advance UT to 10_000 → remaining=990 → maxRate=99 → 50× (idx 3)
      telemetry.set("t.universalTime", 10_000);
      await vi.advanceTimersByTimeAsync(1100);
      expect(svc.snapshot().warpTo?.targetIndex).toBe(3);

      /* The ladder is what this case is about and it ends here. The hand-back
         is the case below, which needs the game to answer commands before a
         stop can be told from a command that has not landed. */
    });

    /**
     * The hand-back, which #39 turned from an edge case into the NORMAL end of
     * every warp-to session: the mod stops the warp in the frame it decides to,
     * and this side's job is to stop driving rather than argue.
     *
     * Two things are asserted and the second is the point. The session ends,
     * AND no warp command is issued on the way out: the game is already at zero,
     * so a command from here would be a second authority for one piece of state
     * and would arrive after the fact.
     *
     * `obeyWarpCommands` is what makes this expressible at all. Until the game
     * answers a command, every reading equals the one seen at dispatch, and
     * `WarpControl` cannot tell a stop it did not ask for from a command that
     * has not landed yet.
     */
    it("ends the session on a stop it did not ask for, and sends no command", async () => {
      const { svc, telemetry } = makeService();
      telemetry.obeyWarpCommands();
      svc.addAlarm({
        name: "Approaching",
        trigger: { kind: "time", ut: 11_000, leadSeconds: 10 },
      });
      svc.beginWarpTo();
      await Promise.resolve();
      await Promise.resolve();
      expect(svc.snapshot().warpTo?.targetIndex).toBe(4);

      // The game obeyed and the ladder stepped down, so the reading has moved on from the one seen at the first dispatch.
      telemetry.set("t.universalTime", 10_000);
      await vi.advanceTimersByTimeAsync(1100);
      expect(svc.snapshot().warpTo?.targetIndex).toBe(3);

      // Now the mod stops the warp, which this side never asked for.
      telemetry.calls.length = 0;
      telemetry.set("t.currentRateIndex", 0);
      telemetry.set("t.currentRate", 1);
      await vi.advanceTimersByTimeAsync(1100);

      expect(svc.snapshot().warpTo).toBeNull();
      expect(telemetry.calls).not.toContain("time.setWarpIndex[0]");
    });

    it("retargets to a sooner alarm added mid-session", async () => {
      const { svc } = makeService();
      const far = svc.addAlarm({
        name: "Far",
        trigger: { kind: "time", ut: 100_000, leadSeconds: 10 },
      });
      svc.beginWarpTo();
      // Command dispatch settles on a microtask: drain it before any
      // `telemetry.calls` assertion that follows.
      await Promise.resolve();
      await Promise.resolve();
      expect(svc.snapshot().warpTo?.alarmId).toBe(far.id);

      // Add a sooner alarm: next tick should retarget and pick a lower
      // safe rate based on its earlier UT.
      const near = svc.addAlarm({
        name: "Near",
        trigger: { kind: "time", ut: 11_000, leadSeconds: 10 },
      });
      await vi.advanceTimersByTimeAsync(1100);
      expect(svc.snapshot().warpTo?.alarmId).toBe(near.id);
      expect(svc.snapshot().warpTo?.targetIndex).toBe(4); // 100×
    });

    it("does not slow the ladder for a pending threshold, which the simulation stops the warp for", async () => {
      const { svc } = makeService();
      svc.addAlarm({
        name: "Far",
        trigger: { kind: "time", ut: 100_000, leadSeconds: 10 },
      });
      svc.addAlarm({ name: "Threshold", trigger: { ...ALTITUDE_ABOVE_70KM } });
      svc.beginWarpTo();
      await Promise.resolve();
      await Promise.resolve();
      // The same 1000× (idx 5) the far alarm allows on its own.
      expect(svc.snapshot().warpTo?.targetIndex).toBe(5);
    });

    it("auto-cancels when the last pending time alarm is deleted", async () => {
      const { svc } = makeService();
      const a = svc.addAlarm({
        name: "Far",
        trigger: { kind: "time", ut: 100_000, leadSeconds: 10 },
      });
      svc.beginWarpTo();
      // Command dispatch settles on a microtask: drain it before any
      // `telemetry.calls` assertion that follows.
      await Promise.resolve();
      await Promise.resolve();
      expect(svc.snapshot().warpTo).not.toBeNull();
      svc.deleteAlarm(a.id);
      await vi.advanceTimersByTimeAsync(1100);
      expect(svc.snapshot().warpTo).toBeNull();
    });

    it("cancelWarpTo issues t.timeWarp[0] and clears state", async () => {
      const { svc, telemetry } = makeService();
      svc.addAlarm({
        name: "Far",
        trigger: { kind: "time", ut: 100_000, leadSeconds: 10 },
      });
      svc.beginWarpTo();
      // Command dispatch settles on a microtask: drain it before any
      // `telemetry.calls` assertion that follows.
      await Promise.resolve();
      await Promise.resolve();
      telemetry.calls.length = 0; // isolate the cancel command
      svc.cancelWarpTo();
      await Promise.resolve();
      await Promise.resolve();
      expect(telemetry.calls).toContain("time.setWarpIndex[0]");
      expect(svc.snapshot().warpTo).toBeNull();
    });

    it("respects a larger custom safety margin", async () => {
      const { svc } = makeService();
      svc.setWarpSafetyMargin(100); // 10× the default
      // remaining=98_990; margin=100 → maxRate=989 → 100× (idx 4)
      svc.addAlarm({
        name: "Far",
        trigger: { kind: "time", ut: 100_000, leadSeconds: 10 },
      });
      svc.beginWarpTo();
      // Command dispatch settles on a microtask: drain it before any
      // `telemetry.calls` assertion that follows.
      await Promise.resolve();
      await Promise.resolve();
      expect(svc.snapshot().warpTo?.targetIndex).toBe(4);
    });

    it("clamps the safety margin within bounds", async () => {
      const { svc } = makeService();
      svc.setWarpSafetyMargin(5000);
      expect(svc.snapshot().warpSafetyMarginSeconds).toBe(120);
      svc.setWarpSafetyMargin(0);
      expect(svc.snapshot().warpSafetyMarginSeconds).toBe(1);
    });

    it("persists the safety margin across instances", async () => {
      const storage = memoryStorage();
      const t1 = fakeTelemetry();
      t1.set("t.universalTime", 1000);
      const a = new AlarmHostService(null, {
        nowMs: () => nowMs,
        storage,
      });
      a.setWarpSafetyMargin(30);
      a.dispose();
      const t2 = fakeTelemetry();
      t2.set("t.universalTime", 1000);
      const b = new AlarmHostService(null, {
        nowMs: () => nowMs,
        storage,
      });
      expect(b.snapshot().warpSafetyMarginSeconds).toBe(30);
      b.dispose();
    });

    it("does not flag unscheduled-warp while a warp-to session is active", async () => {
      const { svc, telemetry } = makeService();
      svc.addAlarm({
        name: "Far",
        trigger: { kind: "time", ut: 100_000, leadSeconds: 10 },
      });
      svc.beginWarpTo();
      // Command dispatch settles on a microtask: drain it before any
      // `telemetry.calls` assertion that follows.
      await Promise.resolve();
      await Promise.resolve();
      // Simulate KSP applying the commanded warp.
      telemetry.set("t.currentRateIndex", 5);
      telemetry.set("t.currentRate", 1000);
      // Advance well beyond WARP_INTENT_WINDOW_MS so the legacy intent
      // suppression has lapsed, the warp-to session itself must keep the
      // detector quiet.
      await vi.advanceTimersByTimeAsync(5000);
      expect(svc.snapshot().unscheduledWarp).toBeNull();
    });
  });

  it("updates and deletes alarms", async () => {
    const { svc } = makeService();
    const a = svc.addAlarm({
      name: "Original",
      trigger: { kind: "time", ut: 2000, leadSeconds: 10 },
    });
    svc.updateAlarm(a.id, { name: "Renamed" });
    expect(svc.snapshot().alarms[0].name).toBe("Renamed");
    svc.deleteAlarm(a.id);
    expect(svc.snapshot().alarms).toHaveLength(0);
  });

  describe("peer bridge", () => {
    function makeServiceWithHost(): {
      svc: AlarmHostService;
      telemetry: FakeTelemetry;
      captured: CapturedHost;
    } {
      const telemetry = fakeTelemetry();
      telemetry.set("t.universalTime", 1000);
      telemetry.set("t.currentRateIndex", 0);
      telemetry.set("t.currentRate", 1);
      const { host, captured } = makeHost();
      const svc = new AlarmHostService(host, {
        nowMs: () => nowMs,
        tickIntervalMs: 1000,
        storage: memoryStorage(),
      });
      return { svc, telemetry, captured };
    }

    it("creates an alarm when a peer broadcasts alarm-add (with peerId as createdBy)", async () => {
      const { svc, captured } = makeServiceWithHost();
      expect(captured.addCb).not.toBeNull();
      captured.addCb?.("peer-123", {
        name: "Peer alarm",
        notes: "from station",
        trigger: { kind: "time", ut: 5000, leadSeconds: 10 },
      });
      const alarms = svc.snapshot().alarms;
      expect(alarms).toHaveLength(1);
      expect(alarms[0].name).toBe("Peer alarm");
      expect(alarms[0].notes).toBe("from station");
      expect(alarms[0].createdBy).toBe("peer-123");
    });

    it("patches an alarm when a peer broadcasts alarm-update", async () => {
      const { svc, captured } = makeServiceWithHost();
      const a = svc.addAlarm({
        name: "Original",
        trigger: { kind: "time", ut: 5000, leadSeconds: 10 },
      });
      captured.updateCb?.("peer-1", {
        id: a.id,
        patch: { name: "Renamed by station" },
      });
      expect(svc.snapshot().alarms[0].name).toBe("Renamed by station");
    });

    it("deletes an alarm when a peer broadcasts alarm-delete", async () => {
      const { svc, captured } = makeServiceWithHost();
      const a = svc.addAlarm({
        name: "Doomed",
        trigger: { kind: "time", ut: 5000, leadSeconds: 10 },
      });
      captured.deleteCb?.("peer-1", a.id);
      expect(svc.snapshot().alarms).toHaveLength(0);
    });

    it("clears unscheduled-warp when a peer acknowledges it", async () => {
      const { svc, telemetry, captured } = makeServiceWithHost();
      telemetry.set("t.currentRateIndex", 3);
      telemetry.set("t.currentRate", 10);
      await vi.advanceTimersByTimeAsync(1100);
      expect(svc.snapshot().unscheduledWarp).not.toBeNull();
      captured.ackUnscheduledCb?.("peer-1");
      expect(svc.snapshot().unscheduledWarp).toBeNull();
    });

    it("suppresses unscheduled-warp detection after a peer warp-intent event", async () => {
      const { svc, telemetry, captured } = makeServiceWithHost();
      captured.warpIntentCb?.("peer-1");
      telemetry.set("t.currentRateIndex", 3);
      telemetry.set("t.currentRate", 10);
      await vi.advanceTimersByTimeAsync(1100);
      expect(svc.snapshot().unscheduledWarp).toBeNull();
    });

    it("broadcasts alarm-snapshot on every emit and alarm-fired when an alarm fires", async () => {
      const { svc, telemetry, captured } = makeServiceWithHost();
      const alarm = svc.addAlarm({
        name: "Apoapsis",
        trigger: { ...SOME_ALARM },
      });
      fireFromMod(telemetry, alarm.id);
      await vi.advanceTimersByTimeAsync(1100);
      const types = captured.broadcasts.map((m) => m.type);
      expect(types).toContain("alarm-snapshot");
      expect(types).toContain("alarm-fired");
    });

    it("removes a fired alarm when a peer station acknowledges it", async () => {
      const { svc, telemetry, captured } = makeServiceWithHost();
      const a = svc.addAlarm({
        name: "Apoapsis",
        trigger: { ...SOME_ALARM },
      });
      // Through firing → fired, the only state acknowledgeAlarm accepts.
      fireFromMod(telemetry, a.id);
      await vi.advanceTimersByTimeAsync(1100);
      telemetry.set("t.universalTime", 1100);
      await vi.advanceTimersByTimeAsync(1100);
      expect(svc.snapshot().alarms[0]?.state).toBe("fired");

      expect(captured.ackCb).not.toBeNull();
      captured.ackCb?.("station-peer-id", a.id);
      expect(svc.snapshot().alarms).toHaveLength(0);
    });

    it("carries onFire through alarm-add and dispatches when the alarm fires", async () => {
      const { svc, telemetry, captured } = makeServiceWithHost();
      captured.addCb?.("station-1", {
        name: "Stage at 70km",
        trigger: { ...SOME_ALARM },
        onFire: [{ kind: "action-group", action: "AG1" }],
      });
      fireFromMod(telemetry, svc.snapshot().alarms[0].id);
      await vi.advanceTimersByTimeAsync(1100);
      await Promise.resolve();
      await Promise.resolve();
      expect(svc.snapshot().alarms[0].onFire).toEqual([
        { kind: "action-group", action: "AG1" },
      ]);
      expect(telemetry.calls).toContain(
        "vessel.control.setActionGroup[1=true]",
      );
    });

    it("refuses a station's alarm the simulation could never watch, and makes no row", async () => {
      const { svc, captured } = makeServiceWithHost();
      // What a station on an older build could send, off the wire: no Topic address.
      const trigger = JSON.parse(
        '{"kind":"threshold","dataKey":"kos.cpu.load","op":">","value":1,"sustainSeconds":0}',
      );
      captured.addCb?.("station-1", {
        name: "From a live DataSource",
        trigger,
      });
      expect(svc.snapshot().alarms).toEqual([]);
    });

    // Without this, a station that connects (or refreshes) after the operator
    // added an alarm on main would wait up to one tick before the snapshot
    // arrived, and an alarm firing in that gap could race the fire event. The
    // bridge sends the current snapshot directly to each new peer immediately.
    it("sends the current alarm snapshot to a station as soon as it connects", async () => {
      const { svc, captured } = makeServiceWithHost();
      svc.addAlarm({
        name: "Test alarm",
        trigger: { kind: "time", ut: 9999, leadSeconds: 10 },
      });
      captured.sentToPeer.length = 0;
      captured.peerConnectCb?.("station-late");
      expect(captured.sentToPeer).toHaveLength(1);
      expect(captured.sentToPeer[0].peerId).toBe("station-late");
      const msg = captured.sentToPeer[0].msg;
      if (msg.type !== "alarm-snapshot") {
        throw new Error(`expected an alarm-snapshot, got: ${msg.type}`);
      }
      expect(msg.snapshot.alarms[0].name).toBe("Test alarm");
    });

    it("updates onFire via alarm-update and clears it when the patch carries an empty array", async () => {
      const { svc, captured } = makeServiceWithHost();
      const a = svc.addAlarm({
        name: "Burn",
        trigger: { kind: "time", ut: 5000, leadSeconds: 10 },
      });
      captured.updateCb?.("peer-1", {
        id: a.id,
        patch: { onFire: [{ kind: "action-group", action: "Stage" }] },
      });
      expect(svc.snapshot().alarms[0].onFire).toEqual([
        { kind: "action-group", action: "Stage" },
      ]);
      captured.updateCb?.("peer-1", {
        id: a.id,
        patch: { onFire: [] },
      });
      expect(svc.snapshot().alarms[0].onFire).toBeUndefined();
    });
  });

  describe("firing→fired window", () => {
    it("transitions firing within 2s of learning of the fire and to fired thereafter", async () => {
      const { svc, telemetry } = makeService();
      const alarm = svc.addAlarm({
        name: "Burn",
        trigger: { ...SOME_ALARM },
      });
      // The notice lands: within the 2s firing window.
      telemetry.set("t.universalTime", 1500);
      fireFromMod(telemetry, alarm.id);
      await vi.advanceTimersByTimeAsync(1100);
      expect(svc.snapshot().alarms[0].state).toBe("firing");
      // Still within the window a second later.
      telemetry.set("t.universalTime", 1501);
      await vi.advanceTimersByTimeAsync(1100);
      expect(svc.snapshot().alarms[0].state).toBe("firing");
      // 2s past: transitions to fired.
      telemetry.set("t.universalTime", 1502);
      await vi.advanceTimersByTimeAsync(1100);
      expect(svc.snapshot().alarms[0].state).toBe("fired");
    });
  });

  /**
   * Every route by which an alarm comes to have fired owes the operator the same
   * consequences. The failure this guards against is SILENCE: an alarm whose
   * state says it fired while nothing told anyone.
   */
  describe("a fire is a fact, whatever route delivers it", () => {
    const STAGE = [{ kind: "action-group", action: "AG1" }] as const;

    function warpingTelemetry(ut: number): FakeTelemetry {
      const telemetry = fakeTelemetry();
      telemetry.set("t.universalTime", ut);
      telemetry.set("t.currentRateIndex", 7);
      telemetry.set("t.currentRate", 10000);
      return telemetry;
    }

    it("tells the operator and runs the actions when the notice arrives while it watches", async () => {
      const telemetry = warpingTelemetry(1000);
      const { host, captured } = makeHost();
      const svc = new AlarmHostService(host, {
        nowMs: () => nowMs,
        tickIntervalMs: 1000,
        storage: memoryStorage(),
      });
      const alarm = svc.addAlarm({
        name: "Held above 70 km",
        trigger: { ...ALTITUDE_ABOVE_70KM, sustainSeconds: 60 },
        onFire: [...STAGE],
      });

      fireFromMod(telemetry, alarm.id, 11_000);
      telemetry.set("t.universalTime", 11_000);
      await vi.advanceTimersByTimeAsync(1100);
      telemetry.set("t.universalTime", 21_000);
      await vi.advanceTimersByTimeAsync(1100);
      await Promise.resolve();
      await Promise.resolve();

      const states = captured.broadcasts.flatMap((m) =>
        m.type === "alarm-snapshot"
          ? m.snapshot.alarms
              .filter((a) => a.id === alarm.id)
              .map((a) => a.state)
          : [],
      );
      expect.soft(states).toContain("firing");
      expect
        .soft(
          captured.broadcasts.filter(
            (m) => m.type === "alarm-fired" && m.id === alarm.id,
          ),
        )
        .toHaveLength(1);
      expect
        .soft(
          telemetry.calls.filter(
            (c) => c === "vessel.control.setActionGroup[1=true]",
          ),
        )
        .toHaveLength(1);
      expect.soft(svc.snapshot().alarms[0].actionsWithheld).toBeUndefined();
      expect(svc.snapshot().alarms[0].state).toBe("fired");
      svc.dispose();
    });

    it("tells the operator, and runs no actions, when the mod's notice is replayed as the service starts", async () => {
      const error = vi.spyOn(console, "error");
      const storage = memoryStorage();
      storage.setItem(
        "gonogo.alarms.list",
        JSON.stringify([
          {
            id: "burn",
            name: "Burn",
            state: "pending",
            createdBy: "main",
            createdAt: 1_700_000_000_000,
            matchSinceUT: null,
            trigger: { kind: "time", ut: 4000, leadSeconds: 0 },
            onFire: [...STAGE],
          },
        ]),
      );
      const telemetry = warpingTelemetry(5000);
      telemetry.publishTopic("alarm.scet.fired", {
        id: "burn",
        firedAtUt: 4000,
        vantage: "",
      });
      const { host, captured } = makeHost();
      const svc = new AlarmHostService(host, {
        nowMs: () => nowMs,
        tickIntervalMs: 1000,
        storage,
      });
      telemetry.set("t.universalTime", 5001);
      await vi.advanceTimersByTimeAsync(1100);
      await Promise.resolve();
      await Promise.resolve();

      const states = captured.broadcasts.flatMap((m) =>
        m.type === "alarm-snapshot"
          ? m.snapshot.alarms.filter((a) => a.id === "burn").map((a) => a.state)
          : [],
      );
      expect.soft(error).not.toHaveBeenCalled();
      expect.soft(states).toContain("firing");
      expect
        .soft(
          captured.broadcasts.filter(
            (m) => m.type === "alarm-fired" && m.id === "burn",
          ),
        )
        .toHaveLength(1);
      expect
        .soft(
          telemetry.calls.filter(
            (c) => c === "vessel.control.setActionGroup[1=true]",
          ),
        )
        .toHaveLength(0);
      expect.soft(svc.snapshot().alarms[0].actionsWithheld).toBe(true);
      svc.dispose();
      error.mockRestore();
    });
  });
});
