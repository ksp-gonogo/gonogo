import type { FrozenPlanInputs } from "@ksp-gonogo/components";
import {
  StubTransport,
  setActiveCarriedChannelsForTests,
  setActiveTelemetryClientForTests,
  setActiveTimelineStoreForTests,
  setActiveViewClockForTests,
  TelemetryClient,
  TimelineStore,
  ViewClock,
  vesselStateChannel,
} from "@ksp-gonogo/sitrep-client";
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

/**
 * `readLiveOrbit()`/`readVesselName()`'s stream leg — real `TimelineStore`
 * (with `vesselStateChannel` registered, matching `TelemetryProvider`'s own
 * default) fed directly via `TimelineStore.ingest`/`StubTransport.emit`,
 * registered as the accessors' source via `setActiveTimelineStoreForTests`.
 * No React/`TelemetryProvider` needed — this is a plain-class unit test.
 *
 * ALSO the trigger `dataKey` read's stream leg now (`getValue`) and the
 * maneuver-node fire's command-dispatch leg (`dispatchActiveCommand`) —
 * `setActiveTelemetryClientForTests`/`setActiveCarriedChannelsForTests`
 * register the same client/carried-channels a mounted `TelemetryProvider`
 * would, so `dispatchActiveCommand("data", "o.addManeuverNode[...]")` routes
 * through `client.dispatch` instead of falling back unrouted. `calls`
 * records every dispatched `{command, args}` pair via
 * `transport.setCommandHandler`, replacing the old `execute()`-call log.
 *
 * `client.subscribe(...)` is required up front so `StubTransport.emit`
 * actually delivers (its subscription-gating — see its own doc comment);
 * `store.beginFrame()` after each emit both advances `currentFrame()` (what
 * `sample()` reads relative to) and fires `subscribeFrame` listeners (what
 * `bindVesselWatcher`'s `onActiveTimelineFrame` re-evaluates on).
 */
function buildOrbitStoreFixture(pinnedUt: number) {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: () => 0,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  clock.scrubTo(pinnedUt);
  const store = new TimelineStore(clock);
  store.registerDerivedChannel(vesselStateChannel);
  client.attachStore(store);
  client.subscribe("vessel.orbit", () => {});
  client.subscribe("vessel.identity", () => {});

  const calls: Array<{ command: string; args: unknown }> = [];
  transport.setCommandHandler((command, args) => {
    calls.push({ command, args });
    return null;
  });

  setActiveTimelineStoreForTests(store);
  setActiveTelemetryClientForTests(client);
  setActiveCarriedChannelsForTests(new Set(["vessel.maneuver.add"]));

  return {
    store,
    calls,
    emitOrbit(payload: unknown): void {
      transport.emit("vessel.orbit", payload);
      store.beginFrame();
    },
    emitIdentity(payload: unknown): void {
      transport.emit("vessel.identity", payload);
      store.beginFrame();
    },
  };
}

/**
 * Self-consistent Kerbin-like orbit. `meanAnomalyAtEpoch: 0` + `epoch:
 * pinnedUt` puts the vessel at periapsis exactly at the pinned view-UT.
 * `sma`/`ecc` also drive `vessel.state.apoapsisRadius` (`sma·(1+ecc)`,
 * body-radius-independent — see `vessel-state.ts`), which is what this
 * file's `dataKey: "o.ApR"` triggers threshold against: 700_000 · 1.01 =
 * 707_000 at the defaults below.
 */
