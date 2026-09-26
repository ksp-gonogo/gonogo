import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { MapViewComponent } from "./index";

/**
 * The stream test-adapter proof for MapView:
 * genuinely running off the real `TelemetryProvider`/`TelemetryClient`/
 * `TimelineStore` pipeline via `StubTransport`; no legacy `DataSource` is
 * registered anywhere in this file.
 *
 * MapView's reads: `v.lat`/`v.long` -> `vessel.flight.latitude`/`.longitude`,
 * `v.altitude` -> `vessel.flight.altitudeAsl`, the other kinematics ->
 * `vessel.flight.*` fields, and the patch chain -> `vessel.orbit.patches`.
 * This file exercises only the lat/lon/altitude readout below.
 *
 * Uses the compact (`!showMap`) mode, a narrow/short widget renders a
 * plain Lat/Lon/Alt text readout instead of the canvas map, so the mapped
 * values are directly DOM-visible without needing a white-box `store.
 * sample()` proof.
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

    // Nothing arrived yet: the compact readout shows the em-dash placeholder.
    expect(visibleText(container)).toContain("Lat");
    expect(visibleText(container)).toContain(NULL_DISPLAY);
    expect(container.textContent).not.toContain("°");

    // A real subscription must have happened for this to deliver at all,
    // StubTransport.emit is subscription-gated (see its own doc comment).
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
      // The launchpad sits at 80 m. The inline formatter this replaced
      // divided by 1000 unconditionally, with no metre rung, so it rendered
      // that as "0.1 km"; the shared ladder picks the rung.
      expect(visibleText(container)).toContain("80.0 m");
    });

    // v.body stays gapped/undefined (no legacy source here), the mapped
    // position/altitude landing doesn't fabricate a body label.
    expect(container.textContent).not.toContain("Kerbin");
  });
});
