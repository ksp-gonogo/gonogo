import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ThermalStatusComponent } from "./index";

/**
 * The stream test-adapter proof for ThermalStatus (mirrors
 * `WarpControl/stream.test.tsx`, the pilot): genuinely running off the real
 * `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport` — no legacy `DataSource` is registered anywhere in this
 * file.
 *
 * Every `therm.*` key this widget reads is mapped onto `vessel.thermal` now
 * (headline ratios, heat shield, `hottestPartName`, and the engine quartet —
 * `map-topic.ts`'s thermal-detail batch). This test covers the two ends of
 * that set: the hottest-part headline ratio (present from the earlier
 * heat-shield batch) and `hottestPartName` (this batch's un-gap) both stream
 * from the SAME `vessel.thermal` emission.
 */
afterEach(() => {
  cleanup();
});

describe("ThermalStatus — genuinely runs off the stream (M3 batch 1)", () => {
  it("reads the hottest-part headline ratio and name off the real stream pipeline, not legacy", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.thermal"],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "therm-stream" }}>
          <ThermalStatusComponent id="therm-stream" w={8} h={7} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Nothing arrived yet — noData is true (every mapped key is
    // still undefined), so the empty state renders.
    expect(screen.getByText("No thermal data")).toBeTruthy();

    // A real subscription must have happened for this to deliver at all —
    // StubTransport.emit is subscription-gated (see its own doc comment).
    expect(fixture.transport.isSubscribed("vessel.thermal")).toBe(true);

    act(() => {
      // therm.hottestPartTemp is already Celsius (rendered as-is);
      // therm.hottestPartMaxTemp is Kelvin (kelvinToCelsius'd before
      // render) — matching the legacy Telemachus fork's own inconsistent
      // units, which this widget's sentinel guards (isSentinelK vs
      // isSentinelC) and variable naming (`rawHottestMaxK`) already encode.
      fixture.emit("vessel.thermal", {
        hottestPart: {
          skinTemp: 287.5,
          skinMaxTemp: 2273.15,
          name: "OX-STAT Photovoltaic Panels",
        },
        maxInternalTempRatio: 0.22,
      });
    });

    await waitFor(() => expect(screen.getByText("287.5°C")).toBeTruthy());
    // formatTempC drops to zero decimals once |value| >= 1000.
    expect(screen.getByText("/ 2000°C max")).toBeTruthy();
    expect(screen.getByText("OX-STAT Photovoltaic Panels")).toBeTruthy();
    // No engine data was emitted this tick — the engine row still shows its
    // "no data" placeholder rather than a fabricated value.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });
});
