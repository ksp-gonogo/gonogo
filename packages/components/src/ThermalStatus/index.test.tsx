import type { DataKey } from "@gonogo/core";
import {
  clearAugments,
  clearRegistry,
  MockDataSource,
  registerAugment,
  registerDataSource,
} from "@gonogo/core";
import { BufferedDataSource, MemoryStore } from "@gonogo/data";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThermalStatusComponent } from "./index";

const KEYS: DataKey[] = [
  { key: "v.name" },
  { key: "v.missionTime" },
  { key: "therm.hottestPartName" },
  { key: "therm.hottestPartTemp" },
  { key: "therm.hottestPartMaxTemp" },
  { key: "therm.hottestPartTempRatio" },
  { key: "therm.hottestEngineTemp" },
  { key: "therm.hottestEngineMaxTemp" },
  { key: "therm.hottestEngineTempRatio" },
  { key: "therm.anyEnginesOverheating" },
  { key: "therm.heatShieldTempCelsius" },
  { key: "therm.heatShieldFlux" },
];

function primeFlight(source: MockDataSource): void {
  source.emit("v.name", "Test Vessel");
  source.emit("v.missionTime", 0);
}

describe("ThermalStatusComponent", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;

  beforeEach(async () => {
    clearRegistry();
    source = new MockDataSource({ keys: KEYS });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
  });

  afterEach(() => {
    cleanup();
    buffered.disconnect();
    clearAugments();
  });

  it("shows the no-data placeholder until telemetry arrives", () => {
    render(<ThermalStatusComponent config={{}} id="therm" />);
    expect(screen.getByText("No thermal data")).toBeInTheDocument();
  });

  it("renders hottest-part + hottest-engine readouts when telemetry arrives", () => {
    render(<ThermalStatusComponent config={{}} id="therm" />);
    act(() => {
      primeFlight(source);
      source.emit("therm.hottestPartName", "LV-T30 'Reliant'");
      source.emit("therm.hottestPartTemp", 640); // °C
      source.emit("therm.hottestPartMaxTemp", 2273); // K (≈2000°C)
      source.emit("therm.hottestPartTempRatio", 0.33);
      source.emit("therm.hottestEngineTemp", 913); // K (≈640°C)
      source.emit("therm.hottestEngineMaxTemp", 2273);
      source.emit("therm.hottestEngineTempRatio", 0.4);
      source.emit("therm.anyEnginesOverheating", false);
    });

    expect(screen.getByText("LV-T30 'Reliant'")).toBeInTheDocument();
    expect(screen.getByText("Hottest part")).toBeInTheDocument();
    expect(screen.getByText("Hottest engine")).toBeInTheDocument();
    // Nominal bands at 33% / 40% — no role=alert banner.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("raises a role=alert banner when any engine is flagged overheating", () => {
    render(<ThermalStatusComponent config={{}} id="therm" />);
    act(() => {
      primeFlight(source);
      source.emit("therm.hottestEngineTemp", 2150);
      source.emit("therm.hottestEngineMaxTemp", 2273);
      source.emit("therm.hottestEngineTempRatio", 0.945);
      source.emit("therm.anyEnginesOverheating", true);
    });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/engine overheating/i);
  });

  it("raises a role=alert banner when the hottest part ratio is critical", () => {
    render(<ThermalStatusComponent config={{}} id="therm" />);
    act(() => {
      primeFlight(source);
      source.emit("therm.hottestPartName", "Heat Shield (2.5m)");
      source.emit("therm.hottestPartTemp", 2150);
      source.emit("therm.hottestPartMaxTemp", 2500);
      source.emit("therm.hottestPartTempRatio", 0.99);
      source.emit("therm.anyEnginesOverheating", false);
    });

    const alert = screen.getByRole("alert");
    // Critical band (>= 97% ratio) reads "Part at max temperature";
    // hot band (90-97%) reads "Part approaching max temperature".
    expect(alert.textContent).toMatch(/at max temperature/i);
  });

  it("treats absolute-zero readings as missing data (no thermometer fitted)", () => {
    render(<ThermalStatusComponent config={{}} id="therm" />);
    act(() => {
      primeFlight(source);
      // Telemachus emits ~2K for both temp and max when no thermometer
      // is fitted (e.g. early-career rocket). These should NOT light up
      // the widget as CRITICAL — they should be treated as no data.
      source.emit("therm.hottestPartName", "");
      source.emit("therm.hottestPartTemp", 2.05); // °C — close to 275 K, but…
      source.emit("therm.hottestPartMaxTemp", 2.05); // K — sentinel: max ≈ 0 K
      source.emit("therm.hottestPartTempRatio", 1.0); // bogus ratio
      source.emit("therm.hottestEngineTemp", 2.05); // K — sentinel
      source.emit("therm.hottestEngineMaxTemp", 2.05); // K — sentinel
      source.emit("therm.hottestEngineTempRatio", 1.0);
      source.emit("therm.anyEnginesOverheating", false);
    });

    // No CRITICAL pill, no alert role, no part/engine rows rendered.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/critical/i)).toBeNull();
    // Should fall through to the no-data placeholder when every group
    // is sentinel.
    expect(screen.getByText("No thermal data")).toBeInTheDocument();
  });

  it("hides the heat-shield row when its temp is at the sentinel", () => {
    render(<ThermalStatusComponent config={{}} id="therm" h={9} />);
    act(() => {
      primeFlight(source);
      // Real engine telemetry — engine row should still render.
      source.emit("therm.hottestEngineTemp", 913);
      source.emit("therm.hottestEngineMaxTemp", 2273);
      source.emit("therm.hottestEngineTempRatio", 0.4);
      source.emit("therm.anyEnginesOverheating", false);
      // Sentinel shield reading.
      source.emit("therm.heatShieldTempCelsius", -271.1);
      source.emit("therm.heatShieldFlux", 0);
    });

    expect(screen.getByText("Hottest engine")).toBeInTheDocument();
    expect(screen.queryByText("Heat shield")).toBeNull();
  });

  describe("thermal-status.badges augment slot", () => {
    it("renders with the slot empty when no augment is registered", () => {
      render(<ThermalStatusComponent config={{}} id="therm" />);
      act(() => {
        primeFlight(source);
        source.emit("therm.hottestPartName", "LV-T30 'Reliant'");
        source.emit("therm.hottestPartTemp", 640);
        source.emit("therm.hottestPartMaxTemp", 2273);
        source.emit("therm.hottestPartTempRatio", 0.33);
      });

      // Header renders; no augment badge present.
      expect(screen.getByText("THERMAL")).toBeInTheDocument();
      expect(screen.queryByTestId("reliability-badge")).toBeNull();
    });

    it("renders an augment registered into thermal-status.badges", () => {
      registerAugment({
        id: "test-reliability-badge",
        augments: "thermal-status.badges",
        component: () => <span data-testid="reliability-badge">3 at risk</span>,
      });

      render(<ThermalStatusComponent config={{}} id="therm" />);
      act(() => {
        primeFlight(source);
        source.emit("therm.hottestPartName", "LV-T30 'Reliant'");
        source.emit("therm.hottestPartTemp", 640);
        source.emit("therm.hottestPartMaxTemp", 2273);
        source.emit("therm.hottestPartTempRatio", 0.33);
      });

      expect(screen.getByTestId("reliability-badge")).toHaveTextContent(
        "3 at risk",
      );
    });
  });
});
