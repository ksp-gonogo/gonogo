import type { FrozenPlanInputs } from "@ksp-gonogo/components";
import {
  StubTransport,
  setActiveTelemetryClientForTests,
  setActiveTimelineStoreForTests,
  setActiveViewClockForTests,
  TelemetryClient,
  TimelineStore,
  ViewClock,
  vesselStateChannel,
} from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
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
 * `readLiveOrbit()`/`readVesselName()`'s stream leg: real `TimelineStore`
 * (with `vesselStateChannel` registered, matching `TelemetryProvider`'s own
 * default) fed directly via `TimelineStore.ingest`/`StubTransport.emit`,
 * registered as the accessors' source via `setActiveTimelineStoreForTests`.
 * No React/`TelemetryProvider` needed: this is a plain-class unit test.
 *
 * ALSO the trigger `dataKey` read's stream leg now (`getValue`) and the
 * maneuver-node fire's command-dispatch leg (`dispatchActiveCommand`):
 * `setActiveTelemetryClientForTests` registers the same client a mounted
 * `TelemetryProvider` would, so
 * `dispatchActiveCommand("data", "o.addManeuverNode[...]")` routes
 * through `client.dispatch` instead of falling back unrouted. `calls`
 * records every dispatched `{command, args}` pair via
 * `transport.setCommandHandler`, replacing the old `execute()`-call log.
 *
 * `client.subscribe(...)` is required up front so `StubTransport.emit`
 * actually delivers (its subscription-gating: see its own doc comment);
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
  client.subscribe("system.bodies", () => {});

  const calls: Array<{ command: string; args: unknown }> = [];
  transport.setCommandHandler((command, args) => {
    calls.push({ command, args });
    return null;
  });

  setActiveTimelineStoreForTests(store);
  setActiveTelemetryClientForTests(client);

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
    emitBodies(payload: unknown): void {
      transport.emit("system.bodies", payload);
      store.beginFrame();
    },
  };
}

/**
 * An Earth-sized body under a name no stock table carries, which is what RSS
 * hands RP-1: the same index the orbit already references, reported with its
 * own radius. A planner that resolves the radius by NAME against the bundled
 * stock bodies finds nothing here and silently plans no transfer at all.
 */
function seedRenamedBodyOrbit(pinnedUt = 1_000_000) {
  setActiveViewClockForTests({ viewUt: () => pinnedUt });
  const storeFixture = buildOrbitStoreFixture(pinnedUt);
  storeFixture.emitBodies({
    bodies: [
      {
        index: 1,
        name: "Earth",
        /*
         * Real `Value`s: `wrap-units.ts` hydrates every declared quantity as
         * the payload is decoded, so a plain `{ magnitude, unit }` literal is
         * a shape the stream never delivers.
         */
        radius: value("m", 6_371_000),
        surfaceGravity: value("g", 1),
      },
    ],
  });
  storeFixture.emitOrbit({
    ...kerbinOrbitPayload(pinnedUt, 6_771_000),
    mu: 3.986e14,
  });
  storeFixture.emitIdentity({
    vesselId: "test-vessel",
    name: "Test Vessel",
    vesselType: 0,
    situation: 0,
    parentBodyIndex: 1,
  });
  return storeFixture;
}

/**
 * Self-consistent Kerbin-like orbit. `meanAnomalyAtEpoch: 0` + `epoch:
 * pinnedUt` puts the vessel at periapsis exactly at the pinned view-UT.
 * `sma`/`ecc` also drive `vessel.state.apoapsisRadius` (`sma·(1+ecc)`,
 * body-radius-independent: see `vessel-state.ts`), which is what this
 * file's `dataKey: "vessel.state.apoapsisRadius"` triggers threshold against: 700_000 · 1.01 =
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

/**
 * Every id the service is still guarding against a second fire whose trigger
 * is no longer listed.
 *
 * Reaches into `fired` on purpose. The guard only has an observable effect
 * while its trigger is still listed, so a set that has been accumulating ids
 * all session behaves exactly like a pruned one from outside, and nothing but
 * the set itself can tell them apart.
 */
function strandedFiredIds(svc: ManeuverTriggerHostService): string[] {
  const listed = svc.snapshot().triggers.map((t) => t.id);
  // biome-ignore lint/complexity/useLiteralKeys: `fired` is private, so dot access does not compile
  return [...svc["fired"]].filter((id) => !listed.includes(id));
}

