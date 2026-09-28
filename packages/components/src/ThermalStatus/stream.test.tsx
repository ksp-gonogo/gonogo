import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ThermalStatusComponent } from "./index";

/** ThermalStatus off the real stream pipeline, with no legacy `DataSource` registered: the headline ratio and the hottest part's name stream from one `vessel.thermal` emission. */
describe("ThermalStatus: genuinely runs off the stream (M3 batch 1)", () => {
  it("reads the hottest-part headline ratio and name off the real stream pipeline, not legacy", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "therm-stream" }}>
          <ThermalStatusComponent id="therm-stream" w={8} h={7} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(screen.getByText("No thermal data")).toBeTruthy();

    // StubTransport.emit is subscription-gated, so a real subscription must exist.
    expect(fixture.transport.isSubscribed("vessel.thermal")).toBe(true);

    act(() => {
      // Both Kelvin: 287.5 K is 14.4 °C.
      fixture.emit("vessel.thermal", {
        hottestPart: {
          skinTemp: 287.5,
          skinMaxTemp: 2273.15,
          name: "OX-STAT Photovoltaic Panels",
        },
        maxInternalTempRatio: 0.22,
      });
    });

    // A temperature is a <Quantity>, so the number and symbol are separate elements; getByText sees only an element's direct text nodes.
    await waitFor(() => expect(visibleText(container)).toContain("14.4 °C"));
    // Zero decimals once |value| >= 1000, which the widget still chooses.
    expect(visibleText(container)).toContain("2000 °C");
    expect(screen.getByText("OX-STAT Photovoltaic Panels")).toBeTruthy();
    // No engine data was emitted, so the engine row shows its placeholder.
    expect(screen.getAllByText(NULL_DISPLAY).length).toBeGreaterThanOrEqual(1);
  });
});
