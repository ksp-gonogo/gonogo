import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import reentryWarning from "./__fixtures__/reentry-warning.json";
import { ThermalStatusComponent } from "./index";

/**
 * ThermalStatus's reads (`index.tsx`: `useTelemetry("vessel.thermal")?.<field>`)
 * are ALL ONE-ARG canonical reads now — none of them has a legacy fallback at
 * all. The original version of this test rendered the SAME reentry-warning
 * state once off a legacy `DataSource` (`snapshotWidgetMode`, which mounts no
 * `TelemetryProvider`) and once off the stream, asserting byte-identical DOM;
 * that comparison is no longer possible — the legacy leg now renders nothing
 * but "No thermal data", since every one of its reads is stream-only. Same
 * underlying cause (full canonical migration, not a test bug) as every other
 * widget's own `dual-run.test.tsx` dropping its now-impossible legacy leg.
 *
 * What remains, and is still worth its own file: the real recorded
 * `reentry-warning` fixture — hottest part in the "warm" band (81% ratio,
 * distinct yellow tone from "nominal"), hot heat shield under flux, cool
 * throttled-off engine — run genuinely through the stream pipeline.
 */
describe("ThermalStatus — real reentry-warning fixture render off the stream (delay=0)", () => {
  it("renders the hottest-part warm band, heat shield flux, and cool engine off the stream, no legacy leg", async () => {
    const mode = { name: "default-8x7", w: 8, h: 7 };

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

    expect(screen.getByText("Heat Shield (2.5m)")).toBeInTheDocument();
    // "warm" appears twice — the compact pill and the hottest-part row's tag.
    expect(screen.getAllByText("warm").length).toBe(2);
    // skinMaxTemp (2400 K) -> kelvinToCelsius -> 2127°C.
    expect(screen.getByText("/ 2127°C max")).toBeInTheDocument();
    expect(screen.getByText("1280°C")).toBeInTheDocument();
    expect(screen.getByText("· flux 3.25 MW")).toBeInTheDocument();
    expect(screen.getByText("76.9°C")).toBeInTheDocument();
    // Cool engine, no alert banner.
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
