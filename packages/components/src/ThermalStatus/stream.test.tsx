import { DashboardItemContext } from "@ksp-gonogo/core";
import {
  act,
  render,
  screen,
  visibleText,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ThermalStatusComponent } from "./index";

/**
 * The stream test-adapter proof for ThermalStatus (mirrors
 * `WarpControl/stream.test.tsx`, the pilot): genuinely running off the real
 * `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport`: no legacy `DataSource` is registered anywhere in this
 * file.
 *
 * Every `therm.*` key this widget reads is mapped onto `vessel.thermal` now
 * (headline ratios, heat shield, `hottestPartName`, and the engine quartet,
 * `map-topic.ts`'s thermal-detail batch). This test covers the two ends of
 * that set: the hottest-part headline ratio (present from the earlier
 * heat-shield batch) and `hottestPartName` (this batch's un-gap) both stream
 * from the SAME `vessel.thermal` emission.
 */
describe("ThermalStatus: genuinely runs off the stream (M3 batch 1)", () => {
  it("reads the hottest-part headline ratio and name off the real stream pipeline, not legacy", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.thermal"],
      pinnedUt: 10,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "therm-stream" }}>
          <ThermalStatusComponent id="therm-stream" w={8} h={7} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Nothing arrived yet: noData is true (every mapped key is
    // still undefined), so the empty state renders.
    expect(screen.getByText("No thermal data")).toBeTruthy();

    // A real subscription must have happened for this to deliver at all,
    // StubTransport.emit is subscription-gated (see its own doc comment).
    expect(fixture.transport.isSubscribed("vessel.thermal")).toBe(true);

    act(() => {
      // Both Kelvin, as `ThermalHottestPart` declares. This used to assert
      // "287.5°C" because the widget read skinTemp as Celsius: the mapping to
      // `vessel.thermal.hottestPart.skinTemp` had changed the unit underneath
      // it and the assertion was updated to match the output rather than the
      // physics. 287.5 K is 14.4 °C, which is what an unheated solar panel
      // actually reads.
      fixture.emit("vessel.thermal", {
        hottestPart: {
          skinTemp: 287.5,
          skinMaxTemp: 2273.15,
          name: "OX-STAT Photovoltaic Panels",
        },
        maxInternalTempRatio: 0.22,
      });
    });

    // A temperature is a <Quantity>, so the number and symbol are separate
    // elements; getByText sees only an element's direct text nodes.
    await waitFor(() => expect(visibleText(container)).toContain("14.4 °C"));
    // Zero decimals once |value| >= 1000, which the widget still chooses.
    expect(visibleText(container)).toContain("2000 °C");
    expect(screen.getByText("OX-STAT Photovoltaic Panels")).toBeTruthy();
    // No engine data was emitted this tick, the engine row still shows its
    // "no data" placeholder rather than a fabricated value.
    expect(screen.getAllByText(NULL_DISPLAY).length).toBeGreaterThanOrEqual(1);
  });
});
