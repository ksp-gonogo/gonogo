import type { DataKey } from "@ksp-gonogo/core";
import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
import { act, render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { GroundSurveyComponent } from "./index";
import { rateSmoothness, type SurveySample } from "./useGroundSurveySamples";

// Rendered trees, tracked so afterEach can unmount them BEFORE disconnecting the
// legacy source. RTL auto-cleanup runs after this file's afterEach, so it can't
// be relied on to unmount first — buffered.disconnect() firing on a
// still-mounted widget is a state update outside act(), the documented
// anti-pattern in CLAUDE.md.
const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

function unmountAll() {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
}

/**
 * `v.body`/`v.splashed`/`land.predictedLat`/`land.predictedLon` stay on the
 * legacy `MockDataSource`+`BufferedDataSource` pair — those four still read
 * through the 2-arg `useTelemetry` mapTopic shim, which falls back to the
 * legacy source exactly as before when the resolved `vessel.state.*` topic
 * isn't carried (see `useGroundSurveySamples`'s own doc comment).
 * `v.altitude`/`v.heightFromTerrain`/`v.surfaceSpeed` no longer exist as
 * legacy keys at all in this test — they're replaced by a single
 * `vessel.flight` stream emission (`emitFlight`), mounted via a
 * `TelemetryProvider` (`setupStreamFixture`) alongside the legacy source.
 */
const KEYS: DataKey[] = [
  { key: "v.name" },
  { key: "v.missionTime" },
  { key: "v.body" },
  { key: "v.splashed" },
  { key: "land.predictedLat" },
  { key: "land.predictedLon" },
];

describe("GroundSurveyComponent", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;
  let streamFixture: ReturnType<typeof setupStreamFixture>;

  beforeEach(async () => {
    clearRegistry();
    source = new MockDataSource({ keys: KEYS });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
    streamFixture = setupStreamFixture({ carriedChannels: [] });
    // `useTelemetry("vessel.flight")`'s canonical read only delivers once
    // the widget itself has subscribed — it always has by the time a test
    // calls `emitFlight`, since render() happens first — but StubTransport's
    // subscription-gating (see its own doc comment) still needs SOMETHING
    // to have asked first; the widget's own mount satisfies that.
  });

  afterEach(() => {
    unmountAll();
    buffered.disconnect();
  });

  function renderWidget() {
    return render(
      <streamFixture.Provider>
        <GroundSurveyComponent config={{}} id="survey" />
      </streamFixture.Provider>,
    );
  }

  /**
   * Prime: BufferedDataSource only fans the legacy `v.body`/`v.splashed`
   * reads out once a flight has been detected (v.name + v.missionTime).
   */
  function prime(body = "Mun") {
    act(() => {
      source.emit("v.name", "Test");
      source.emit("v.missionTime", 0);
      source.emit("v.body", body);
    });
  }

  /**
   * Emit one atomic `vessel.flight` sample — alt + hft always arrive
   * paired now (see `useGroundSurveySamples`'s doc comment). `beginFrame()`
   * is called explicitly, synchronously, in the SAME `act()` — the
   * provider's own ingest scheduling (`scheduleFrame`) falls back to
   * `queueMicrotask` under jsdom (no `requestAnimationFrame`), which a
   * synchronous `act()` doesn't flush, so a manual seal is needed to make
   * each emit's effect observable before the test's next assertion.
   */
  function emitFlight(alt: number, hft: number, surfaceSpeed = 0) {
    act(() => {
      streamFixture.emit("vessel.flight", {
        latitude: 0,
        longitude: 0,
        altitudeAsl: alt,
        altitudeTerrain: hft,
        verticalSpeed: 0,
        surfaceSpeed,
        orbitalSpeed: 0,
        gForce: 0,
        dynamicPressureKPa: 0,
        mach: 0,
        atmDensity: 0,
        externalTemperature: 0,
        atmosphericTemperature: 0,
      });
      streamFixture.store.beginFrame();
    });
  }

  it("shows the awaiting placeholder before any telemetry arrives", () => {
    renderWidget();
    expect(screen.getByText(/Awaiting telemetry/i)).toBeInTheDocument();
  });

  it("flips to surveying once we have v.body + an alt/hft pair above the freeze threshold", () => {
    renderWidget();
    prime();
    // hft = 5 km → above default 1 km freeze threshold
    emitFlight(50_000, 5_000);
    expect(screen.getByText(/Mun/)).toBeInTheDocument();
    expect(screen.getByText(/surveying/)).toBeInTheDocument();
    expect(screen.getByText(/5\.00 km AGL/)).toBeInTheDocument();
  });

  it("freezes once heightFromTerrain drops below the threshold", () => {
    renderWidget();
    prime();
    // Build a few real samples
    for (let i = 0; i < 5; i++) {
      emitFlight(50_000 + i * 10, 5_000 - i * 100);
    }
    expect(screen.getByText(/surveying/)).toBeInTheDocument();
    // Drop below 1 km
    emitFlight(45_000, 800);
    expect(screen.getByText(/frozen/)).toBeInTheDocument();
  });

  it("resets the buffer on body change", () => {
    renderWidget();
    prime("Mun");
    for (let i = 0; i < 4; i++) {
      emitFlight(50_000 + i * 10, 5_000 - i * 100);
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
    renderWidget();
    prime();
    // Build a flat profile — should hit the A band.
    for (let i = 0; i < 6; i++) {
      emitFlight(50_000, 5_000); // terrain = 45 000 m, σ = 0
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
