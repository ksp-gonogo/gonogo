import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ThermalStatusComponent } from "./index";

/**
 * The M3 batch-1 stream test-adapter proof for ThermalStatus (mirrors
 * `WarpControl/stream.test.tsx`, the pilot): genuinely running off the real
 * `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport` — no legacy `DataSource` is registered anywhere in this
 * file.
 *
 * ThermalStatus is the most GAP-heavy of the batch-1 three (plan §G3
 * "thermal-status — degraded, headline ratios"): only the "hottest part"
 * row's 3 keys are MAPPED (`therm.hottestPartTemp` ->
 * `vessel.thermal.hottestPart.skinTemp`, `therm.hottestPartMaxTemp` ->
 * `vessel.thermal.hottestPart.skinMaxTemp`, `therm.hottestPartTempRatio` ->
 * `vessel.thermal.maxInternalTempRatio`). Every engine/heat-shield key
 * (`therm.hottestEngine*`, `therm.anyEnginesOverheating`,
 * `therm.heatShield*`) and `therm.hottestPartName` are declared GAPS
 * (`map-topic.ts`'s "thermal detail beyond headline ratios" / no individual
 * home) and stay legacy — with no legacy source registered here, they
 * render their normal "no data" fallback ("—" part name, empty engine/
 * shield rows), which is itself the assertion that a partially-mapped
 * widget degrades gracefully rather than blanking entirely.
 */
afterEach(() => {
  cleanup();
});

describe("ThermalStatus — genuinely runs off the stream (M3 batch 1)", () => {
  it("reads the hottest-part headline ratio off the real stream pipeline, not legacy", async () => {
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

    // Nothing arrived yet — noData is true (every mapped/gapped key is
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
        hottestPart: { skinTemp: 287.5, skinMaxTemp: 2273.15 },
        maxInternalTempRatio: 0.22,
      });
    });

    await waitFor(() => expect(screen.getByText("287.5°C")).toBeTruthy());
    // formatTempC drops to zero decimals once |value| >= 1000.
    expect(screen.getByText("/ 2000°C max")).toBeTruthy();
    // therm.hottestPartName / every engine key are declared gaps — no
    // legacy source here, so they stay the "—" placeholder (part name, and
    // the engine row's temp readout) rather than a fabricated value.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });
});
