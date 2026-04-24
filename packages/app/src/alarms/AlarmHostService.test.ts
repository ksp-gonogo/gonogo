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
    svc.addAlarm({ ut: 2000, name: "Circularize", leadSeconds: 10 });
    const snap = svc.snapshot();
    expect(snap.alarms).toHaveLength(1);
    expect(snap.alarms[0].name).toBe("Circularize");
    expect(snap.alarms[0].state).toBe("pending");
  });

  it("transitions pending → arming and commands warp to 0 within the lead window", () => {
    const { svc, telemetry } = makeService();
    svc.addAlarm({ ut: 1005, name: "Burn", leadSeconds: 10 });
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
    a.addAlarm({ ut: 2000, name: "A" });
    a.addAlarm({ ut: 3000, name: "B" });
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

  it("updates and deletes alarms", () => {
    const { svc } = makeService();
    const a = svc.addAlarm({ ut: 2000, name: "Original" });
    svc.updateAlarm(a.id, { name: "Renamed" });
    expect(svc.snapshot().alarms[0].name).toBe("Renamed");
    svc.deleteAlarm(a.id);
    expect(svc.snapshot().alarms).toHaveLength(0);
  });
});
