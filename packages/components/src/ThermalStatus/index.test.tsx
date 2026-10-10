import { clearAugments, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { ThermalStatusComponent } from "./index";

/**
 * ThermalStatus off a real stream pipeline. `clearAugments()` runs in `beforeEach`, before anything mounts, so the reset never fires against a live component.
 */

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
      pinnedUt: 10,
      suspendFrames: true,
    });
    renderThermal(fixture);
    expect(screen.getByText("No thermal data")).toBeInTheDocument();
  });

  it("renders hottest-part + hottest-engine readouts when telemetry arrives", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    renderThermal(fixture);
    act(() => {
      fixture.emit("vessel.thermal", {
        hottestPart: {
          name: "LV-T30 'Reliant'",
          skinTemp: 640, // K
          skinMaxTemp: 2273, // K (≈2000°C)
        },
        maxInternalTempRatio: 0.33,
        hottestEngineTemp: 913, // K (≈640°C)
        hottestEngineMaxTemp: 2273,
        hottestEngineTempRatio: 0.4,
        anyEnginesOverheating: false,
      });
    });

    await waitFor(() => expect(visibleText()).toContain("LV-T30 'Reliant'"));
    expect(screen.getByText("Hottest part")).toBeInTheDocument();
    expect(screen.getByText("Hottest engine")).toBeInTheDocument();
    // Nominal bands at 33% / 40%: no role=alert banner.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("raises a role=alert banner when any engine is flagged overheating", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
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
    expect(visibleText(alert)).toMatch(/engine overheating/i);
  });

  it("raises a role=alert banner when the hottest part ratio is critical", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
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
    // Critical band (>= 97% ratio) reads "Part at max temperature"; hot band (90-97%) reads "Part approaching max temperature".
    expect(visibleText(alert)).toMatch(/at max temperature/i);
  });

  it("treats absolute-zero readings as missing data (no thermometer fitted)", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    renderThermal(fixture);
    act(() => {
      // The mod emits ~2 K for temp and max when no thermometer is fitted; that must read as no data, not CRITICAL.
      fixture.emit("vessel.thermal", {
        hottestPart: {
          name: "",
          skinTemp: 2.05, // K: sentinel
          skinMaxTemp: 2.05, // K: sentinel: max ≈ 0 K
        },
        maxInternalTempRatio: 1.0, // bogus ratio
        hottestEngineTemp: 2.05, // K: sentinel
        hottestEngineMaxTemp: 2.05, // K: sentinel
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
      pinnedUt: 10,
      suspendFrames: true,
    });
    renderThermal(fixture, 9);
    act(() => {
      fixture.emit("vessel.thermal", {
        // Real engine telemetry: engine row should still render.
        hottestEngineTemp: 913,
        hottestEngineMaxTemp: 2273,
        hottestEngineTempRatio: 0.4,
        anyEnginesOverheating: false,
        // ~2 K is the stand-in for "no heat shield fitted".
        heatShieldTemp: 2.05,
        heatShieldFlux: 0,
      });
    });

    await waitFor(() =>
      expect(screen.getByText("Hottest engine")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Heat shield")).toBeNull();
  });
});