describe("ManeuverTriggerHostService", () => {
  let storage: Storage;
  /**
   * A service's frame subscription outlives whichever store is registered, so
   * one left undisposed would go on evaluating against the next test's store.
   */
  let built: ManeuverTriggerHostService[];
  beforeEach(() => {
    vi.useFakeTimers();
    storage = memoryStorage();
    built = [];
  });
  afterEach(() => {
    for (const svc of built) svc.dispose();
    vi.useRealTimers();
    setActiveViewClockForTests(undefined);
    setActiveTimelineStoreForTests(undefined);
    setActiveTelemetryClientForTests(undefined);
  });

  function makeService() {
    const svc = new ManeuverTriggerHostService(null, {
      nowMs: () => 1_700_000_000_000,
      storage,
    });
    built.push(svc);
    return svc;
  }

  it("adds an armed trigger and surfaces it in the snapshot", () => {
    const svc = makeService();
    seedKerbinOrbit();
    // 707_000 (baseline apoapsisRadius) stays below 800_000: pending, not fired.
    svc.arm({
      dataKey: "vessel.state.apoapsisRadius",
      op: ">=",
      value: 800_000,
      inputs: FROZEN,
    });
    const snap = svc.snapshot();
    expect(snap.triggers).toHaveLength(1);
    expect(snap.triggers[0].dataKey).toBe("vessel.state.apoapsisRadius");
    expect(snap.triggers[0].vesselName).toBe("Test Vessel");
  });

  it("fires immediately when the condition is already true at arm time", () => {
    const svc = makeService();
    seedKerbinOrbit();
    // 707_000 (baseline apoapsisRadius) already clears 700_000.
    svc.arm({
      dataKey: "vessel.state.apoapsisRadius",
      op: ">=",
      value: 700_000,
      inputs: FROZEN,
    });
    expect(svc.snapshot().triggers).toHaveLength(0);
  });

  it("plans a transfer around a body the stock table has never heard of", async () => {
    const svc = makeService();
    const storeFixture = seedRenamedBodyOrbit();
    // apoapsisRadius is 6_771_000 · 1.01, so this is already true and the
    // trigger fires at arm time, the same path the tests above use.
    svc.arm({
      dataKey: "vessel.state.apoapsisRadius",
      op: ">=",
      value: 6_000_000,
      inputs: {
        ...FROZEN,
        preset: "hohmann-to-altitude",
        targetAltitudeKm: 200,
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    // The transfer is measured from the body's own radius. Without one the
    // plan comes back null and nothing is dispatched at all.
    expect(storeFixture.calls.map((c) => c.command)).toContain(
      "vessel.maneuver.add",
    );
  });

  it("fires when the watched value crosses the threshold after arming", async () => {
    const svc = makeService();
    const storeFixture = seedKerbinOrbit();
    // 707_000 stays below 750_000: pending until the orbit changes.
    svc.arm({
      dataKey: "vessel.state.apoapsisRadius",
      op: ">=",
      value: 750_000,
      inputs: FROZEN,
    });
    expect(storeFixture.calls).toEqual([]);
    // Bump sma so apoapsisRadius (sma·1.01) clears 750_000.
    storeFixture.emitOrbit(kerbinOrbitPayload(1_000_000, 800_000));
    // The command dispatch settles on a microtask (StubTransport answers
    // `command-request` via `queueMicrotask`): drain it before asserting.
    await Promise.resolve();
    await Promise.resolve();
    expect(storeFixture.calls.length).toBe(1);
    expect(storeFixture.calls[0].command).toBe("vessel.maneuver.add");
    expect(svc.snapshot().triggers).toHaveLength(0);
  });

  it("fires a trigger armed while its condition is false, once the condition becomes true", async () => {
    const svc = makeService();
    const storeFixture = seedKerbinOrbit();

    // 707_000 stays below 750_000, so this arms pending and reads as armed
    // against the live vessel.
    svc.arm({
      dataKey: "vessel.state.apoapsisRadius",
      op: ">=",
      value: 750_000,
      inputs: FROZEN,
    });
    expect(svc.snapshot().triggers).toHaveLength(1);
    expect(svc.snapshot().triggers[0].vesselName).toBe("Test Vessel");
    expect(storeFixture.calls).toEqual([]);

    // 707_000 -> 1_010_000, clearing the 750_000 threshold.
    storeFixture.emitOrbit(kerbinOrbitPayload(1_000_000, 800_000));
    await Promise.resolve();
    await Promise.resolve();

    expect(storeFixture.calls.length).toBe(1);
    expect(storeFixture.calls[0].command).toBe("vessel.maneuver.add");
    expect(svc.snapshot().triggers).toHaveLength(0);
  });

  it("auto-clears triggers when the active vessel changes", () => {
    const svc = makeService();
    const storeFixture = seedKerbinOrbit();
    svc.arm({
      dataKey: "vessel.state.apoapsisRadius",
      op: ">=",
      value: 800_000,
      inputs: FROZEN,
    });
    expect(svc.snapshot().triggers).toHaveLength(1);
    storeFixture.emitIdentity({
      vesselId: "different-vessel",
      name: "Different Vessel",
      vesselType: 0,
      situation: 0,
    });
    expect(svc.snapshot().triggers).toHaveLength(0);
  });

  /**
   * `fired` is the guard that stops a listed trigger firing twice, so it only
   * ever needs ids that are still listed. An id left in it after its trigger
   * has gone cannot suppress anything, ids being minted per arm and never
   * reused, but it is held for the service's lifetime, which is the app's.
   */
  it("holds no fired id for a trigger that is no longer listed", () => {
    const svc = makeService();
    const storeFixture = seedKerbinOrbit();

    // Stays pending: 707_000 is below 800_000.
    svc.arm({
      dataKey: "vessel.state.apoapsisRadius",
      op: ">=",
      value: 800_000,
      inputs: FROZEN,
    });
    // Already true at 707_000, so this one fires as it is armed and leaves the list immediately, putting its id in `fired`.
    svc.arm({
      dataKey: "vessel.state.apoapsisRadius",
      op: ">=",
      value: 700_000,
      inputs: FROZEN,
    });
    expect(svc.snapshot().triggers).toHaveLength(1);
    expect(strandedFiredIds(svc)).toEqual([]);

    // The vessel swap drops the pending one, leaving nothing listed at all.
    storeFixture.emitIdentity({
      vesselId: "different-vessel",
      name: "Different Vessel",
      vesselType: 0,
      situation: 0,
    });
    expect(svc.snapshot().triggers).toHaveLength(0);
    expect(strandedFiredIds(svc)).toEqual([]);
  });

  it("persists triggers across construction and restores them on load", () => {
    const svc1 = makeService();
    seedKerbinOrbit();
    svc1.arm({
      dataKey: "vessel.state.apoapsisRadius",
      op: ">=",
      value: 999_999,
      inputs: FROZEN,
    });
    expect(svc1.snapshot().triggers).toHaveLength(1);
    svc1.dispose();
    const svc2 = makeService();
    expect(svc2.snapshot().triggers).toHaveLength(1);
    expect(svc2.snapshot().triggers[0].dataKey).toBe(
      "vessel.state.apoapsisRadius",
    );
  });

  /**
   * A reload, which is the case the test above cannot reach: the service is
   * rebuilt with nothing registered yet, exactly as `MainScreen` rebuilds it
   * on a refresh. A trigger armed against a named vessel has to survive that
   * gap, because the constructor evaluates before any vessel identity has
   * arrived and an unknown vessel is not a different one.
   */
  it("keeps a trigger armed against a named vessel across a reload with no store", () => {
    const svc1 = makeService();
    seedKerbinOrbit();
    svc1.arm({
      dataKey: "vessel.state.apoapsisRadius",
      op: ">=",
      value: 999_999,
      inputs: FROZEN,
    });
    expect(svc1.snapshot().triggers[0].vesselName).toBe("Test Vessel");
    svc1.dispose();

    // The reload: everything the provider registered is gone before the
    // service is rebuilt.
    setActiveTimelineStoreForTests(undefined);
    setActiveViewClockForTests(undefined);
    const svc2 = makeService();

    expect(svc2.snapshot().triggers).toHaveLength(1);
    expect(svc2.snapshot().triggers[0].vesselName).toBe("Test Vessel");
    // Storage keeps it too: a drop here rewrites the list and loses it for
    // every later reload as well.
    expect(
      JSON.parse(storage.getItem("gonogo.maneuverTriggers.list") ?? "[]"),
    ).toHaveLength(1);
  });

  it("cancel() removes a pending trigger and emits a snapshot", () => {
    const svc = makeService();
    const storeFixture = seedKerbinOrbit();
    svc.arm({
      dataKey: "vessel.state.apoapsisRadius",
      op: ">=",
      value: 999_999,
      inputs: FROZEN,
    });
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
