import {
  clearAugments,
  DashboardItemContext,
  registerAugment,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { ThermalStatusComponent } from "./index";

/**
 * Stream-migrated widget test (mirrors `stream.test.tsx`/`dual-run.test.tsx`
 * in this directory) — every `therm.*` key `index.tsx` reads is a ONE-ARG
 * canonical `useTelemetry("vessel.thermal")` read with no legacy fallback at
 * all, so every render here runs off a real `TelemetryProvider`/
 * `TelemetryClient`/`TimelineStore` pipeline via `StubTransport` instead of the
 * legacy `MockDataSource` registry.
 *
 * `clearAugments()` runs in `beforeEach` (nothing mounted yet — the prior
 * test's tree was already torn down by RTL auto-cleanup) so the augment
 * registry is reset without a state mutation firing against a live component.
 */
const CARRIED_CHANNELS = ["vessel.thermal"];

function renderThermal(fixture: StreamFixture, h?: number) {
  return render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "therm" }}>
        <ThermalStatusComponent config={{}} id="therm" h={h} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
}

describe("ThermalStatusComponent", () => {
  beforeEach(() => {
    clearAugments();
  });

  it("shows the no-data placeholder until telemetry arrives", () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED_CHANNELS,
      pinnedUt: 10,
    });
    renderThermal(fixture);
    expect(screen.getByText("No thermal data")).toBeInTheDocument();
  });

  it("renders hottest-part + hottest-engine readouts when telemetry arrives", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED_CHANNELS,
      pinnedUt: 10,
    });
    renderThermal(fixture);
    act(() => {
      fixture.emit("vessel.thermal", {
        hottestPart: {
          name: "LV-T30 'Reliant'",
          skinTemp: 640, // °C
          skinMaxTemp: 2273, // K (≈2000°C)
        },
        maxInternalTempRatio: 0.33,
        hottestEngineTemp: 913, // K (≈640°C)
        hottestEngineMaxTemp: 2273,
        hottestEngineTempRatio: 0.4,
        anyEnginesOverheating: false,
      });
    });

    await waitFor(() =>
      expect(screen.getByText("LV-T30 'Reliant'")).toBeInTheDocument(),
    );
    expect(screen.getByText("Hottest part")).toBeInTheDocument();
    expect(screen.getByText("Hottest engine")).toBeInTheDocument();
    // Nominal bands at 33% / 40% — no role=alert banner.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("raises a role=alert banner when any engine is flagged overheating", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED_CHANNELS,
      pinnedUt: 10,
    });
    renderThermal(fixture);
    act(() => {
      fixture.emit("vessel.thermal", {
        hottestEngineTemp: 2150,
        hottestEngineMaxTemp: 2273,
        hottestEngineTempRatio: 0.945,
        anyEnginesOverheating: true,
      });
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/engine overheating/i);
  });

  it("raises a role=alert banner when the hottest part ratio is critical", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED_CHANNELS,
      pinnedUt: 10,
    });
    renderThermal(fixture);
    act(() => {
      fixture.emit("vessel.thermal", {
        hottestPart: {
          name: "Heat Shield (2.5m)",
          skinTemp: 2150,
          skinMaxTemp: 2500,
        },
        maxInternalTempRatio: 0.99,
        anyEnginesOverheating: false,
      });
    });

    const alert = await screen.findByRole("alert");
    // Critical band (>= 97% ratio) reads "Part at max temperature";
    // hot band (90-97%) reads "Part approaching max temperature".
    expect(alert.textContent).toMatch(/at max temperature/i);
  });

  it("treats absolute-zero readings as missing data (no thermometer fitted)", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED_CHANNELS,
      pinnedUt: 10,
    });
    renderThermal(fixture);
    act(() => {
      // The mod emits ~2K for both temp and max when no thermometer is
      // fitted (e.g. early-career rocket). These should NOT light up the
      // widget as CRITICAL — they should be treated as no data.
      fixture.emit("vessel.thermal", {
        hottestPart: {
          name: "",
          skinTemp: 2.05, // °C — close to 275 K, but...
          skinMaxTemp: 2.05, // K — sentinel: max ≈ 0 K
        },
        maxInternalTempRatio: 1.0, // bogus ratio
        hottestEngineTemp: 2.05, // K — sentinel
        hottestEngineMaxTemp: 2.05, // K — sentinel
        hottestEngineTempRatio: 1.0,
        anyEnginesOverheating: false,
      });
    });

    // No CRITICAL pill, no alert role, no part/engine rows rendered.
    await waitFor(() =>
      expect(screen.getByText("No thermal data")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/critical/i)).toBeNull();
  });

  it("hides the heat-shield row when its temp is at the sentinel", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED_CHANNELS,
      pinnedUt: 10,
    });
    renderThermal(fixture, 9);
    act(() => {
      fixture.emit("vessel.thermal", {
        // Real engine telemetry — engine row should still render.
        hottestEngineTemp: 913,
        hottestEngineMaxTemp: 2273,
        hottestEngineTempRatio: 0.4,
        anyEnginesOverheating: false,
        // Sentinel shield reading.
        heatShieldTempCelsius: -271.1,
        heatShieldFlux: 0,
      });
    });

    await waitFor(() =>
      expect(screen.getByText("Hottest engine")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Heat shield")).toBeNull();
  });

  describe("thermal-status.badges augment slot", () => {
    it("renders with the slot empty when no augment is registered", () => {
      const fixture = setupStreamFixture({
        carriedChannels: CARRIED_CHANNELS,
        pinnedUt: 10,
      });
      renderThermal(fixture);
      act(() => {
        fixture.emit("vessel.thermal", {
          hottestPart: {
            name: "LV-T30 'Reliant'",
            skinTemp: 640,
            skinMaxTemp: 2273,
          },
          maxInternalTempRatio: 0.33,
        });
      });

      // Header renders; no augment badge present.
      expect(screen.getByText("THERMAL")).toBeInTheDocument();
      expect(screen.queryByTestId("reliability-badge")).toBeNull();
    });

    it("renders an augment registered into thermal-status.badges", async () => {
      registerAugment({
        id: "test-reliability-badge",
        augments: "thermal-status.badges",
        component: () => <span data-testid="reliability-badge">3 at risk</span>,
      });

      const fixture = setupStreamFixture({
        carriedChannels: CARRIED_CHANNELS,
        pinnedUt: 10,
      });
      renderThermal(fixture);
      act(() => {
        fixture.emit("vessel.thermal", {
          hottestPart: {
            name: "LV-T30 'Reliant'",
            skinTemp: 640,
            skinMaxTemp: 2273,
          },
          maxInternalTempRatio: 0.33,
        });
      });

      await waitFor(() =>
        expect(screen.getByTestId("reliability-badge")).toHaveTextContent(
          "3 at risk",
        ),
      );
    });
  });
});
