import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import reentryWarning from "./__fixtures__/reentry-warning.json";
import { ThermalStatusComponent } from "./index";

/**
 * Renders the recorded reentry-warning fixture through the stream pipeline: hottest part in the warm band, hot heat shield under flux, cool engine.
 */
describe("ThermalStatus: real reentry-warning fixture render off the stream (delay=0)", () => {
  it("renders the hottest-part warm band, heat shield flux, and cool engine off the stream, no legacy leg", async () => {
    const mode = { name: "default-8x7", w: 8, h: 7 };

    const streamFixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "therm-dual" }}>
          <ThermalStatusComponent id="therm-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      streamFixture.emit("vessel.thermal", {
        hottestPart: {
          skinTemp: reentryWarning["therm.hottestPartTemp"],
          skinMaxTemp: reentryWarning["therm.hottestPartMaxTemp"],
          name: reentryWarning["therm.hottestPartName"],
        },
        maxInternalTempRatio: reentryWarning["therm.hottestPartTempRatio"],
        heatShieldTemp: reentryWarning["therm.heatShieldTemp"],
        heatShieldFlux: reentryWarning["therm.heatShieldFlux"],
        hottestEngineTemp: reentryWarning["therm.hottestEngineTemp"],
        hottestEngineMaxTemp: reentryWarning["therm.hottestEngineMaxTemp"],
        hottestEngineTempRatio: reentryWarning["therm.hottestEngineTempRatio"],
        anyEnginesOverheating: reentryWarning["therm.anyEnginesOverheating"],
      });
    });

    await waitFor(() => {
      // 1670.9 K is 1398 °C.
      if (!visibleText().includes("1398 °C")) {
        throw new Error("stream leg has not rendered the thermal state yet");
      }
    });

    expect(visibleText()).toContain("Heat Shield (2.5m)");
    // "warm" appears twice: the compact pill and the hottest-part row's tag.
    expect(screen.getAllByText("warm").length).toBe(2);
    // A temperature is a Quantity with separate number and symbol elements, so assert on the container text; skinMaxTemp 2400 K is 2127 °C.
    expect(visibleText()).toContain("2127 °C");
    expect(visibleText()).toContain("1280 °C");
    // The shared `energyRate` ladder sets one decimal per kind; the rung is MW.
    expect(visibleText()).toContain("3.3 MW");
    expect(visibleText()).toContain("76.9 °C");
    // `textContent`, not `visibleText`: this asserts what a screen reader hears.
    expect(container.textContent).toContain("degrees celsius");
    expect(container.textContent).toContain("megawatts");
    // Cool engine, no alert banner.
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
