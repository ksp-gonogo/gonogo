import type { DataKey } from "@gonogo/core";
import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@gonogo/core";
import { BufferedDataSource, MemoryStore } from "@gonogo/data";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GroundSurveyComponent } from "./index";
import { rateSmoothness, type SurveySample } from "./useGroundSurveySamples";

const KEYS: DataKey[] = [
  { key: "v.name" },
  { key: "v.missionTime" },
  { key: "v.body" },
  { key: "v.altitude" },
  { key: "v.heightFromTerrain" },
  { key: "v.surfaceSpeed" },
  { key: "v.splashed" },
  { key: "land.predictedLat" },
  { key: "land.predictedLon" },
];

describe("GroundSurveyComponent", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;
  let now = 0;

  beforeEach(async () => {
    clearRegistry();
    source = new MockDataSource({ keys: KEYS });
    now = 1_000_000;
    buffered = new BufferedDataSource({
      source,
      store: new MemoryStore(),
      now: () => now,
    });
    registerDataSource(buffered);
    await buffered.connect();
  });

  afterEach(() => {
    cleanup();
    buffered.disconnect();
  });

  /**
   * Prime: BufferedDataSource only fans out via `subscribeSamples` once a
   * flight has been detected (v.name + v.missionTime). Without this the
   * survey hook never sees a paired sample even after we emit alt + hft.
   */
  function prime(body = "Mun") {
    act(() => {
      source.emit("v.name", "Test");
      source.emit("v.missionTime", 0);
      source.emit("v.body", body);
    });
  }

  /**
   * Tick alt + hft as a tightly-paired pair (within the default 200 ms
   * pair window). The buffered source uses our injected `now()` for the
   * sample timestamp, so we advance `now` between calls — but only past
   * the pair window when we want a new pair.
   */
  function emitAltHft(alt: number, hft: number) {
    act(() => {
      source.emit("v.altitude", alt);
      // No now-advance between alt and hft — they share a timestamp,
      // which is the whole point of subscribeSamples-paired collection.
      source.emit("v.heightFromTerrain", hft);
    });
  }

  it("shows the awaiting placeholder before any telemetry arrives", () => {
    render(<GroundSurveyComponent config={{}} id="survey" />);
    expect(screen.getByText(/Awaiting telemetry/i)).toBeInTheDocument();
  });

  it("flips to surveying once we have v.body + an alt/hft pair above the freeze threshold", () => {
    render(<GroundSurveyComponent config={{}} id="survey" />);
    prime();
    // hft = 5 km → above default 1 km freeze threshold
    now += 200;
    emitAltHft(50_000, 5_000);
    expect(screen.getByText(/Mun/)).toBeInTheDocument();
    expect(screen.getByText(/surveying/)).toBeInTheDocument();
    expect(screen.getByText(/5\.00 km AGL/)).toBeInTheDocument();
  });

  it("freezes once heightFromTerrain drops below the threshold", () => {
    render(<GroundSurveyComponent config={{}} id="survey" />);
    prime();
    // Build a few real samples
    for (let i = 0; i < 5; i++) {
      now += 250;
      emitAltHft(50_000 + i * 10, 5_000 - i * 100);
    }
    expect(screen.getByText(/surveying/)).toBeInTheDocument();
    // Drop below 1 km
    now += 250;
    emitAltHft(45_000, 800);
    expect(screen.getByText(/frozen/)).toBeInTheDocument();
  });

  it("resets the buffer on body change", () => {
    render(<GroundSurveyComponent config={{}} id="survey" />);
    prime("Mun");
    for (let i = 0; i < 4; i++) {
      now += 250;
      emitAltHft(50_000 + i * 10, 5_000 - i * 100);
    }
    // Confirm we have something to wipe.
    expect(screen.getByText(/Mun/)).toBeInTheDocument();
    act(() => {
      source.emit("v.body", "Minmus");
    });
    // Body label updated; the strip should have reset (no badge yet because
    // we need ≥3 real samples again).
    expect(screen.getByText(/Minmus/)).toBeInTheDocument();
  });

  it("renders a smoothness badge once enough samples have accumulated", () => {
    render(<GroundSurveyComponent config={{}} id="survey" />);
    prime();
    // Build a flat profile — should hit the A band.
    for (let i = 0; i < 6; i++) {
      now += 250;
      emitAltHft(50_000, 5_000); // terrain = 45 000 m, σ = 0
    }
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText(/Smooth/i)).toBeInTheDocument();
  });
});

describe("rateSmoothness", () => {
  function flat(n: number, terrain: number): SurveySample[] {
    return Array.from({ length: n }, (_, i) => ({
      t: i * 250,
      terrain,
      kind: "real" as const,
    }));
  }

  it("returns null until 3 real samples are present", () => {
    expect(rateSmoothness([])).toBeNull();
    expect(rateSmoothness(flat(2, 100))).toBeNull();
  });

  it("ignores frozen samples — they're a constant and would deflate σ", () => {
    const samples: SurveySample[] = [
      ...flat(3, 100),
      { t: 800, terrain: 100, kind: "frozen" },
      { t: 1050, terrain: 100, kind: "frozen" },
    ];
    const verdict = rateSmoothness(samples);
    expect(verdict?.badge).toBe("A");
    expect(verdict?.stddev).toBeCloseTo(0, 5);
  });

  it("transitions through the four bands as σ grows", () => {
    expect(rateSmoothness(jagged(0))?.badge).toBe("A");
    expect(rateSmoothness(jagged(120))?.badge).toBe("B");
    expect(rateSmoothness(jagged(280))?.badge).toBe("C");
    expect(rateSmoothness(jagged(800))?.badge).toBe("F");
  });
});

/** Alternating terrain heights with the requested ±half-amplitude. */
function jagged(amplitude: number): SurveySample[] {
  const out: SurveySample[] = [];
  for (let i = 0; i < 10; i++) {
    out.push({
      t: i * 250,
      terrain: 100 + (i % 2 === 0 ? amplitude : -amplitude),
      kind: "real",
    });
  }
  return out;
}
