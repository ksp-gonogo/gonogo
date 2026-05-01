import { memoryStorage } from "@gonogo/core/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlarmHostService } from "./AlarmHostService";

interface FakeTelemetry {
  getLatestValue: (key: string) => unknown;
  execute: (action: string) => Promise<void>;
  set(key: string, v: unknown): void;
  calls: string[];
}

function fakeTelemetry(): FakeTelemetry {
  const store = new Map<string, unknown>();
  const calls: string[] = [];
  return {
    getLatestValue: (key: string) => store.get(key),
    execute: async (action: string) => {
      calls.push(action);
    },
    set(key, v) {
      store.set(key, v);
    },
    calls,
  };
}

describe("AlarmHostService", () => {
  let nowMs: number;
  beforeEach(() => {
    vi.useFakeTimers();
    nowMs = 1_700_000_000_000;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeService(): {
    svc: AlarmHostService;
    telemetry: FakeTelemetry;
  } {
    const telemetry = fakeTelemetry();
    telemetry.set("t.universalTime", 1000);
    telemetry.set("t.currentRateIndex", 0);
    telemetry.set("t.currentRate", 1);
    const svc = new AlarmHostService(null, telemetry, {
      nowMs: () => nowMs,
      tickIntervalMs: 1000,
      storage: memoryStorage(),
    });
    return { svc, telemetry };
  }

  it("adds an alarm and surfaces it in the snapshot", () => {
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

  it("transitions pending → arming and commands warp to 0 within the lead window", () => {
    const { svc, telemetry } = makeService();
    svc.addAlarm({
      name: "Burn",
      trigger: { kind: "time", ut: 1005, leadSeconds: 10 },
    });
    // Simulate warp at 50× so the host has something to drop.
    telemetry.set("t.currentRateIndex", 4);
    telemetry.set("t.currentRate", 50);
    vi.advanceTimersByTime(1100);
    expect(svc.snapshot().alarms[0].state).toBe("arming");
    expect(telemetry.calls).toContain("t.timeWarp[0]");
  });

  it("flags unscheduled warp when none is set and the user didn't announce intent", () => {
    const { svc, telemetry } = makeService();
    telemetry.set("t.universalTime", 1200);
    telemetry.set("t.currentRateIndex", 3);
    telemetry.set("t.currentRate", 10);
    vi.advanceTimersByTime(1100);
    expect(svc.snapshot().unscheduledWarp).not.toBeNull();
  });

  it("suppresses the unscheduled-warp flag when a station just announced a warp intent", () => {
    const { svc, telemetry } = makeService();
    svc.registerStationWarpIntent();
    telemetry.set("t.currentRateIndex", 3);
    telemetry.set("t.currentRate", 10);
    vi.advanceTimersByTime(1100);
    expect(svc.snapshot().unscheduledWarp).toBeNull();
  });

  it("persists alarms across service instances", () => {
    const storage = memoryStorage();
    const telemetry = fakeTelemetry();
    telemetry.set("t.universalTime", 1000);
    const a = new AlarmHostService(null, telemetry, {
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

    const b = new AlarmHostService(null, telemetry, {
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

  describe("threshold triggers", () => {
    it("fires when the telemetry value first crosses a >= threshold (no sustain)", () => {
      const { svc, telemetry } = makeService();
      svc.addAlarm({
        name: "70km",
        trigger: {
          kind: "threshold",
          dataKey: "v.altitude",
          op: ">=",
          value: 70_000,
          sustainSeconds: 0,
        },
      });
      // Start below threshold — alarm stays pending.
      telemetry.set("v.altitude", 50_000);
      vi.advanceTimersByTime(1100);
      expect(svc.snapshot().alarms[0].state).toBe("pending");
      // Cross the threshold — should immediately fire.
      telemetry.set("v.altitude", 70_500);
      telemetry.set("t.universalTime", 1100);
      vi.advanceTimersByTime(1100);
      expect(svc.snapshot().alarms[0].state).toBe("firing");
    });

    it("waits for sustain before firing", () => {
      const { svc, telemetry } = makeService();
      svc.addAlarm({
        name: "Held over",
        trigger: {
          kind: "threshold",
          dataKey: "v.surfaceVelocity",
          op: ">",
          value: 100,
          sustainSeconds: 3,
        },
      });
      // First tick — condition matches, but sustain not satisfied.
      telemetry.set("v.surfaceVelocity", 200);
      telemetry.set("t.universalTime", 1000);
      vi.advanceTimersByTime(1100);
      expect(svc.snapshot().alarms[0].state).toBe("pending");
      expect(svc.snapshot().alarms[0].matchSinceUT).toBe(1000);

      // Two seconds later — still under sustain.
      telemetry.set("t.universalTime", 1002);
      vi.advanceTimersByTime(1100);
      expect(svc.snapshot().alarms[0].state).toBe("pending");

      // Sustain hit at +3s — alarm fires.
      telemetry.set("t.universalTime", 1003);
      vi.advanceTimersByTime(1100);
      expect(svc.snapshot().alarms[0].state).toBe("firing");
    });

    it("resets sustain when the condition stops matching", () => {
      const { svc, telemetry } = makeService();
      svc.addAlarm({
        name: "Bouncy",
        trigger: {
          kind: "threshold",
          dataKey: "v.altitude",
          op: ">=",
          value: 70_000,
          sustainSeconds: 5,
        },
      });
      // Match starts at UT=1000.
      telemetry.set("v.altitude", 70_500);
      telemetry.set("t.universalTime", 1000);
      vi.advanceTimersByTime(1100);
      expect(svc.snapshot().alarms[0].matchSinceUT).toBe(1000);

      // Drop below threshold — match resets.
      telemetry.set("v.altitude", 69_500);
      telemetry.set("t.universalTime", 1003);
      vi.advanceTimersByTime(1100);
      expect(svc.snapshot().alarms[0].matchSinceUT).toBeNull();

      // Cross again at 1010 — sustain timer starts fresh, not from 1000.
      telemetry.set("v.altitude", 71_000);
      telemetry.set("t.universalTime", 1010);
      vi.advanceTimersByTime(1100);
      expect(svc.snapshot().alarms[0].matchSinceUT).toBe(1010);
      expect(svc.snapshot().alarms[0].state).toBe("pending");
    });

    it("stays fired when an oscillating value re-crosses the threshold", () => {
      const { svc, telemetry } = makeService();
      svc.addAlarm({
        name: "Apoapsis bell",
        trigger: {
          kind: "threshold",
          dataKey: "v.altitude",
          op: ">=",
          value: 70_000,
          sustainSeconds: 0,
        },
      });
      // Cross threshold → fires.
      telemetry.set("v.altitude", 70_500);
      telemetry.set("t.universalTime", 1000);
      vi.advanceTimersByTime(1100);
      expect(svc.snapshot().alarms[0].state).toBe("firing");
      // Two seconds later the firing window closes → fired.
      telemetry.set("t.universalTime", 1003);
      vi.advanceTimersByTime(1100);
      expect(svc.snapshot().alarms[0].state).toBe("fired");
      // Drop below, then cross again — pre-fix this regressed to firing
      // and chimed a second time.
      telemetry.set("v.altitude", 69_500);
      telemetry.set("t.universalTime", 1006);
      vi.advanceTimersByTime(1100);
      telemetry.set("v.altitude", 70_500);
      telemetry.set("t.universalTime", 1009);
      vi.advanceTimersByTime(1100);
      expect(svc.snapshot().alarms[0].state).toBe("fired");
    });
  });

  it("migrates v1 persisted alarms into the v2 trigger shape", () => {
    const storage = memoryStorage();
    storage.setItem(
      "gonogo.alarms.list",
      JSON.stringify([
        { id: "a", name: "Old", ut: 2500, leadSeconds: 10, state: "pending" },
      ]),
    );
    const telemetry = fakeTelemetry();
    const svc = new AlarmHostService(null, telemetry, {
      nowMs: () => nowMs,
      storage,
    });
    const a = svc.snapshot().alarms[0];
    expect(a).toBeDefined();
    expect(a.trigger).toEqual({
      kind: "time",
      ut: 2500,
      leadSeconds: 10,
    });
  });

  describe("warp-to manual session", () => {
    it("does nothing when there are no eligible alarms", () => {
      const { svc, telemetry } = makeService();
      svc.beginWarpTo();
      expect(svc.snapshot().warpTo).toBeNull();
      expect(telemetry.calls).toEqual([]);
    });

    it("activates on a threshold-only list and holds at the ramp-up cap", () => {
      const { svc, telemetry } = makeService();
      const a = svc.addAlarm({
        name: "Threshold",
        trigger: {
          kind: "threshold",
          dataKey: "v.altitude",
          op: ">=",
          value: 70_000,
          sustainSeconds: 0,
        },
      });
      // No samples yet → ETA unknown → ladder pinned at 100× while the
      // slope estimator collects data.
      svc.beginWarpTo();
      expect(svc.snapshot().warpTo).toEqual({
        alarmId: a.id,
        targetIndex: 4,
      });
      expect(telemetry.calls).toContain("t.timeWarp[4]");
    });

    it("ignores equality-op threshold alarms (non-monotonic, can't plan)", () => {
      const { svc, telemetry } = makeService();
      svc.addAlarm({
        name: "Equality",
        trigger: {
          kind: "threshold",
          dataKey: "v.altitude",
          op: "==",
          value: 70_000,
          sustainSeconds: 0,
        },
      });
      const before = [...telemetry.calls];
      svc.beginWarpTo();
      expect(svc.snapshot().warpTo).toBeNull();
      expect(telemetry.calls).toEqual(before);
    });

    it("targets the highest ladder rate that respects the safety margin", () => {
      const { svc, telemetry } = makeService();
      // utNow=1000, alarm at ut=100_000 lead=10
      // remaining=98_990; default margin=10 → maxRate=9899 → 1000× (idx 5)
      const a = svc.addAlarm({
        name: "Far",
        trigger: { kind: "time", ut: 100_000, leadSeconds: 10 },
      });
      svc.beginWarpTo();
      expect(svc.snapshot().warpTo).toEqual({
        alarmId: a.id,
        targetIndex: 5,
      });
      expect(telemetry.calls).toContain("t.timeWarp[5]");
    });

    it("steps the rate down as remaining time shrinks", () => {
      const { svc, telemetry } = makeService();
      // utNow=1000, ut=11_000, lead=10
      // remaining=9990 → maxRate=999 → 100× (idx 4)
      svc.addAlarm({
        name: "Approaching",
        trigger: { kind: "time", ut: 11_000, leadSeconds: 10 },
      });
      svc.beginWarpTo();
      expect(svc.snapshot().warpTo?.targetIndex).toBe(4);

      // Advance UT to 10_000 → remaining=990 → maxRate=99 → 50× (idx 3)
      telemetry.set("t.universalTime", 10_000);
      vi.advanceTimersByTime(1100);
      expect(svc.snapshot().warpTo?.targetIndex).toBe(3);

      // Cross into the lead window → alarm transitions to arming, warp-to
      // hands control back to the alarm system's stepWarpDown.
      telemetry.set("t.universalTime", 10_995);
      vi.advanceTimersByTime(1100);
      expect(svc.snapshot().warpTo).toBeNull();
      expect(svc.snapshot().alarms[0].state).toBe("arming");
    });

    it("retargets to a sooner alarm added mid-session", () => {
      const { svc } = makeService();
      const far = svc.addAlarm({
        name: "Far",
        trigger: { kind: "time", ut: 100_000, leadSeconds: 10 },
      });
      svc.beginWarpTo();
      expect(svc.snapshot().warpTo?.alarmId).toBe(far.id);

      // Add a sooner alarm — next tick should retarget and pick a lower
      // safe rate based on its earlier UT.
      const near = svc.addAlarm({
        name: "Near",
        trigger: { kind: "time", ut: 11_000, leadSeconds: 10 },
      });
      vi.advanceTimersByTime(1100);
      expect(svc.snapshot().warpTo?.alarmId).toBe(near.id);
      expect(svc.snapshot().warpTo?.targetIndex).toBe(4); // 100×
    });

    it("caps rate at 100× when any threshold alarm is pending", () => {
      const { svc } = makeService();
      svc.addAlarm({
        name: "Far",
        trigger: { kind: "time", ut: 100_000, leadSeconds: 10 },
      });
      svc.addAlarm({
        name: "Threshold",
        trigger: {
          kind: "threshold",
          dataKey: "v.altitude",
          op: ">=",
          value: 70_000,
          sustainSeconds: 0,
        },
      });
      svc.beginWarpTo();
      // Without the cap, far alarm allows idx 5 (1000×). The threshold
      // presence drops it to idx 4 (100×).
      expect(svc.snapshot().warpTo?.targetIndex).toBe(4);
    });

    it("auto-cancels when the last pending time alarm is deleted", () => {
      const { svc } = makeService();
      const a = svc.addAlarm({
        name: "Far",
        trigger: { kind: "time", ut: 100_000, leadSeconds: 10 },
      });
      svc.beginWarpTo();
      expect(svc.snapshot().warpTo).not.toBeNull();
      svc.deleteAlarm(a.id);
      vi.advanceTimersByTime(1100);
      expect(svc.snapshot().warpTo).toBeNull();
    });

    it("cancelWarpTo issues t.timeWarp[0] and clears state", () => {
      const { svc, telemetry } = makeService();
      svc.addAlarm({
        name: "Far",
        trigger: { kind: "time", ut: 100_000, leadSeconds: 10 },
      });
      svc.beginWarpTo();
      telemetry.calls.length = 0; // isolate the cancel command
      svc.cancelWarpTo();
      expect(telemetry.calls).toContain("t.timeWarp[0]");
      expect(svc.snapshot().warpTo).toBeNull();
    });

    it("respects a larger custom safety margin", () => {
      const { svc } = makeService();
      svc.setWarpSafetyMargin(100); // 10× the default
      // remaining=98_990; margin=100 → maxRate=989 → 100× (idx 4)
      svc.addAlarm({
        name: "Far",
        trigger: { kind: "time", ut: 100_000, leadSeconds: 10 },
      });
      svc.beginWarpTo();
      expect(svc.snapshot().warpTo?.targetIndex).toBe(4);
    });

    it("clamps the safety margin within bounds", () => {
      const { svc } = makeService();
      svc.setWarpSafetyMargin(5000);
      expect(svc.snapshot().warpSafetyMarginSeconds).toBe(120);
      svc.setWarpSafetyMargin(0);
      expect(svc.snapshot().warpSafetyMarginSeconds).toBe(1);
    });

    it("persists the safety margin across instances", () => {
      const storage = memoryStorage();
      const t1 = fakeTelemetry();
      t1.set("t.universalTime", 1000);
      const a = new AlarmHostService(null, t1, {
        nowMs: () => nowMs,
        storage,
      });
      a.setWarpSafetyMargin(30);
      a.dispose();
      const t2 = fakeTelemetry();
      t2.set("t.universalTime", 1000);
      const b = new AlarmHostService(null, t2, {
        nowMs: () => nowMs,
        storage,
      });
      expect(b.snapshot().warpSafetyMarginSeconds).toBe(30);
      b.dispose();
    });

    it("ramps up off the cap once a threshold's slope projects a usable ETA", () => {
      const { svc, telemetry } = makeService();
      svc.addAlarm({
        name: "Altitude",
        trigger: {
          kind: "threshold",
          dataKey: "v.altitude",
          op: ">=",
          value: 70_000,
          sustainSeconds: 0,
        },
      });
      telemetry.set("v.altitude", 10_000);
      svc.beginWarpTo();
      // Cap until samples accumulate.
      expect(svc.snapshot().warpTo?.targetIndex).toBe(4);
      // Feed 4 samples, 1 game-second apart (so MIN_SAMPLE_SPAN_GAME_SECONDS
      // is satisfied), each adding 100 m altitude → slope = 100 m/s,
      // distance ≈ 60_000 → ETA ≈ 600s → maxRate 60 → idx 3 (50×).
      for (let i = 1; i <= 4; i++) {
        telemetry.set("t.universalTime", 1000 + i);
        telemetry.set("v.altitude", 10_000 + i * 100);
        vi.advanceTimersByTime(1100);
      }
      expect(svc.snapshot().warpTo?.targetIndex).toBe(3);
    });

    it("ramps down to 1× as the threshold approaches", () => {
      const { svc, telemetry } = makeService();
      svc.addAlarm({
        name: "Altitude",
        trigger: {
          kind: "threshold",
          dataKey: "v.altitude",
          op: ">=",
          value: 70_000,
          sustainSeconds: 0,
        },
      });
      svc.beginWarpTo();
      // Build a buffer with a 100 m/s climb, well below the threshold.
      for (let i = 0; i < 6; i++) {
        telemetry.set("t.universalTime", 1000 + i);
        telemetry.set("v.altitude", 60_000 + i * 100);
        vi.advanceTimersByTime(1100);
      }
      const farIndex = svc.snapshot().warpTo?.targetIndex ?? 0;
      expect(farIndex).toBeGreaterThan(0);
      // Now jump close to the threshold (still ascending) — only ~50m
      // distance at 100 m/s = 0.5s ETA → drops to idx 0.
      for (let i = 6; i < 12; i++) {
        telemetry.set("t.universalTime", 1000 + i);
        telemetry.set("v.altitude", 69_950 + (i - 6) * 100);
        vi.advanceTimersByTime(1100);
      }
      const nearIndex = svc.snapshot().warpTo?.targetIndex ?? 0;
      expect(nearIndex).toBeLessThan(farIndex);
    });

    it("won't ramp up when the value is drifting away from the threshold", () => {
      const { svc, telemetry } = makeService();
      svc.addAlarm({
        name: "Altitude",
        trigger: {
          kind: "threshold",
          dataKey: "v.altitude",
          op: ">=",
          value: 70_000,
          sustainSeconds: 0,
        },
      });
      svc.beginWarpTo();
      // Descending altitude — moving away from the >= threshold.
      for (let i = 0; i < 6; i++) {
        telemetry.set("t.universalTime", 1000 + i);
        telemetry.set("v.altitude", 60_000 - i * 100);
        vi.advanceTimersByTime(1100);
      }
      // No usable ETA → cap holds at idx 4.
      expect(svc.snapshot().warpTo?.targetIndex).toBe(4);
    });

    it("ends the session when the threshold's condition starts matching", () => {
      const { svc, telemetry } = makeService();
      svc.addAlarm({
        name: "Altitude",
        trigger: {
          kind: "threshold",
          dataKey: "v.altitude",
          op: ">=",
          value: 70_000,
          // Sustain so it stays in `pending` (matchSinceUT set, but state
          // hasn't transitioned yet) — exercises the matchSinceUT guard.
          sustainSeconds: 30,
        },
      });
      svc.beginWarpTo();
      expect(svc.snapshot().warpTo).not.toBeNull();
      // Cross the threshold.
      telemetry.set("t.universalTime", 2000);
      telemetry.set("v.altitude", 71_000);
      vi.advanceTimersByTime(1100);
      // matchSinceUT now set; alarm still `pending` but no longer
      // eligible — session terminates.
      expect(svc.snapshot().alarms[0].matchSinceUT).not.toBeNull();
      expect(svc.snapshot().warpTo).toBeNull();
    });

    it("does not flag unscheduled-warp while a warp-to session is active", () => {
      const { svc, telemetry } = makeService();
      svc.addAlarm({
        name: "Far",
        trigger: { kind: "time", ut: 100_000, leadSeconds: 10 },
      });
      svc.beginWarpTo();
      // Simulate KSP applying the commanded warp.
      telemetry.set("t.currentRateIndex", 5);
      telemetry.set("t.currentRate", 1000);
      // Advance well beyond WARP_INTENT_WINDOW_MS so the legacy intent
      // suppression has lapsed — the warp-to session itself must keep the
      // detector quiet.
      vi.advanceTimersByTime(5000);
      expect(svc.snapshot().unscheduledWarp).toBeNull();
    });
  });

  it("updates and deletes alarms", () => {
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
    type AddCb = (
      peerId: string,
      msg: {
        name: string;
        notes?: string;
        trigger: import("./types").AlarmTrigger;
      },
    ) => void;
    type UpdateCb = (
      peerId: string,
      msg: {
        id: string;
        patch: Partial<
          Pick<import("./types").Alarm, "name" | "notes" | "trigger">
        >;
      },
    ) => void;
    type IdCb = (peerId: string, id: string) => void;
    type VoidCb = (peerId: string) => void;
    interface CapturedHost {
      addCb: AddCb | null;
      updateCb: UpdateCb | null;
      deleteCb: IdCb | null;
      ackCb: IdCb | null;
      ackUnscheduledCb: VoidCb | null;
      warpIntentCb: VoidCb | null;
      broadcasts: unknown[];
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
        broadcasts: [],
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
        broadcast: (msg: unknown) => {
          captured.broadcasts.push(msg);
        },
      } as unknown as import("../peer/PeerHostService").PeerHostService;
      return { host, captured };
    }

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
      const svc = new AlarmHostService(host, telemetry, {
        nowMs: () => nowMs,
        tickIntervalMs: 1000,
        storage: memoryStorage(),
      });
      return { svc, telemetry, captured };
    }

    it("creates an alarm when a peer broadcasts alarm-add (with peerId as createdBy)", () => {
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

    it("patches an alarm when a peer broadcasts alarm-update", () => {
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

    it("deletes an alarm when a peer broadcasts alarm-delete", () => {
      const { svc, captured } = makeServiceWithHost();
      const a = svc.addAlarm({
        name: "Doomed",
        trigger: { kind: "time", ut: 5000, leadSeconds: 10 },
      });
      captured.deleteCb?.("peer-1", a.id);
      expect(svc.snapshot().alarms).toHaveLength(0);
    });

    it("clears unscheduled-warp when a peer acknowledges it", () => {
      const { svc, telemetry, captured } = makeServiceWithHost();
      telemetry.set("t.currentRateIndex", 3);
      telemetry.set("t.currentRate", 10);
      vi.advanceTimersByTime(1100);
      expect(svc.snapshot().unscheduledWarp).not.toBeNull();
      captured.ackUnscheduledCb?.("peer-1");
      expect(svc.snapshot().unscheduledWarp).toBeNull();
    });

    it("suppresses unscheduled-warp detection after a peer warp-intent event", () => {
      const { svc, telemetry, captured } = makeServiceWithHost();
      captured.warpIntentCb?.("peer-1");
      telemetry.set("t.currentRateIndex", 3);
      telemetry.set("t.currentRate", 10);
      vi.advanceTimersByTime(1100);
      expect(svc.snapshot().unscheduledWarp).toBeNull();
    });

    it("broadcasts alarm-snapshot on every emit and alarm-fired when an alarm fires", () => {
      const { svc, telemetry, captured } = makeServiceWithHost();
      svc.addAlarm({
        name: "Apoapsis",
        trigger: { kind: "time", ut: 1000, leadSeconds: 1 },
      });
      telemetry.set("t.universalTime", 1001);
      vi.advanceTimersByTime(1100);
      const types = captured.broadcasts.map(
        (m) => (m as { type: string }).type,
      );
      expect(types).toContain("alarm-snapshot");
      expect(types).toContain("alarm-fired");
    });

    it("removes a fired alarm when a peer station acknowledges it", () => {
      const { svc, telemetry, captured } = makeServiceWithHost();
      const a = svc.addAlarm({
        name: "Apoapsis",
        trigger: { kind: "time", ut: 1000, leadSeconds: 1 },
      });
      // Drive the state machine through arming → firing → fired so the
      // alarm is in the only state acknowledgeAlarm accepts.
      telemetry.set("t.universalTime", 1001);
      vi.advanceTimersByTime(1100);
      telemetry.set("t.universalTime", 1100);
      vi.advanceTimersByTime(1100);
      expect(svc.snapshot().alarms[0]?.state).toBe("fired");

      expect(captured.ackCb).not.toBeNull();
      captured.ackCb?.("station-peer-id", a.id);
      expect(svc.snapshot().alarms).toHaveLength(0);
    });
  });

  describe("time alarm firing→fired window", () => {
    it("transitions firing within 2s of UT and to fired thereafter", () => {
      const { svc, telemetry } = makeService();
      svc.addAlarm({
        name: "Burn",
        trigger: { kind: "time", ut: 1500, leadSeconds: 5 },
      });
      // Cross UT — within the 2s firing window.
      telemetry.set("t.universalTime", 1500);
      vi.advanceTimersByTime(1100);
      expect(svc.snapshot().alarms[0].state).toBe("firing");
      // Still within the window at UT-pass +1s.
      telemetry.set("t.universalTime", 1501);
      vi.advanceTimersByTime(1100);
      expect(svc.snapshot().alarms[0].state).toBe("firing");
      // 2s past — transitions to fired.
      telemetry.set("t.universalTime", 1502);
      vi.advanceTimersByTime(1100);
      expect(svc.snapshot().alarms[0].state).toBe("fired");
    });
  });
});
