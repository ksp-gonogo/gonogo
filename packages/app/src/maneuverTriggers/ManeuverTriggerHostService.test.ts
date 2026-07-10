import type { FrozenPlanInputs } from "@ksp-gonogo/components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManeuverTriggerHostService } from "./ManeuverTriggerHostService";

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
  subscribe: (key: string, cb: (v: unknown) => void) => () => void;
  set(key: string, v: unknown): void;
  calls: string[];
}

function fakeTelemetry(): FakeTelemetry {
  const store = new Map<string, unknown>();
  const subs = new Map<string, Set<(v: unknown) => void>>();
  const calls: string[] = [];
  return {
    getLatestValue: (key: string) => store.get(key),
    execute: async (action: string) => {
      calls.push(action);
    },
    subscribe: (key, cb) => {
      let bucket = subs.get(key);
      if (!bucket) {
        bucket = new Set();
        subs.set(key, bucket);
      }
      bucket.add(cb);
      return () => {
        bucket?.delete(cb);
      };
    },
    set(key, v) {
      store.set(key, v);
      const bucket = subs.get(key);
      if (bucket) {
        for (const cb of bucket) cb(v);
      }
    },
    calls,
  };
}

const FROZEN: FrozenPlanInputs = {
  preset: "circularize-apo",
  prograde: 0,
  normal: 0,
  radial: 0,
  burnInSeconds: 60,
  utMode: "relative",
  burnAtUT: 0,
  targetInclination: 0,
  targetAltitudeKm: 100,
  standoffMeters: 500,
};

function seedKerbinOrbit(t: FakeTelemetry): void {
  t.set("v.name", "Test Vessel");
  t.set("v.body", "Kerbin");
  t.set("o.referenceBody", "Kerbin");
  t.set("o.sma", 700_000);
  t.set("o.eccentricity", 0.01);
  t.set("o.ApR", 707_000);
  t.set("o.PeR", 693_000);
  t.set("o.timeToAp", 900);
  t.set("o.timeToPe", 1800);
  t.set("o.argumentOfPeriapsis", 0);
  t.set("o.trueAnomaly", 0);
  t.set("o.inclination", 0);
  t.set("o.lan", 0);
  t.set("o.period", 3600);
  t.set("o.orbitalSpeed", 2300);
  t.set("o.radius", 700_000);
  t.set("t.universalTime", 1_000_000);
}

describe("ManeuverTriggerHostService", () => {
  let storage: Storage;
  beforeEach(() => {
    vi.useFakeTimers();
    storage = memoryStorage();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeService(t: FakeTelemetry) {
    return new ManeuverTriggerHostService(null, t, {
      nowMs: () => 1_700_000_000_000,
      storage,
    });
  }

  it("adds an armed trigger and surfaces it in the snapshot", () => {
    const t = fakeTelemetry();
    seedKerbinOrbit(t);
    const svc = makeService(t);
    svc.arm({ dataKey: "o.ApA", op: ">=", value: 200_000, inputs: FROZEN });
    const snap = svc.snapshot();
    expect(snap.triggers).toHaveLength(1);
    expect(snap.triggers[0].dataKey).toBe("o.ApA");
    expect(snap.triggers[0].vesselName).toBe("Test Vessel");
  });

  it("fires immediately when the condition is already true at arm time", () => {
    const t = fakeTelemetry();
    seedKerbinOrbit(t);
    t.set("o.ApA", 250_000);
    const svc = makeService(t);
    svc.arm({ dataKey: "o.ApA", op: ">=", value: 200_000, inputs: FROZEN });
    expect(t.calls.length).toBe(1);
    expect(t.calls[0]).toMatch(/^o\.addManeuverNode\[/);
    expect(svc.snapshot().triggers).toHaveLength(0);
  });

  it("fires when the watched value crosses the threshold after arming", () => {
    const t = fakeTelemetry();
    seedKerbinOrbit(t);
    t.set("o.ApA", 50_000);
    const svc = makeService(t);
    svc.arm({ dataKey: "o.ApA", op: ">=", value: 80_000, inputs: FROZEN });
    expect(t.calls).toEqual([]);
    t.set("o.ApA", 100_000);
    expect(t.calls.length).toBe(1);
    expect(svc.snapshot().triggers).toHaveLength(0);
  });

  it("auto-clears triggers when the active vessel changes", () => {
    const t = fakeTelemetry();
    seedKerbinOrbit(t);
    const svc = makeService(t);
    svc.arm({ dataKey: "o.ApA", op: ">=", value: 200_000, inputs: FROZEN });
    expect(svc.snapshot().triggers).toHaveLength(1);
    t.set("v.name", "Different Vessel");
    expect(svc.snapshot().triggers).toHaveLength(0);
  });

  it("persists triggers across construction and restores them on load", () => {
    const t1 = fakeTelemetry();
    seedKerbinOrbit(t1);
    const svc1 = makeService(t1);
    svc1.arm({ dataKey: "o.ApA", op: ">=", value: 999_999, inputs: FROZEN });
    expect(svc1.snapshot().triggers).toHaveLength(1);
    svc1.dispose();
    // New service over the same storage — same vessel name on this new
    // telemetry so the persisted trigger isn't auto-cleared on load.
    const t2 = fakeTelemetry();
    seedKerbinOrbit(t2);
    const svc2 = makeService(t2);
    expect(svc2.snapshot().triggers).toHaveLength(1);
    expect(svc2.snapshot().triggers[0].dataKey).toBe("o.ApA");
  });

  it("cancel() removes a pending trigger and emits a snapshot", () => {
    const t = fakeTelemetry();
    seedKerbinOrbit(t);
    const svc = makeService(t);
    svc.arm({ dataKey: "o.ApA", op: ">=", value: 999_999, inputs: FROZEN });
    const id = svc.snapshot().triggers[0].id;
    let lastSize = -1;
    svc.subscribe((s) => {
      lastSize = s.triggers.length;
    });
    svc.cancel(id);
    expect(svc.snapshot().triggers).toHaveLength(0);
    expect(lastSize).toBe(0);
    expect(t.calls).toEqual([]);
  });
});
