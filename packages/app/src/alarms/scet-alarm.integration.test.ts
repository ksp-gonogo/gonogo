import { memoryStorage } from "@ksp-gonogo/core/test";
import {
  StubTransport,
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
 * The SCET alarm arm, end to end over the wire, at a delay where the two
 * vantages are far enough apart to tell.
 *
 * ## What is real here and what is a stand-in
 *
 * Everything on the CLIENT side is the production code: the real
 * `AlarmHostService`, the real `ScetAlarmBridge`, the real `TelemetryClient`,
 * `ViewClock` and `TimelineStore`, intercepted only at the transport.
 *
 * The MOD is a stand-in, and deliberately a thin one: it records the arm
 * commands the client sends and publishes the roster and the fire notice the
 * real uplink would. It is NOT a second copy of the firing rule. The rule
 * (latched step-down, latched fire, the instant the notice carries, what a
 * rewind does to a latch) is pinned against the real implementation in
 * `mod/Sitrep.Host.Tests/ScetAlarmRosterTests.cs`; what these tests ask is what
 * the CLIENT does with the frames that come out of it.
 *
 * ## The vantage claim, in two halves
 *
 * At a visible delay the two arms fire a whole light-time apart in true time,
 * and the SCET one is the one that fires when the craft is actually there. At
 * zero delay they must coincide exactly, or the feature has invented a
 * difference where there is none. Both are asserted below.
 */

/** One-way light time, seconds. A craft four minutes out. */
const OWLT = 240;
const UT_START = 10_000;
/** UT (and wall) seconds per simulated step, and the host's tick interval. */
const DT = 20;

type ArmedCondition =
  | { kind: "time"; ut: number; leadSeconds: number }
  | {
      kind: "threshold";
      topic: string;
      fieldPath: string;
      op: number;
      threshold: number;
      sustainSeconds: number;
    };

/** One arm as the stand-in received it: the condition and who it named. */
interface ArmedAlarm {
  condition: ArmedCondition;
  subject: string;
}

/**
 * The Topics this stand-in will accept a threshold against, standing in for
 * `Sitrep.Host.Alarms.ScetThresholdSources`. Deliberately a SHORT list rather
 * than a copy of the real one: what is being exercised is what the client does
 * with a refusal, and a second full copy of the mod's table in a test fixture
 * is the thing the client is not allowed to keep either.
 */
const ADDRESSABLE = new Set(["vessel.flight", "time.warp"]);
/** The craft's guid, as `meta.source` stamps it and `vessel.identity` names it. */
const VESSEL_ID = "6f0a-probe";

interface ModStandIn {
  /** Advance the world to `trueUt`, publish what the mod would have published by then. */
  emitAt(ut: number): void;
  /** Drop and rebuild the client's subscriptions, replaying the last frames as keyframe-on-subscribe does. */
  reconnect(): void;
  /** The game's warp index, as the client's commands and the mod's own stop leave it. */
  gameIndex(): number;
  /** Every `time.setWarpIndex` the client dispatched, by true UT. */
  warpDispatchedAt: readonly number[];
  /** Ids the stand-in mod currently holds armed. */
  armed(): readonly string[];
  /** One arm as the stand-in received it, for asserting on what crossed the wire. */
  armOf(id: string): ArmedAlarm | undefined;
  /** Drive the craft's TRUE altitude, which only the stand-in can see. */
  setAltitude(metres: number): void;
  /** Point the app-wide active-client seam back at this session's client. */
  attach(): void;
  /** The true UT at which the stand-in mod fired each alarm. */
  firedAtTrueUt: readonly { id: string; ut: number }[];
}

/**
 * A stream that behaves the way the mod does at `owlt`: an ordinary delayed
 * vessel channel always flowing to anchor the view clock, the SCET alarm roster
 * and fire notice published TrueNow (stamped at the true UT they were decided
 * at), and the game's warp as real state the client's commands can move.
 */
function startSession(owlt: number): ModStandIn {
  let wall = 0;
  let trueUt = UT_START;
  let warpIndex = 0;
  const warpDispatchedAt: number[] = [];
  const conditions = new Map<string, ArmedAlarm>();
  const steppedDown = new Set<string>();
  const fired = new Set<string>();
  const matchedSince = new Map<string, number>();
  let altitude = 0;
  let lastRoster: unknown[] = [];
  let lastFired: { id: string; firedAtUt: number } | null = null;
  const firedAtTrueUt: { id: string; ut: number }[] = [];

  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  client.setDelaySource(() => owlt);
  transport.setCommandHandler((command, args) => {
    const bag = (args ?? {}) as Record<string, unknown>;
    if (command === "time.setWarpIndex") {
      const index = bag.index;
      if (typeof index === "number") {
        warpDispatchedAt.push(trueUt);
        warpIndex = index;
      }
      return null;
    }
    if (command === "alarm.scet.arm") {
      const id = String(bag.id ?? "");
      const condition = (bag.condition ?? {}) as Record<string, unknown>;
      const threshold = Number(condition.kind ?? 0) === 1;
      if (threshold && !ADDRESSABLE.has(String(condition.topic ?? ""))) {
        /* The real uplink's refusal, verbatim in shape: a Range failure whose
           message names the Topic. It is the ONLY way a client finds out, and
           what this fixture exists to let the client be tested against. */
        throw Object.assign(
          new Error(
            `no SCET threshold can be read from '${String(condition.topic ?? "")}'`,
          ),
          { code: "E_RANGE" },
        );
      }
      conditions.set(id, {
        subject: String(bag.subject ?? ""),
        condition: threshold
          ? {
              kind: "threshold",
              topic: String(condition.topic ?? ""),
              fieldPath: String(condition.fieldPath ?? ""),
              op: Number(condition.op ?? 0),
              threshold: Number(condition.threshold ?? 0),
              sustainSeconds: Number(condition.sustainSeconds ?? 0),
            }
          : {
              kind: "time",
              ut: Number(condition.ut ?? 0),
              leadSeconds: Number(condition.leadSeconds ?? 0),
            },
      });
      steppedDown.delete(id);
      fired.delete(id);
      matchedSince.delete(id);
      return null;
    }
    if (command === "alarm.scet.disarm") {
      conditions.delete(String(bag.id ?? ""));
      return null;
    }
    return null;
  });

  const clock = new ViewClock({
    nowWall: () => wall,
    warpRate: () => 1,
    delaySeconds: () => owlt,
  });
  const store = new TimelineStore(clock);
  client.attachStore(store);
  setActiveTimelineStoreForTests(store);
  setActiveTelemetryClientForTests(client);
  setActiveViewClockForTests(clock);
  subscribe();

  function subscribe(): void {
    client.subscribe("vessel.identity", () => {});
    client.subscribe("time.warp", () => {});
  }

  function publishRoster(): void {
    lastRoster = [...conditions.entries()].map(([id, arm]) => ({
      id,
      name: id,
      armedBy: "ksc",
      subject: arm.subject,
      condition:
        arm.condition.kind === "time"
          ? {
              kind: 0,
              ut: arm.condition.ut,
              leadSeconds: arm.condition.leadSeconds,
            }
          : {
              kind: 1,
              topic: arm.condition.topic,
              fieldPath: arm.condition.fieldPath,
              op: arm.condition.op,
              threshold: arm.condition.threshold,
              sustainSeconds: arm.condition.sustainSeconds,
            },
      state: fired.has(id) ? 1 : 0,
      firedAtUt: null,
    }));
    transport.emit("alarm.scet", lastRoster, {
      validAt: trueUt,
      deliveredAt: trueUt,
    });
  }

  return {
    warpDispatchedAt,
    firedAtTrueUt,
    attach: () => setActiveTelemetryClientForTests(client),
    gameIndex: () => warpIndex,
    armed: () => [...conditions.keys()],
    armOf: (id) => conditions.get(id),
    setAltitude(metres) {
      altitude = metres;
    },
    reconnect() {
      /* What a client sees when it comes back: the reliable lane replays the
         last value on each topic through keyframe-on-subscribe, so the roster
         and the fire notice are re-delivered rather than lost. */
      transport.emit("alarm.scet", lastRoster, {
        validAt: trueUt,
        deliveredAt: trueUt,
      });
      if (lastFired) {
        transport.emit("alarm.scet.fired", lastFired, {
          validAt: trueUt,
          deliveredAt: trueUt,
        });
      }
    },
    emitAt(ut) {
      trueUt = ut;
      wall = ut - UT_START;

      /* Telemetry first, so the view clock is current before the mod's pass:
         the fire notice arrives on this frame and the client stamps the latch
         with the view time it can see WHEN it arrives. In the game both happen
         inside one FixedUpdate; this fixes the order so the assertion is on the
         client's rule rather than on the fixture's arbitrary interleaving.

         `vessel.identity` is an ordinary delayed vessel channel, and it is what
         anchors the view clock's UT/wall fit in a real session. */
      transport.emit(
        "vessel.identity",
        { name: "Probe", vesselId: VESSEL_ID },
        { validAt: ut - owlt, deliveredAt: ut },
      );

      // The mod's pass, on the game's OWN clock: this is the whole point of the
      // arm, and it runs whatever the client can currently see.
      for (const [id, arm] of conditions) {
        if (fired.has(id)) continue;
        const c = arm.condition;
        if (c.kind === "time") {
          if (!steppedDown.has(id) && ut >= c.ut - c.leadSeconds) {
            steppedDown.add(id);
            warpIndex = 0;
          }
          if (ut < c.ut) continue;
        } else {
          /* The reading is the craft's TRUE altitude, which is the whole claim:
             nothing the client can see is consulted. Warp stops at the first
             match and the sustain window is measured in the ticks that follow,
             the same order the roster uses, because a window measured across
             warped ticks would be satisfied by two samples. */
          if (!matches(c, altitude)) {
            matchedSince.delete(id);
            continue;
          }
          if (!matchedSince.has(id)) {
            matchedSince.set(id, ut);
            warpIndex = 0;
          }
          if (ut - (matchedSince.get(id) as number) < c.sustainSeconds)
            continue;
        }
        fired.add(id);
        warpIndex = 0;
        lastFired = { id, firedAtUt: ut };
        firedAtTrueUt.push({ id, ut });
        transport.emit("alarm.scet.fired", lastFired, {
          validAt: ut,
          deliveredAt: ut,
        });
      }

      transport.emit(
        "time.warp",
        {
          warpRate: warpIndex === 0 ? 1 : 1000,
          warpRateIndex: warpIndex,
          /* A STOCK install, said out loud: the client no longer assumes a
             ladder, so a fixture that omits the table is modelling a game whose
             rungs have no known meaning. Rung 5 is the 1000x this fixture
             already reported itself running at. */
          warpRates: [1, 5, 10, 50, 100, 1000, 10000, 100000],
          warpMode: WarpMode.High,
          paused: false,
        },
        // `time.warp` is TrueNow on the mod, so the frame is stamped at the
        // instant it was captured rather than a light-time back.
        { validAt: ut, deliveredAt: ut },
      );
      /* Every tick, where the real channel change-gates and leans on
         keyframe-on-subscribe to catch a late subscriber up. A stub transport
         has no keyframe replay, so publishing unconditionally is what models
         the real arrival pattern rather than a fixture that silently drops the
         only roster a client would ever have seen. */
      publishRoster();
      store.beginFrame();
    },
  };
}

/** The five comparisons this fixture is asked for, by contract ordinal. */
function matches(
  c: Extract<ArmedCondition, { kind: "threshold" }>,
  reading: number,
): boolean {
  switch (c.op) {
    case 0:
      return reading > c.threshold;
    case 1:
      return reading >= c.threshold;
    case 2:
      return reading < c.threshold;
    case 3:
      return reading <= c.threshold;
    case 4:
      return reading === c.threshold;
    default:
      return reading !== c.threshold;
  }
}

describe("SCET alarms", () => {
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
  });

  async function run(session: ModStandIn, untilUt: number): Promise<void> {
    for (let ut = UT_START + DT; ut <= untilUt; ut += DT) {
      session.emitAt(ut);
      nowMs += DT * 1000;
      await vi.advanceTimersByTimeAsync(DT * 1000);
    }
  }

  it("arms on the mod, and disarms an entry the mod holds that we do not", async () => {
    const session = startSession(OWLT);
    session.emitAt(UT_START);
    const svc = new AlarmHostService(null, {
      nowMs: () => nowMs,
      tickIntervalMs: DT * 1000,
      storage: memoryStorage(),
      getOwltSeconds: () => OWLT,
    });

    const alarm = svc.addAlarm({
      name: "Apoapsis",
      trigger: { kind: "time", ut: 90_000, leadSeconds: 10, vantage: "scet" },
    });
    await run(session, UT_START + 4 * DT);
    expect(session.armed()).toEqual([alarm.id]);

    // Deleting it here is what a reconnecting client's reconciliation does to a
    // roster row it no longer recognises: the same disarm, from the same diff.
    svc.deleteAlarm(alarm.id);
    await run(session, UT_START + 8 * DT);
    expect(session.armed()).toEqual([]);
    svc.dispose();
  });

  it("does not arm a command-vantage alarm on the mod", async () => {
    const session = startSession(OWLT);
    session.emitAt(UT_START);
    const svc = new AlarmHostService(null, {
      nowMs: () => nowMs,
      tickIntervalMs: DT * 1000,
      storage: memoryStorage(),
      getOwltSeconds: () => OWLT,
    });

    svc.addAlarm({
      name: "Ordinary",
      trigger: { kind: "time", ut: 90_000, leadSeconds: 10 },
    });
    await run(session, UT_START + 4 * DT);
    expect(session.armed()).toEqual([]);
    svc.dispose();
  });

  it("fires the two vantages one light-time apart, and the SCET one when the craft is there", async () => {
    const session = startSession(OWLT);
    session.emitAt(UT_START);
    const svc = new AlarmHostService(null, {
      nowMs: () => nowMs,
      tickIntervalMs: DT * 1000,
      storage: memoryStorage(),
      getOwltSeconds: () => OWLT,
    });

    /* The same instant, asked for two ways. The SCET alarm fires when the GAME
       reaches it; the command-vantage one when the operator's own clock does,
       which is a light-time later in true time, by which point the craft has
       been past the moment for four minutes. That gap IS the feature. */
    const target = UT_START + 200;
    const scet = svc.addAlarm({
      name: "SCET",
      trigger: { kind: "time", ut: target, leadSeconds: 0, vantage: "scet" },
    });
    const command = svc.addAlarm({
      name: "Command",
      trigger: { kind: "time", ut: target, leadSeconds: 0 },
    });

    const firedAt = new Map<string, number>();
    let ut = UT_START;
    const observe = () => {
      for (const a of svc.snapshot().alarms) {
        if (a.state !== "pending" && !firedAt.has(a.id)) firedAt.set(a.id, ut);
      }
    };
    for (ut = UT_START + DT; ut <= target + OWLT + 4 * DT; ut += DT) {
      session.emitAt(ut);
      nowMs += DT * 1000;
      await vi.advanceTimersByTimeAsync(DT * 1000);
      observe();
    }
    svc.dispose();

    expect(firedAt.get(scet.id)).toBe(target);
    expect(firedAt.get(command.id)).toBe(target + OWLT);
  });

  it("records the instant on the craft's clock, not the one it was told at", async () => {
    const session = startSession(OWLT);
    session.emitAt(UT_START);
    const svc = new AlarmHostService(null, {
      nowMs: () => nowMs,
      tickIntervalMs: DT * 1000,
      storage: memoryStorage(),
      getOwltSeconds: () => OWLT,
    });

    const target = UT_START + 100;
    const alarm = svc.addAlarm({
      name: "SCET",
      trigger: { kind: "time", ut: target, leadSeconds: 0, vantage: "scet" },
    });
    await run(session, target + 4 * DT);

    const row = svc.snapshot().alarms.find((a) => a.id === alarm.id);
    // The banner window runs on the clock the operator is watching, and the
    // instant it NAMES is the craft's. The two are a light-time apart and both
    // have to be kept, which is exactly what `eventUT` exists for.
    expect(row?.eventUT).toBe(target);
    expect(row?.matchSinceUT).toBe(target - OWLT);
    svc.dispose();
  });

  it("leaves the warp stopped, and sends no warp command of its own", async () => {
    const session = startSession(OWLT);
    session.emitAt(UT_START);
    const svc = new AlarmHostService(null, {
      nowMs: () => nowMs,
      tickIntervalMs: DT * 1000,
      storage: memoryStorage(),
      getOwltSeconds: () => OWLT,
    });

    /* Far enough out that the ladder has somewhere to climb: the controller
       leaves `max(margin, owlt)` of real time at the end, so an alarm inside a
       few light-times of now is one it simply holds at 1x. */
    const target = UT_START + 3000;
    svc.addAlarm({
      name: "SCET",
      trigger: { kind: "time", ut: target, leadSeconds: 0, vantage: "scet" },
    });
    // Give the arm a tick to reach the mod before the ladder starts.
    await run(session, UT_START + 2 * DT);
    svc.beginWarpTo();
    await vi.advanceTimersByTimeAsync(0);
    await run(session, UT_START + 4 * DT);
    expect(session.gameIndex()).toBeGreaterThan(0);

    // Two light-times past the fire: long enough for the stop to surface in
    // `time.warp` and for the controller to have had every chance to argue.
    await run(session, target + 2 * OWLT);
    svc.dispose();

    // The single assertion the whole warp half of this feature is for.
    expect(session.gameIndex()).toBe(0);
    /* And nothing was commanded from here at or after the fire: the mod
       stopped the warp in the same frame it decided to, so a second command is
       a second authority for one piece of state, and one issued a light-time
       later would undo the stop from the operator's own screen. */
    const firedAt = session.firedAtTrueUt[0]?.ut;
    expect(firedAt).toBe(target);
    expect(
      session.warpDispatchedAt.filter((at) => at >= (firedAt as number)),
    ).toEqual([]);
    // The session is over from the moment the notice landed, rather than a
    // light-time later when the reading finally shows zero.
    expect(svc.snapshot().warpTo).toBeNull();
  });

  it("learns why the warp stopped even if it was away when it happened", async () => {
    const storage = memoryStorage();
    const session = startSession(OWLT);
    session.emitAt(UT_START);

    const target = UT_START + 100;
    const first = new AlarmHostService(null, {
      nowMs: () => nowMs,
      tickIntervalMs: DT * 1000,
      storage,
      getOwltSeconds: () => OWLT,
    });
    const alarm = first.addAlarm({
      name: "SCET",
      trigger: { kind: "time", ut: target, leadSeconds: 0, vantage: "scet" },
    });
    await run(session, UT_START + 4 * DT);
    // Gone across the fire, the way a browser tab is when it is closed or a
    // socket drops: nothing on this side is listening when the notice goes out.
    first.dispose();
    setActiveTelemetryClientForTests(undefined);

    for (let ut = UT_START + 5 * DT; ut <= target + 2 * DT; ut += DT) {
      session.emitAt(ut);
      nowMs += DT * 1000;
      await vi.advanceTimersByTimeAsync(DT * 1000);
    }

    session.attach();
    const reconnected = new AlarmHostService(null, {
      nowMs: () => nowMs,
      tickIntervalMs: DT * 1000,
      storage,
      getOwltSeconds: () => OWLT,
    });
    session.reconnect();
    await vi.advanceTimersByTimeAsync(DT * 1000);

    const row = reconnected.snapshot().alarms.find((a) => a.id === alarm.id);
    // Replayed on the reliable lane rather than lost: the operator comes back
    // to an alarm that fired, not to a warp that stopped for no stated reason.
    expect(row?.state).not.toBe("pending");
    expect(row?.eventUT).toBe(target);
    reconnected.dispose();
  });

  it("arms a threshold as a Topic, a path into it and the craft it is about", async () => {
    const session = startSession(OWLT);
    session.emitAt(UT_START);
    const svc = new AlarmHostService(null, {
      nowMs: () => nowMs,
      tickIntervalMs: DT * 1000,
      storage: memoryStorage(),
      getOwltSeconds: () => OWLT,
    });

    const alarm = svc.addAlarm({
      name: "Above 100 km",
      trigger: {
        kind: "threshold",
        dataKey: "vessel.flight.altitudeAsl",
        op: ">=",
        value: 100_000,
        sustainSeconds: 0,
        vantage: "scet",
        topic: "vessel.flight",
        fieldPath: "altitudeAsl",
      },
    });
    await run(session, UT_START + 4 * DT);
    svc.dispose();

    // The address the simulation resolves, not the flat key: a Topic and a path
    // into its payload, because the flat key cannot be split back apart.
    expect(session.armOf(alarm.id)?.condition).toEqual({
      kind: "threshold",
      topic: "vessel.flight",
      fieldPath: "altitudeAsl",
      op: 1,
      threshold: 100_000,
      sustainSeconds: 0,
    });
    /* And it names the CRAFT. Armed as "game" the payload's own `meta.source`
       would never match and the alarm would sit armed forever, which is the
       failure mode an operator cannot tell from a condition not yet met. */
    expect(session.armOf(alarm.id)?.subject).toBe(`vessel:${VESSEL_ID}`);
  });

  it("fires a threshold off the craft's true state, not the reading on screen", async () => {
    const session = startSession(OWLT);
    session.emitAt(UT_START);
    const svc = new AlarmHostService(null, {
      nowMs: () => nowMs,
      tickIntervalMs: DT * 1000,
      storage: memoryStorage(),
      getOwltSeconds: () => OWLT,
    });

    const alarm = svc.addAlarm({
      name: "Above 100 km",
      trigger: {
        kind: "threshold",
        dataKey: "vessel.flight.altitudeAsl",
        op: ">=",
        value: 100_000,
        sustainSeconds: 0,
        vantage: "scet",
        topic: "vessel.flight",
        fieldPath: "altitudeAsl",
      },
    });
    /* Stepped by hand rather than through `run`, which always restarts at
       `UT_START + DT`: this test needs the world to cross the threshold at one
       stated instant, so the clock has to keep going forwards. */
    const step = async (from: number, to: number) => {
      for (let ut = from; ut <= to; ut += DT) {
        session.emitAt(ut);
        nowMs += DT * 1000;
        await vi.advanceTimersByTimeAsync(DT * 1000);
      }
    };
    await step(UT_START + DT, UT_START + 4 * DT);
    expect(svc.snapshot().alarms[0]?.state).toBe("pending");

    const crossesAt = UT_START + 5 * DT;
    session.setAltitude(101_000);
    await step(crossesAt, crossesAt + 2 * DT);
    const row = svc.snapshot().alarms.find((a) => a.id === alarm.id);
    svc.dispose();

    /* The client holds nothing that says the craft is above 100 km: its own
       `vessel.flight` would be a light-time old even if it were subscribed. The
       alarm still fires on the tick the GAME crossed, which is the entire
       argument for the arm existing. */
    expect(row?.state).not.toBe("pending");
    expect(row?.eventUT).toBe(crossesAt);
    expect(session.gameIndex()).toBe(0);
  });

  it("says why an unreadable Topic was refused instead of sitting pending", async () => {
    const session = startSession(OWLT);
    session.emitAt(UT_START);
    const svc = new AlarmHostService(null, {
      nowMs: () => nowMs,
      tickIntervalMs: DT * 1000,
      storage: memoryStorage(),
      getOwltSeconds: () => OWLT,
    });

    /* A Topic the simulation cannot read pre-reveal. Nothing publishes the set
       it CAN read, so the picker offers this and the refusal is the first
       moment this side could have known. */
    const alarm = svc.addAlarm({
      name: "Funds",
      trigger: {
        kind: "threshold",
        dataKey: "career.economy.funds",
        op: "<",
        value: 1000,
        sustainSeconds: 0,
        vantage: "scet",
        topic: "career.economy",
        fieldPath: "funds",
      },
    });
    await run(session, UT_START + 4 * DT);
    const snap = svc.snapshot();
    svc.dispose();

    expect(session.armed()).toEqual([]);
    expect(snap.alarms.find((a) => a.id === alarm.id)?.state).toBe("pending");
    // The mod's own words, carrying the Topic the operator chose.
    expect(snap.scetArmRefusals?.[alarm.id]).toContain("career.economy");
  });

  it("fires both vantages on the same tick when there is no delay to tell them apart", async () => {
    const session = startSession(0);
    session.emitAt(UT_START);
    const svc = new AlarmHostService(null, {
      nowMs: () => nowMs,
      tickIntervalMs: DT * 1000,
      storage: memoryStorage(),
      getOwltSeconds: () => 0,
    });

    const target = UT_START + 100;
    const scet = svc.addAlarm({
      name: "SCET",
      trigger: { kind: "time", ut: target, leadSeconds: 0, vantage: "scet" },
    });
    const command = svc.addAlarm({
      name: "Command",
      trigger: { kind: "time", ut: target, leadSeconds: 0 },
    });

    const firedAt = new Map<string, number>();
    let ut = UT_START;
    for (ut = UT_START + DT; ut <= target + 4 * DT; ut += DT) {
      session.emitAt(ut);
      nowMs += DT * 1000;
      await vi.advanceTimersByTimeAsync(DT * 1000);
      for (const a of svc.snapshot().alarms) {
        if (a.state !== "pending" && !firedAt.has(a.id)) firedAt.set(a.id, ut);
      }
    }
    svc.dispose();

    // On a LAN session the two vantages are the same clock, so an alarm set
    // either way must be the same alarm. A difference here would be one this
    // feature invented.
    expect(firedAt.get(scet.id)).toBe(target);
    expect(firedAt.get(command.id)).toBe(target);
  });
});
