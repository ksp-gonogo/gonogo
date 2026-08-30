import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import reentryWarning from "./__fixtures__/reentry-warning.json";
import { ThermalStatusComponent } from "./index";

/**
 * ThermalStatus's reads (`index.tsx`: `useTelemetry("vessel.thermal")?.<field>`)
 * are ALL ONE-ARG canonical reads now, none of them has a legacy fallback at
 * all. The original version of this test rendered the SAME reentry-warning
 * state once off a legacy `DataSource` (`snapshotWidgetMode`, which mounts no
 * `TelemetryProvider`) and once off the stream, asserting byte-identical DOM;
 * that comparison is no longer possible, the legacy leg now renders nothing
 * but "No thermal data", since every one of its reads is stream-only. Same
 * underlying cause (full canonical migration, not a test bug) as every other
 * widget's own `dual-run.test.tsx` dropping its now-impossible legacy leg.
 *
 * What remains, and is still worth its own file: the real recorded
 * `reentry-warning` fixture: hottest part in the "warm" band (81% ratio,
 * distinct yellow tone from "nominal"), hot heat shield under flux, cool
 * throttled-off engine: run genuinely through the stream pipeline.
 */
describe("ThermalStatus: real reentry-warning fixture render off the stream (delay=0)", () => {
  it("renders the hottest-part warm band, heat shield flux, and cool engine off the stream, no legacy leg", async () => {
    const mode = { name: "default-8x7", w: 8, h: 7 };

    const streamFixture = setupStreamFixture({
      carriedChannels: ["vessel.thermal"],
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
      // 1670.9 K is 1398 °C. This asserted "1671°C" while skinTemp was being
      // read as Celsius.
      if (!visibleText().includes("1398 °C")) {
        throw new Error("stream leg has not rendered the thermal state yet");
      }
    });

    expect(visibleText()).toContain("Heat Shield (2.5m)");
    // "warm" appears twice: the compact pill and the hottest-part row's tag.
    expect(screen.getAllByText("warm").length).toBe(2);
    // Asserted on the container rather than with getByText: a temperature is
    // a <Quantity> now, so the number and its symbol are separate elements and
    // getByText, which concatenates only an element's DIRECT text nodes, sees
    // one or the other but never the pair.
    // skinMaxTemp (2400 K) -> 2127°C.
    expect(visibleText()).toContain("2127 °C");
    expect(visibleText()).toContain("1280 °C");
    // One decimal, not two: the shared `energyRate` ladder sets precision
    // per kind rather than per rung, matching every other ladder. The rung
    // itself is what matters here, and it is still MW.
    expect(visibleText()).toContain("3.3 MW");
    expect(visibleText()).toContain("76.9 °C");
    // The unit is announced as a word, not as letters, which is what routing
    // through the unit layer bought.
    // `textContent`, not `visibleText`: this is the one assertion here about
    // what a screen reader HEARS, and `visibleText` exists to strip exactly
    // that.
    expect(container.textContent).toContain("degrees celsius");
    expect(container.textContent).toContain("megawatts");
    // Cool engine, no alert banner.
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
