import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { MapViewComponent } from "./index";

/**
 * MapView running off the real stream pipeline via `StubTransport`, with no
 * legacy `DataSource` registered. The compact mode renders a plain
 * Lat/Lon/Alt readout, so the mapped values are DOM-visible.
 */
describe("MapView: genuinely runs off the stream (M3 mechanical-tail batch)", () => {
  it("reads lat/long/altitude off the real stream pipeline, not legacy", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [
        "vessel.flight",
        "vessel.orbit",
        "vessel.identity",
        "system.bodies",
      ],
      pinnedUt: 10,
      suspendFrames: true,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "mapview-stream" }}>
          <MapViewComponent id="mapview-stream" w={4} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Nothing arrived yet: the compact readout shows placeholders.
    expect(visibleText(container)).toContain("Lat");
    expect(visibleText(container)).toContain(NULL_DISPLAY);
    expect(container.textContent).not.toContain("°");

    // StubTransport.emit is subscription-gated, so a real subscription must exist.
    expect(fixture.transport.isSubscribed("vessel.flight")).toBe(true);
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(true);

    act(() => {
      fixture.emit("vessel.flight", {
        latitude: -0.0972,
        longitude: -74.5577,
        altitudeAsl: 80,
        dynamicPressureKPa: 0,
        mach: 0,
        surfaceSpeed: 0,
        verticalSpeed: 0,
      });
    });

    await waitFor(() => {
      expect(visibleText(container)).toContain("-0.10°");
      expect(visibleText(container)).toContain("-74.56°");
      // The launchpad sits at 80 m, which the shared ladder renders on the metre rung.
      expect(visibleText(container)).toContain("80.0 m");
    });

    // No body source, so no fabricated body label.
    expect(container.textContent).not.toContain("Kerbin");
  });
});
