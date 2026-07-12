import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import reentryWarning from "./__fixtures__/reentry-warning.json";
import { ThermalStatusComponent } from "./index";

/**
 * ThermalStatus's behavior-preservation golden dual-run (mirrors
 * `WarpControl/dual-run.test.tsx`, the pilot): the SAME thermal state,
 * rendered once off the legacy `DataSource` and once off the stream, must
 * produce byte-identical DOM at `delay=0`.
 *
 * `reentry-warning` exercises the "warm" band (0.81 ratio — yellow tone,
 * distinct from "nominal") on the hottest-part row. Every `therm.*` key this
 * widget reads is now MAPPED (`map-topic.ts`'s thermal-detail batch un-gapped
 * `hottestPartName` + the engine quartet on top of the headline-ratio/
 * heat-shield keys already mapped) — no legacy AUX source is needed
 * alongside the `TelemetryProvider` any more.
 */
afterEach(() => {
  cleanup();
});

describe("ThermalStatus — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same thermal state", async () => {
    const mode = { name: "default-8x7", w: 8, h: 7 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: ThermalStatusComponent,
      fixture: reentryWarning,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["vessel.thermal"],
      pinnedUt: 10,
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
        heatShieldTempCelsius: reentryWarning["therm.heatShieldTempCelsius"],
        heatShieldFlux: reentryWarning["therm.heatShieldFlux"],
        hottestEngineTemp: reentryWarning["therm.hottestEngineTemp"],
        hottestEngineMaxTemp: reentryWarning["therm.hottestEngineMaxTemp"],
        hottestEngineTempRatio: reentryWarning["therm.hottestEngineTempRatio"],
        anyEnginesOverheating: reentryWarning["therm.anyEnginesOverheating"],
      });
    });

    await waitFor(() => {
      if (!container.textContent?.includes("1671°C")) {
        throw new Error("stream leg has not rendered the thermal state yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);

    expect(streamHtml).toBe(legacyHtml);
  });
});
