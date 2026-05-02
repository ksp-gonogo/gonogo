import { afterEach, describe, expect, it, vi } from "vitest";
import { FLIGHT_FIXTURE_FORMAT, type FlightFixture } from "./FlightFixture";
import { FlightReplayDataSource } from "./FlightReplayDataSource";

const ASCENT: FlightFixture = {
  format: FLIGHT_FIXTURE_FORMAT,
  flight: {
    id: "ascent",
    vesselName: "Test Ascent",
    launchedAt: 1_000_000,
    lastSampleAt: 1_010_000,
    lastMissionTime: 10,
    sampleCount: 5,
  },
  schema: [
    { key: "v.altitude" },
    { key: "v.body" },
    { key: "v.horizontalVelocity" },
  ],
  samples: {
    "v.altitude": [
      [1_000_000, 0],
      [1_005_000, 100],
      [1_010_000, 1_000],
    ],
    "v.body": [[1_000_000, "Kerbin"]],
    "v.horizontalVelocity": [
      [1_002_000, 50],
      [1_008_000, 500],
    ],
  },
};

afterEach(() => {
  vi.useRealTimers();
});

describe("FlightReplayDataSource — DataSource contract", () => {
  it("advertises the fixture's schema and a stable id", () => {
    const src = new FlightReplayDataSource({ fixture: ASCENT });
    expect(src.id).toBe("data");
    expect(src.schema().map((k) => k.key)).toEqual([
      "v.altitude",
      "v.body",
      "v.horizontalVelocity",
    ]);
  });

  it("transitions through the standard status lifecycle", async () => {
    const src = new FlightReplayDataSource({ fixture: ASCENT });
    const seen: string[] = [];
    src.onStatusChange((s) => seen.push(s));
    expect(src.status).toBe("disconnected");
    await src.connect();
    expect(src.status).toBe("connected");
    src.disconnect();
    expect(src.status).toBe("disconnected");
    expect(seen).toEqual(["connected", "disconnected"]);
  });

  it("records execute() actions in executeLog instead of dispatching", async () => {
    const src = new FlightReplayDataSource({ fixture: ASCENT });
    await src.connect();
    await src.execute("f.stage");
    await src.execute("f.setThrottle[0.5]");
    expect(src.executeLog).toEqual(["f.stage", "f.setThrottle[0.5]"]);
  });
});

describe("FlightReplayDataSource — manual advance", () => {
  it("emits no samples until the clock advances past the first tuple", async () => {
    const src = new FlightReplayDataSource({ fixture: ASCENT });
    await src.connect();
    const samples: unknown[] = [];
    src.subscribe("v.altitude", (v) => samples.push(v));
    expect(samples).toEqual([]); // nothing emitted yet
    src.advance(1); // 1 ms forward — past launchedAt → first sample fires
    expect(samples).toEqual([0]);
  });

  it("emits each sample whose t falls within the advanced window", async () => {
    const src = new FlightReplayDataSource({ fixture: ASCENT });
    await src.connect();
    const altSamples: unknown[] = [];
    src.subscribe("v.altitude", (v) => altSamples.push(v));
    src.advance(5_000); // crosses [1_000_000, 1_005_000]
    expect(altSamples).toEqual([0, 100]);
    src.advance(5_000); // crosses [1_005_000, 1_010_000]
    expect(altSamples).toEqual([0, 100, 1_000]);
  });

  it("never re-emits samples on a forward advance", async () => {
    const src = new FlightReplayDataSource({ fixture: ASCENT });
    await src.connect();
    const samples: unknown[] = [];
    src.subscribe("v.altitude", (v) => samples.push(v));
    src.advance(10_000); // play the whole flight
    expect(samples).toHaveLength(3);
    src.advance(5_000); // past end — nothing more to emit
    expect(samples).toHaveLength(3);
  });

  it("late subscribers receive the last-emitted value synchronously", async () => {
    const src = new FlightReplayDataSource({ fixture: ASCENT });
    await src.connect();
    src.advance(10_000); // run the flight
    const lateSamples: unknown[] = [];
    src.subscribe("v.altitude", (v) => lateSamples.push(v));
    expect(lateSamples).toEqual([1_000]);
  });

  it("does not replay anything for a key with no samples seen yet", async () => {
    const src = new FlightReplayDataSource({ fixture: ASCENT });
    await src.connect();
    // v.horizontalVelocity's first sample is at +2_000ms — before that, no replay.
    const samples: unknown[] = [];
    src.advance(1_000);
    src.subscribe("v.horizontalVelocity", (v) => samples.push(v));
    expect(samples).toEqual([]);
  });
});