function kerbinOrbitPayload(pinnedUt: number, sma = 700_000) {
  return {
    referenceBodyIndex: 1,
    sma,
    ecc: 0.01,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: pinnedUt,
    mu: 3.5316e12,
    patches: [],
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

function seedKerbinOrbit(pinnedUt = 1_000_000) {
  setActiveViewClockForTests({ viewUt: () => pinnedUt });
  const storeFixture = buildOrbitStoreFixture(pinnedUt);
  storeFixture.emitOrbit(kerbinOrbitPayload(pinnedUt));
  storeFixture.emitIdentity({
    vesselId: "test-vessel",
    name: "Test Vessel",
    vesselType: 0,
    situation: 0,
  });
  return storeFixture;
}

describe("ManeuverTriggerHostService", () => {
  let storage: Storage;
  beforeEach(() => {
    vi.useFakeTimers();
    storage = memoryStorage();
  });
  afterEach(() => {
    vi.useRealTimers();
    setActiveViewClockForTests(undefined);
    setActiveTimelineStoreForTests(undefined);
    setActiveTelemetryClientForTests(undefined);
    setActiveCarriedChannelsForTests(undefined);
  });

  function makeService() {
    return new ManeuverTriggerHostService(null, {
      nowMs: () => 1_700_000_000_000,
      storage,
    });
  }

  it("adds an armed trigger and surfaces it in the snapshot", () => {
    seedKerbinOrbit();
    const svc = makeService();
    // 707_000 (baseline apoapsisRadius) stays below 800_000 — pending, not fired.
    svc.arm({ dataKey: "o.ApR", op: ">=", value: 800_000, inputs: FROZEN });
    const snap = svc.snapshot();
    expect(snap.triggers).toHaveLength(1);
    expect(snap.triggers[0].dataKey).toBe("o.ApR");
    expect(snap.triggers[0].vesselName).toBe("Test Vessel");
  });

  it("fires immediately when the condition is already true at arm time", () => {
    seedKerbinOrbit();
    const svc = makeService();
    // 707_000 (baseline apoapsisRadius) already clears 700_000.
    svc.arm({ dataKey: "o.ApR", op: ">=", value: 700_000, inputs: FROZEN });
    expect(svc.snapshot().triggers).toHaveLength(0);
  });

  it("fires when the watched value crosses the threshold after arming", async () => {
    const storeFixture = seedKerbinOrbit();
    const svc = makeService();
    // 707_000 stays below 750_000 — pending until the orbit changes.
    svc.arm({ dataKey: "o.ApR", op: ">=", value: 750_000, inputs: FROZEN });
    expect(storeFixture.calls).toEqual([]);
    // Bump sma so apoapsisRadius (sma·1.01) clears 750_000.
    storeFixture.emitOrbit(kerbinOrbitPayload(1_000_000, 800_000));
    // The command dispatch settles on a microtask (StubTransport answers
    // `command-request` via `queueMicrotask`) — drain it before asserting.
    await Promise.resolve();
    await Promise.resolve();
    expect(storeFixture.calls.length).toBe(1);
    expect(storeFixture.calls[0].command).toBe("vessel.maneuver.add");
    expect(svc.snapshot().triggers).toHaveLength(0);
  });

  it("auto-clears triggers when the active vessel changes", () => {
    const storeFixture = seedKerbinOrbit();
    const svc = makeService();
    svc.arm({ dataKey: "o.ApR", op: ">=", value: 800_000, inputs: FROZEN });
    expect(svc.snapshot().triggers).toHaveLength(1);
    storeFixture.emitIdentity({
      vesselId: "different-vessel",
      name: "Different Vessel",
      vesselType: 0,
      situation: 0,
    });
    expect(svc.snapshot().triggers).toHaveLength(0);
  });

  it("persists triggers across construction and restores them on load", () => {
    seedKerbinOrbit();
    const svc1 = makeService();
    svc1.arm({ dataKey: "o.ApR", op: ">=", value: 999_999, inputs: FROZEN });
    expect(svc1.snapshot().triggers).toHaveLength(1);
    svc1.dispose();
    // New service over the same storage — same vessel name (still seeded)
    // so the persisted trigger isn't auto-cleared on load.
    const svc2 = makeService();
    expect(svc2.snapshot().triggers).toHaveLength(1);
    expect(svc2.snapshot().triggers[0].dataKey).toBe("o.ApR");
  });

  it("cancel() removes a pending trigger and emits a snapshot", () => {
    const storeFixture = seedKerbinOrbit();
    const svc = makeService();
    svc.arm({ dataKey: "o.ApR", op: ">=", value: 999_999, inputs: FROZEN });
    const id = svc.snapshot().triggers[0].id;
    let lastSize = -1;
    svc.subscribe((s) => {
      lastSize = s.triggers.length;
    });
    svc.cancel(id);
    expect(svc.snapshot().triggers).toHaveLength(0);
    expect(lastSize).toBe(0);
    expect(storeFixture.calls).toEqual([]);
  });
});
