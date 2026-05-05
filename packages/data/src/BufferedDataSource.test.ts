import type { DataKey } from "@gonogo/core";
import { MockDataSource } from "@gonogo/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BufferedDataSource } from "./BufferedDataSource";
import { clearDerivedKeys, registerDerivedKey } from "./derive";
import { MemoryStore } from "./storage/MemoryStore";

const MOCK_KEYS: DataKey[] = [
  { key: "v.name" },
  { key: "v.missionTime" },
  { key: "v.altitude" },
  { key: "v.surfaceSpeed" },
];

describe("BufferedDataSource", () => {
  let source: MockDataSource;
  let store: MemoryStore;
  let buffered: BufferedDataSource;
  let clock = 1000;

  beforeEach(async () => {
    source = new MockDataSource({ keys: MOCK_KEYS });
    store = new MemoryStore();
    clock = 1000;
    buffered = new BufferedDataSource({
      source,
      store,
      now: () => clock,
      inMemoryLimit: 10,
    });
    await buffered.connect();
  });

  afterEach(() => {
    buffered.disconnect();
  });

  it("passes through live values to subscribers", () => {
    const spy = vi.fn();
    buffered.subscribe("v.altitude", spy);
    source.emit("v.altitude", 12_345);
    expect(spy).toHaveBeenCalledWith(12_345);
  });

  it("replays the last-known value to late subscribers", () => {
    source.emit("v.altitude", 42);

    const spy = vi.fn();
    buffered.subscribe("v.altitude", spy);
    expect(spy).toHaveBeenCalledWith(42);
    expect(spy).toHaveBeenCalledTimes(1);

    source.emit("v.altitude", 43);
    expect(spy).toHaveBeenLastCalledWith(43);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("does not replay when no value has been emitted yet", () => {
    const spy = vi.fn();
    buffered.subscribe("v.altitude", spy);
    expect(spy).not.toHaveBeenCalled();
  });

  describe("demand subscriptions for indexed/dynamic keys", () => {
    it("forwards subscriptions for keys outside the static schema upstream", () => {
      // `b.name[1]` isn't in MOCK_KEYS — the wrapper must still subscribe
      // upstream when a widget asks for it, otherwise the upstream WS never
      // carries the key and values never arrive.
      const spy = vi.fn();
      buffered.subscribe("b.name[1]", spy);
      source.emit("b.name[1]", "Kerbin");
      expect(spy).toHaveBeenCalledWith("Kerbin");
    });

    it("ref-counts demand subscriptions across multiple subscribers", () => {
      // Two widgets share one upstream sub. Tearing one down keeps the
      // upstream alive for the other.
      const a = vi.fn();
      const b = vi.fn();
      const unsubA = buffered.subscribe("b.name[1]", a);
      buffered.subscribe("b.name[1]", b);

      unsubA();
      source.emit("b.name[1]", "Kerbin");
      expect(b).toHaveBeenCalledWith("Kerbin");
    });

    it("stops fanning out values after the last widget unsubscribes", () => {
      const spy = vi.fn();
      const unsub = buffered.subscribe("b.name[1]", spy);
      source.emit("b.name[1]", "Kerbin");
      expect(spy).toHaveBeenCalledTimes(1);
      unsub();
      source.emit("b.name[1]", "Mun");
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe("subscribeCollection", () => {
    it("emits an array of current values whenever any key changes", () => {
      const spy = vi.fn();
      const unsub = buffered.subscribeCollection(
        ["v.altitude", "v.surfaceSpeed"],
        spy,
      );
      source.emit("v.altitude", 100);
      source.emit("v.surfaceSpeed", 42);

      // Two emits — one per raw sample. Order matches the keys array.
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenNthCalledWith(1, [100, undefined]);
      expect(spy).toHaveBeenNthCalledWith(2, [100, 42]);

      source.emit("v.altitude", 101);
      expect(spy).toHaveBeenLastCalledWith([101, 42]);

      unsub();
      source.emit("v.altitude", 999);
      expect(spy).toHaveBeenCalledTimes(3);
    });

    it("replays last-known values on subscribe so late subscribers see the snapshot", () => {
      source.emit("v.altitude", 500);

      const spy = vi.fn();
      buffered.subscribeCollection(["v.altitude", "v.surfaceSpeed"], spy);

      // Replay for v.altitude fires during setup; v.surfaceSpeed has no value,
      // so its snapshot slot stays undefined.
      expect(spy).toHaveBeenCalledWith([500, undefined]);
    });
  });

  it("persists samples once a flight has been identified", async () => {
    source.emit("v.name", "Kerbal X");
    source.emit("v.missionTime", 0);
    clock = 2000;
    source.emit("v.altitude", 100);

    const flight = buffered.getCurrentFlight();
    expect(flight).not.toBeNull();
    const range = await buffered.queryRange("v.altitude", 0, 10_000);
    expect(range.v).toEqual([100]);
    expect(range.t).toEqual([2000]);
  });

  it("drops samples that arrive before v.name + v.missionTime", async () => {
    source.emit("v.altitude", 999); // pre-flight, should be dropped
    source.emit("v.name", "Kerbal X");
    source.emit("v.missionTime", 0);
    source.emit("v.altitude", 100);

    const range = await buffered.queryRange("v.altitude", 0, 10_000);
    expect(range.v).toEqual([100]);
  });

  it("mints a new flight on mission-time revert", async () => {
    source.emit("v.name", "KX");
    source.emit("v.missionTime", 100);
    const first = buffered.getCurrentFlight();

    clock = 2000;
    source.emit("v.missionTime", 5);
    const second = buffered.getCurrentFlight();

    expect(second?.id).not.toBe(first?.id);
    const flights = await buffered.listFlights();
    expect(flights).toHaveLength(2);
  });

  it("emits onFlightChange when the flight transitions", () => {
    const spy = vi.fn();
    buffered.onFlightChange(spy);

    source.emit("v.name", "KX");
    source.emit("v.missionTime", 0);
    expect(spy).toHaveBeenCalledTimes(1);

    // Another sample in the same flight — no transition.
    source.emit("v.missionTime", 1);
    expect(spy).toHaveBeenCalledTimes(1);

    // Revert → new flight.
    source.emit("v.missionTime", -10);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("getLatest returns in-memory ring buffer", () => {
    source.emit("v.name", "KX");
    source.emit("v.missionTime", 0);
    for (let i = 0; i < 5; i++) {
      clock += 100;
      source.emit("v.altitude", i);
    }
    const latest = buffered.getLatest("v.altitude");
    expect(latest.v).toEqual([0, 1, 2, 3, 4]);
  });

  it("trims in-memory buffer at the configured limit", () => {
    source.emit("v.name", "KX");
    source.emit("v.missionTime", 0);
    for (let i = 0; i < 25; i++) {
      clock += 100;
      source.emit("v.altitude", i);
    }
    const latest = buffered.getLatest("v.altitude");
    expect(latest.v).toHaveLength(10);
    expect(latest.v[0]).toBe(15);
    expect(latest.v[9]).toBe(24);
  });

  it("deleteFlight removes the flight and its samples", async () => {
    source.emit("v.name", "KX");
    source.emit("v.missionTime", 0);
    source.emit("v.altitude", 42);
    const id = buffered.getCurrentFlight()?.id;
    expect(id).toBeDefined();

    await buffered.deleteFlight(id ?? "missing");
    expect(buffered.getCurrentFlight()).toBeNull();
    expect(await buffered.listFlights()).toEqual([]);
  });

  it("mints a new flight after the current flight is deleted", async () => {
    source.emit("v.name", "KX");
    source.emit("v.missionTime", 0);
    const firstId = buffered.getCurrentFlight()?.id;
    expect(firstId).toBeDefined();

    await buffered.deleteFlight(firstId ?? "");
    expect(buffered.getCurrentFlight()).toBeNull();

    clock = 2000;
    source.emit("v.name", "KX");
    source.emit("v.missionTime", 1);
    const second = buffered.getCurrentFlight();
    expect(second?.id).toBeDefined();
    expect(second?.id).not.toBe(firstId);
  });

  it("setFlightStarred persists the flag and is idempotent", async () => {
    source.emit("v.name", "KX");
    source.emit("v.missionTime", 0);
    source.emit("v.altitude", 1);
    const id = buffered.getCurrentFlight()?.id ?? "";
    expect(id).not.toBe("");

    const upsertSpy = vi.spyOn(store, "upsertFlight");

    await buffered.setFlightStarred(id, true);
    expect((await buffered.getFlight(id))?.starred).toBe(true);
    const calls = upsertSpy.mock.calls.length;

    // No-op when already in the requested state.
    await buffered.setFlightStarred(id, true);
    expect(upsertSpy.mock.calls.length).toBe(calls);

    await buffered.setFlightStarred(id, false);
    expect((await buffered.getFlight(id))?.starred).toBe(false);
  });

  it("pruneFlightsKeepLatest keeps the N most recent unstarred flights and evicts the rest", async () => {
    for (let i = 0; i < 5; i++) {
      await store.upsertFlight({
        id: `f-${i}`,
        vesselName: `V${i}`,
        launchedAt: i * 1000, // f-4 newest, f-0 oldest
        lastSampleAt: i * 1000 + 100,
        lastMissionTime: 0,
        sampleCount: 1,
      });
    }

    const deleted = await buffered.pruneFlightsKeepLatest({ keepCount: 2 });

    // f-4 and f-3 are the two newest unstarred flights — keep them.
    expect(deleted.sort()).toEqual(["f-0", "f-1", "f-2"]);
    const remaining = (await buffered.listFlights()).map((f) => f.id).sort();
    expect(remaining).toEqual(["f-3", "f-4"]);
  });

  it("pruneFlightsKeepLatest exempts starred flights from the cap and from eviction", async () => {
    // Two starred and three unstarred. Cap of 1 should keep one starred-aside
    // unstarred plus both starred, dropping the older two unstarred.
    await store.upsertFlight({
      id: "starred-old",
      vesselName: "S1",
      launchedAt: 100,
      lastSampleAt: 200,
      lastMissionTime: 0,
      sampleCount: 1,
      starred: true,
    });
    await store.upsertFlight({
      id: "unstarred-old",
      vesselName: "U1",
      launchedAt: 300,
      lastSampleAt: 400,
      lastMissionTime: 0,
      sampleCount: 1,
    });
    await store.upsertFlight({
      id: "unstarred-mid",
      vesselName: "U2",
      launchedAt: 500,
      lastSampleAt: 600,
      lastMissionTime: 0,
      sampleCount: 1,
    });
    await store.upsertFlight({
      id: "starred-new",
      vesselName: "S2",
      launchedAt: 700,
      lastSampleAt: 800,
      lastMissionTime: 0,
      sampleCount: 1,
      starred: true,
    });
    await store.upsertFlight({
      id: "unstarred-new",
      vesselName: "U3",
      launchedAt: 900,
      lastSampleAt: 1000,
      lastMissionTime: 0,
      sampleCount: 1,
    });

    const deleted = await buffered.pruneFlightsKeepLatest({ keepCount: 1 });

    expect(deleted.sort()).toEqual(["unstarred-mid", "unstarred-old"]);
    const remaining = (await buffered.listFlights()).map((f) => f.id).sort();
    expect(remaining).toEqual(["starred-new", "starred-old", "unstarred-new"]);
  });

  it("pruneFlightsKeepLatest never evicts the current flight", async () => {
    // Mint a current flight via the detector.
    source.emit("v.name", "KX");
    source.emit("v.missionTime", 0);
    source.emit("v.altitude", 1);
    const currentId = buffered.getCurrentFlight()?.id ?? "";
    expect(currentId).not.toBe("");

    // Add older flights that would otherwise be victims.
    await store.upsertFlight({
      id: "old-1",
      vesselName: "Old1",
      launchedAt: -2000,
      lastSampleAt: -1900,
      lastMissionTime: 0,
      sampleCount: 1,
    });
    await store.upsertFlight({
      id: "old-2",
      vesselName: "Old2",
      launchedAt: -1000,
      lastSampleAt: -900,
      lastMissionTime: 0,
      sampleCount: 1,
    });

    const deleted = await buffered.pruneFlightsKeepLatest({ keepCount: 1 });
    // Current is exempt; among the two olds only the older is dropped.
    expect(deleted).toEqual(["old-1"]);
    expect(await buffered.getFlight(currentId)).not.toBeNull();
  });

  it("pruneFlightsKeepLatest is a no-op when keepCount <= 0", async () => {
    await store.upsertFlight({
      id: "any",
      vesselName: "Any",
      launchedAt: 0,
      lastSampleAt: 0,
      lastMissionTime: 0,
      sampleCount: 1,
    });
    const deleted = await buffered.pruneFlightsKeepLatest({ keepCount: 0 });
    expect(deleted).toEqual([]);
    expect((await buffered.listFlights()).length).toBe(1);
  });

  it("clearAllFlights wipes storage and in-memory buffer", async () => {
    source.emit("v.name", "KX");
    source.emit("v.missionTime", 0);
    source.emit("v.altitude", 42);

    await buffered.clearAllFlights();

    expect(buffered.getCurrentFlight()).toBeNull();
    expect(await buffered.listFlights()).toEqual([]);
    expect(buffered.getLatest("v.altitude").v).toEqual([]);
  });

  it("hydrates the detector from the store on connect (resume across reloads)", async () => {
    // Simulate a previously-persisted flight.
    await store.upsertFlight({
      id: "seed-1",
      vesselName: "KX",
      vesselUid: null,
      launchedAt: 0,
      lastSampleAt: 500,
      lastMissionTime: 50,
      sampleCount: 5,
    });
    buffered.disconnect();

    const fresh = new BufferedDataSource({
      source,
      store,
      now: () => 1_000,
      inMemoryLimit: 10,
    });
    await fresh.connect();

    source.emit("v.name", "KX");
    source.emit("v.missionTime", 51);

    expect(fresh.getCurrentFlight()?.id).toBe("seed-1");
    fresh.disconnect();
  });

  it("proxies status changes from the wrapped source", () => {
    const spy = vi.fn();
    buffered.onStatusChange(spy);
    source.disconnect();
    expect(spy).toHaveBeenCalledWith("disconnected");
  });

  it("schema() enriches raw keys with metadata", () => {
    const schema = buffered.schema();
    const alt = schema.find((k) => k.key === "v.altitude");
    expect(alt?.label).toBe("Altitude");
    expect(alt?.unit).toBe("m");
    expect(alt?.group).toBe("Position");
  });

  it("schema() falls back to key-as-label for keys absent from telemachusMeta", () => {
    // Use a mock source that includes a key with no metadata entry.
    const unknownSource = new MockDataSource({
      keys: [
        { key: "v.name" },
        { key: "v.missionTime" },
        { key: "totally.unknown.key" },
      ],
    });
    const buf = new BufferedDataSource({
      source: unknownSource,
      store: new MemoryStore(),
      now: () => clock,
    });
    // connect() is not needed — schema() is synchronous
    const schema = buf.schema();
    const unknown = schema.find((k) => k.key === "totally.unknown.key");
    expect(unknown?.label).toBe("totally.unknown.key");
    expect(unknown?.group).toBe("Other");
  });
});

describe("BufferedDataSource — derived keys", () => {
  let source: MockDataSource;
  let store: MemoryStore;
  let buffered: BufferedDataSource;
  let clock = 1000;

  const KEYS_WITH_ALTITUDE: DataKey[] = [
    { key: "v.name" },
    { key: "v.missionTime" },
    { key: "v.altitude" },
  ];

  beforeEach(async () => {
    clearDerivedKeys();
    source = new MockDataSource({ keys: KEYS_WITH_ALTITUDE });
    store = new MemoryStore();
    clock = 1000;
    buffered = new BufferedDataSource({
      source,
      store,
      now: () => clock,
      inMemoryLimit: 50,
    });
    await buffered.connect();
    // Establish a flight
    source.emit("v.name", "KX");
    source.emit("v.missionTime", 0);
  });

  afterEach(() => {
    buffered.disconnect();
    clearDerivedKeys();
  });

  it("emits derived value to subscribe() subscribers", () => {
    registerDerivedKey({
      id: "test.double",
      inputs: ["v.altitude"],
      meta: { label: "Doubled altitude", group: "Test" },
      fn: ([alt]) => (alt.v as number) * 2,
    });

    const spy = vi.fn();
    buffered.subscribe("test.double", spy);

    source.emit("v.altitude", 500);
    expect(spy).toHaveBeenCalledWith(1000);
  });

  it("emits derived value to subscribeSamples() subscribers", () => {
    registerDerivedKey({
      id: "test.double",
      inputs: ["v.altitude"],
      meta: { label: "Doubled altitude", group: "Test" },
      fn: ([alt]) => (alt.v as number) * 2,
    });

    const spy = vi.fn();
    buffered.subscribeSamples("test.double", spy);

    clock = 2000;
    source.emit("v.altitude", 500);
    expect(spy).toHaveBeenCalledWith({ t: 2000, v: 1000 });
  });

  it("does not emit derived value until all inputs have been seen", () => {
    registerDerivedKey({
      id: "test.sum",
      inputs: ["v.altitude", "v.missionTime"],
      meta: { label: "Sum", group: "Test" },
      fn: ([alt, mt]) => (alt.v as number) + (mt.v as number),
    });

    const spy = vi.fn();
    buffered.subscribe("test.sum", spy);

    // missionTime arrived in beforeEach, but altitude has not yet
    source.emit("v.altitude", 100);
    expect(spy).toHaveBeenCalledTimes(1); // fires now — both inputs seen
  });

  it("does not emit derived value when fn returns undefined", () => {
    registerDerivedKey({
      id: "test.noFirst",
      inputs: ["v.altitude"],
      meta: { label: "No first", group: "Test" },
      fn: (_inputs, previous) => (previous === null ? undefined : 42),
    });

    const spy = vi.fn();
    buffered.subscribe("test.noFirst", spy);

    source.emit("v.altitude", 100); // first — fn returns undefined
    expect(spy).not.toHaveBeenCalled();

    source.emit("v.altitude", 200); // second — fn returns 42
    expect(spy).toHaveBeenCalledWith(42);
  });

  it("persists derived samples to the store", async () => {
    registerDerivedKey({
      id: "test.double",
      inputs: ["v.altitude"],
      meta: { label: "Doubled altitude", group: "Test" },
      fn: ([alt]) => (alt.v as number) * 2,
    });

    clock = 3000;
    source.emit("v.altitude", 100);

    const range = await buffered.queryRange("test.double", 0, 99_999);
    expect(range.v).toEqual([200]);
  });

  it("schema() includes registered derived keys", () => {
    registerDerivedKey({
      id: "test.double",
      inputs: ["v.altitude"],
      meta: { label: "Doubled altitude", unit: "m", group: "Test" },
      fn: ([alt]) => (alt.v as number) * 2,
    });

    const schema = buffered.schema();
    const derived = schema.find((k) => k.key === "test.double");
    expect(derived?.label).toBe("Doubled altitude");
    expect(derived?.unit).toBe("m");
    expect(derived?.group).toBe("Test");
  });

  it("resets derivedPrevious on flight transition so rate does not straddle flights", () => {
    registerDerivedKey({
      id: "test.rate",
      inputs: ["v.altitude"],
      meta: { label: "Rate", group: "Test" },
      fn: ([alt], previous) => {
        if (previous === null) return undefined;
        const dt = (alt.t - previous[0].t) / 1000;
        return ((alt.v as number) - (previous[0].v as number)) / dt;
      },
    });

    const spy = vi.fn();
    buffered.subscribe("test.rate", spy);

    clock = 1000;
    source.emit("v.altitude", 100); // first — no previous, no emit
    clock = 2000;
    source.emit("v.altitude", 200); // 100 m/s
    expect(spy).toHaveBeenCalledWith(100);

    spy.mockClear();

    // Trigger a new flight via missionTime revert
    source.emit("v.missionTime", -10);
    // First altitude after flight change — previous is cleared, so no rate
    clock = 3000;
    source.emit("v.altitude", 50);
    expect(spy).not.toHaveBeenCalled();
  });

  it("clearAllFlights resets derivation state", async () => {
    registerDerivedKey({
      id: "test.rate",
      inputs: ["v.altitude"],
      meta: { label: "Rate", group: "Test" },
      fn: ([alt], previous) =>
        previous === null
          ? undefined
          : (alt.v as number) - (previous[0].v as number),
    });

    source.emit("v.altitude", 100); // seeds lastRawSample + derivedPrevious

    await buffered.clearAllFlights(); // clears derivedPrevious synchronously before returns

    const spy = vi.fn();
    buffered.subscribe("test.rate", spy);
    source.emit("v.altitude", 50); // after clear — previous is null, no emit
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// CommNet blackout gating
// ---------------------------------------------------------------------------

const GATED_KEYS: DataKey[] = [
  { key: "v.name" },
  { key: "v.missionTime" },
  { key: "v.altitude" },
  { key: "comm.connected" },
];

describe("BufferedDataSource — affectedBySignalLoss gate", () => {
  let source: MockDataSource;
  let store: MemoryStore;
  let buffered: BufferedDataSource;
  let clock = 1000;

  beforeEach(async () => {
    source = new MockDataSource({
      keys: GATED_KEYS,
      affectedBySignalLoss: true,
    });
    store = new MemoryStore();
    clock = 1000;
    buffered = new BufferedDataSource({ source, store, now: () => clock });
    await buffered.connect();

    // Prime a flight so persistence path is active. Also confirm comm link
    // so subsequent `false` actually activates the gate — a cold-start
    // `false` is intentionally NOT trusted (see the dedicated test).
    source.emit("v.name", "Kerbal X");
    source.emit("v.missionTime", 0);
    source.emit("comm.connected", true);
  });

  afterEach(() => {
    buffered.disconnect();
  });

  it("drops non-comm.* samples while signal is down", async () => {
    const spy = vi.fn();
    buffered.subscribe("v.altitude", spy);

    clock = 2000;
    source.emit("v.altitude", 100); // before blackout — stored + emitted
    expect(spy).toHaveBeenLastCalledWith(100);

    source.emit("comm.connected", false); // signal loss

    clock = 3000;
    source.emit("v.altitude", 999); // during blackout — dropped
    expect(spy).toHaveBeenLastCalledWith(100); // subscriber still sees pre-blackout value

    const range = await buffered.queryRange("v.altitude", 0, 10_000);
    expect(range.v).toEqual([100]); // persisted data has a clean gap
  });

  it("resumes on signal restore", async () => {
    source.emit("comm.connected", false);

    clock = 2000;
    source.emit("v.altitude", 500); // dropped
    source.emit("comm.connected", true);

    clock = 3000;
    source.emit("v.altitude", 600); // flows again

    const range = await buffered.queryRange("v.altitude", 0, 10_000);
    expect(range.v).toEqual([600]);
  });

  it("always lets comm.* keys through during blackout (so we detect restore)", () => {
    const spy = vi.fn();
    buffered.subscribe("comm.connected", spy);

    source.emit("comm.connected", false);
    source.emit("comm.connected", true);

    expect(spy).toHaveBeenCalledWith(false);
    expect(spy).toHaveBeenCalledWith(true);
  });

  it("does NOT gate on a cold-start comm.connected=false (no confirmed link yet)", async () => {
    // Tear down and rebuild without the priming `comm.connected: true` — this
    // replicates the real-world scenario where Telemachus reports false
    // because there's no vessel / CommNet is disabled / similar. Previous
    // versions spuriously gated here and widgets went dark on every load.
    buffered.disconnect();
    buffered = new BufferedDataSource({ source, store, now: () => clock });
    await buffered.connect();

    source.emit("v.name", "Kerbal X");
    source.emit("v.missionTime", 0);
    source.emit("comm.connected", false); // cold-start false — ignored

    clock = 5000;
    source.emit("v.altitude", 42);
    const range = await buffered.queryRange("v.altitude", 0, 10_000);
    expect(range.v).toContain(42);
  });

  it("does not gate sources that leave affectedBySignalLoss false", async () => {
    // Tear down the default-wrapped buffered source and rebuild with the gate
    // flag off so we can verify gating is opt-in.
    buffered.disconnect();
    source.affectedBySignalLoss = false;
    buffered = new BufferedDataSource({ source, store, now: () => clock });
    await buffered.connect();

    source.emit("v.name", "Kerbal X");
    source.emit("v.missionTime", 10);
    source.emit("comm.connected", false);

    clock = 4000;
    source.emit("v.altitude", 777); // would be dropped on a gated source

    const range = await buffered.queryRange("v.altitude", 0, 10_000);
    expect(range.v).toContain(777);
  });
});

// ── External-source ingestion (kOS) ────────────────────────────────────────

describe("BufferedDataSource — external-source ingestion (appendExternalSample)", () => {
  let source: MockDataSource;
  let store: MemoryStore;
  let buffered: BufferedDataSource;
  let clock = 1000;

  beforeEach(async () => {
    source = new MockDataSource({ keys: MOCK_KEYS });
    store = new MemoryStore();
    clock = 1000;
    buffered = new BufferedDataSource({
      source,
      store,
      now: () => clock,
      inMemoryLimit: 100,
    });
    await buffered.connect();
    // Establish a flight so persistence + sample fanout fires.
    source.emit("v.name", "Kerbal X");
    source.emit("v.missionTime", 0);
  });

  afterEach(() => {
    buffered.disconnect();
  });

  it("fans out external samples to live subscribers", () => {
    const spy = vi.fn();
    buffered.subscribe("kos.compute.demo.value", spy);
    buffered.appendExternalSample("kos.compute.demo.value", 42);
    expect(spy).toHaveBeenCalledWith(42);
  });

  it("persists external samples into the current flight's store", async () => {
    clock = 2000;
    buffered.appendExternalSample("kos.compute.demo.value", 100);
    clock = 3000;
    buffered.appendExternalSample("kos.compute.demo.value", 200);
    const range = await buffered.queryRange(
      "kos.compute.demo.value",
      0,
      10_000,
    );
    expect(range).toEqual({ t: [2000, 3000], v: [100, 200] });
  });

  it("fires timestamped sample subscribers (useDataSeries path)", () => {
    const samples: { t: number; v: unknown }[] = [];
    buffered.subscribeSamples("kos.compute.demo.value", (s) => samples.push(s));
    clock = 2500;
    buffered.appendExternalSample("kos.compute.demo.value", 7);
    expect(samples).toEqual([{ t: 2500, v: 7 }]);
  });

  it("replays the last-known external value to late subscribers", () => {
    buffered.appendExternalSample("kos.compute.demo.value", "ready");
    const spy = vi.fn();
    buffered.subscribe("kos.compute.demo.value", spy);
    expect(spy).toHaveBeenCalledWith("ready");
  });

  it("does NOT pass through the signal-loss gate (kOS isn't comm-affected)", async () => {
    source.affectedBySignalLoss = true;
    source.emit("comm.connected", true); // confirm a prior link
    source.emit("comm.connected", false); // gate now active
    clock = 4000;
    buffered.appendExternalSample("kos.compute.demo.value", 99);
    const range = await buffered.queryRange(
      "kos.compute.demo.value",
      0,
      10_000,
    );
    expect(range.v).toContain(99);
  });

  it("does not advance the FlightDetector (driven by v.missionTime only)", () => {
    const before = buffered.getCurrentFlight()?.id;
    buffered.appendExternalSample("kos.compute.demo.value", 1);
    const after = buffered.getCurrentFlight()?.id;
    expect(after).toBe(before);
  });
});

describe("BufferedDataSource — registerExternalKeys", () => {
  let source: MockDataSource;
  let store: MemoryStore;
  let buffered: BufferedDataSource;

  beforeEach(async () => {
    source = new MockDataSource({ keys: MOCK_KEYS });
    store = new MemoryStore();
    buffered = new BufferedDataSource({ source, store });
    await buffered.connect();
  });

  afterEach(() => {
    buffered.disconnect();
  });

  it("merges external keys into schema() output", () => {
    buffered.registerExternalKeys([
      { key: "kos.compute.demo.value", label: "Demo value", group: "kOS" },
    ]);
    const keys = buffered.schema().map((k) => k.key);
    expect(keys).toContain("kos.compute.demo.value");
  });

  it("preserves the supplied DataKeyMeta shape", () => {
    buffered.registerExternalKeys([
      { key: "kos.compute.x.y", label: "X.Y", group: "kOS", unit: "raw" },
    ]);
    const found = buffered.schema().find((k) => k.key === "kos.compute.x.y");
    expect(found).toMatchObject({ label: "X.Y", group: "kOS", unit: "raw" });
  });

  it("re-registering a key replaces the previous metadata", () => {
    buffered.registerExternalKeys([
      { key: "kos.compute.demo.value", label: "Old" },
    ]);
    buffered.registerExternalKeys([
      { key: "kos.compute.demo.value", label: "New" },
    ]);
    const found = buffered
      .schema()
      .find((k) => k.key === "kos.compute.demo.value");
    expect(found?.label).toBe("New");
  });
});