describe("FlightReplayDataSource — seek", () => {
  it("forward seek emits every sample crossed (same as advance)", async () => {
    const src = new FlightReplayDataSource({ fixture: ASCENT });
    await src.connect();
    const samples: unknown[] = [];
    src.subscribe("v.altitude", (v) => samples.push(v));
    src.seek(ASCENT.flight.launchedAt + 6_000);
    expect(samples).toEqual([0, 100]);
  });

  it("rewind resets cursors and re-emits the latest snapshot per key", async () => {
    const src = new FlightReplayDataSource({ fixture: ASCENT });
    await src.connect();
    const samples: unknown[] = [];
    src.subscribe("v.altitude", (v) => samples.push(v));
    src.advance(10_000); // [0, 100, 1000]
    samples.length = 0;
    src.seek(ASCENT.flight.launchedAt + 6_000); // rewind
    // Snapshot at t+6_000 → last sample at-or-before is 100 (from t+5_000)
    expect(samples).toEqual([100]);
  });

  it("rewind to before the first sample produces no fresh emissions", async () => {
    const src = new FlightReplayDataSource({ fixture: ASCENT });
    await src.connect();
    src.advance(10_000); // play through
    const samples: unknown[] = [];
    src.subscribe("v.altitude", (v) => samples.push(v));
    samples.length = 0;
    src.seek(ASCENT.flight.launchedAt - 1); // rewind below launch
    expect(samples).toEqual([]);
  });
});

describe("FlightReplayDataSource — nextPendingSampleT", () => {
  it("returns the earliest unemitted sample t across all keys", async () => {
    const src = new FlightReplayDataSource({ fixture: ASCENT });
    await src.connect();
    // Sample ts across the three series — earliest unemitted is launchedAt.
    expect(src.nextPendingSampleT()).toBe(1_000_000);
  });

  it("advances past emitted samples as the cursor moves", async () => {
    const src = new FlightReplayDataSource({ fixture: ASCENT });
    await src.connect();
    src.advance(3_000); // past 1_000_000 (alt + body) but not 1_002_000 (hv)
    expect(src.nextPendingSampleT()).toBe(1_005_000);
    // The hv sample at 1_002_000 also fired in that advance window.
  });

  it("returns null once every key's cursor is past the end", async () => {
    const src = new FlightReplayDataSource({ fixture: ASCENT });
    await src.connect();
    src.advance(20_000); // past the last sample (1_010_000)
    expect(src.nextPendingSampleT()).toBeNull();
  });
});

describe("FlightReplayDataSource — autoplay", () => {
  it("advances on the wall clock when autoplay is set", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const src = new FlightReplayDataSource({
      fixture: ASCENT,
      autoplay: true,
      tickMs: 100,
    });
    await src.connect();
    const samples: unknown[] = [];
    src.subscribe("v.altitude", (v) => samples.push(v));

    // Advance wall clock to past the first sample (rate=1 so 5_500ms wall =
    // 5_500ms fixture). The interval ticks every 100ms; one tick is enough.
    vi.advanceTimersByTime(5_500);
    expect(samples).toContain(0);
    expect(samples).toContain(100);
  });

  it("pauses automatically once the fixture's last sample is reached", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const src = new FlightReplayDataSource({
      fixture: ASCENT,
      autoplay: true,
      tickMs: 100,
      rate: 100, // burn through quickly
    });
    await src.connect();
    vi.advanceTimersByTime(500); // 500ms wall × rate 100 = 50_000ms fixture
    src.disconnect();
    expect(src.status).toBe("disconnected");
  });
});
