import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlarmHostService } from "./AlarmHostService";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    length: 0,
    clear: () => map.clear(),
    key: () => null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
  } as Storage;
}

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
});
