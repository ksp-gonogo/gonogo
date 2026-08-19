import { describe, expect, it } from "vitest";
import type { FlightRecord } from "../types";
import { MemoryStore } from "./MemoryStore";

function flight(overrides: Partial<FlightRecord> = {}): FlightRecord {
  return {
    id: "f1",
    vesselName: "Kerbal X",
    launchedAt: 1000,
    lastSampleAt: 1000,
    lastMissionTime: 0,
    sampleCount: 0,
    ...overrides,
  };
}

describe("MemoryStore", () => {
  it("upserts and reads a flight", async () => {
    const store = new MemoryStore();
    await store.upsertFlight(flight());
    const got = await store.getFlight("f1");
    expect(got?.vesselName).toBe("Kerbal X");
  });

  it("lists flights sorted by launchedAt descending", async () => {
    const store = new MemoryStore();
    await store.upsertFlight(flight({ id: "old", launchedAt: 1000 }));
    await store.upsertFlight(flight({ id: "new", launchedAt: 2000 }));
    const list = await store.listFlights();
    expect(list.map((f) => f.id)).toEqual(["new", "old"]);
  });

  it("returns a defensive copy from getFlight", async () => {
    const store = new MemoryStore();
    await store.upsertFlight(flight());
    const got = await store.getFlight("f1");
    if (got) got.vesselName = "Mutated";
    const again = await store.getFlight("f1");
    expect(again?.vesselName).toBe("Kerbal X");
  });

  it("appends and queries samples in timestamp order", async () => {
    const store = new MemoryStore();
    await store.appendSample("f1", "v.altitude", 100, 10);
    await store.appendSample("f1", "v.altitude", 200, 20);
    await store.appendSample("f1", "v.altitude", 300, 30);
    const range = await store.queryRange("f1", "v.altitude", 0, 500);
    expect(range.t).toEqual([100, 200, 300]);
    expect(range.v).toEqual([10, 20, 30]);
  });

  it("returns inclusive bounds in queryRange", async () => {
    const store = new MemoryStore();
    for (let t = 100; t <= 500; t += 100) {
      await store.appendSample("f1", "k", t, t);
    }
    const range = await store.queryRange("f1", "k", 200, 400);
    expect(range.t).toEqual([200, 300, 400]);
  });

  it("returns empty range when nothing matches", async () => {
    const store = new MemoryStore();
    const range = await store.queryRange("f1", "missing", 0, 1000);
    expect(range).toEqual({ t: [], v: [] });
  });

  it("binary-inserts out-of-order samples", async () => {
    const store = new MemoryStore();
    await store.appendSample("f1", "k", 300, "c");
    await store.appendSample("f1", "k", 100, "a");
    await store.appendSample("f1", "k", 200, "b");
    const range = await store.queryRange("f1", "k", 0, 1000);
    expect(range.t).toEqual([100, 200, 300]);
    expect(range.v).toEqual(["a", "b", "c"]);
  });

  it("isolates samples per flight", async () => {
    const store = new MemoryStore();
    await store.appendSample("f1", "k", 1, "one");
    await store.appendSample("f2", "k", 1, "two");
    const f1 = await store.queryRange("f1", "k", 0, 10);
    const f2 = await store.queryRange("f2", "k", 0, 10);
    expect(f1.v).toEqual(["one"]);
    expect(f2.v).toEqual(["two"]);
  });

  it("deleteFlight removes the flight + all its samples", async () => {
    const store = new MemoryStore();
    await store.upsertFlight(flight({ id: "f1" }));
    await store.upsertFlight(flight({ id: "f2" }));
    await store.appendSample("f1", "k", 1, "a");
    await store.appendSample("f2", "k", 1, "b");

    await store.deleteFlight("f1");

    expect(await store.getFlight("f1")).toBeNull();
    expect(await store.getFlight("f2")).not.toBeNull();
    expect((await store.queryRange("f1", "k", 0, 10)).v).toEqual([]);
    expect((await store.queryRange("f2", "k", 0, 10)).v).toEqual(["b"]);
  });

  it("clearAllFlights empties both stores", async () => {
    const store = new MemoryStore();
    await store.upsertFlight(flight());
    await store.appendSample("f1", "k", 1, "a");

    await store.clearAllFlights();

    expect(await store.listFlights()).toEqual([]);
    expect((await store.queryRange("f1", "k", 0, 10)).v).toEqual([]);
  });
});
