import { DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import kerbinLaunchpad from "./__fixtures__/kerbin-launchpad.json";
import { MapViewComponent } from "./index";

/**
 * MapView's stream render golden. This began life as a legacy-`DataSource` ↔
 * stream byte-identical dual-run; the kinematics now read off `vessel.flight.*`
 * and the derived `vessel.state` channel (altitude/body/orbit-patches/
 * encounter/impact) with no legacy fallback, so the legacy leg is gone. What
 * remains proves the compact (`!showMap`) Lat/Lon/Alt readout renders the same
 * pre-launch state off the real stream pipeline.
 *
 * Mode `4x5` selects the compact branch — the one MapView render path whose
 * Lat/Lon/Alt readout is plain DOM text rather than canvas drawing.
 */
describe("MapView — stream render golden (delay=0)", () => {
  it("renders the compact Lat/Lon/Alt readout off the stream for the launchpad state", async () => {
    const streamFixture = setupStreamFixture({
      carriedChannels: [
        "vessel.orbit",
        "vessel.flight",
        "vessel.identity",
        "system.bodies",
        "vessel.control",
        "vessel.target",
        "vessel.comms",
        "vessel.propulsion",
      ],
      pinnedUt: 10,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "mapview-dual" }}>
          <MapViewComponent id="mapview-dual" w={4} h={5} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      streamFixture.emit("vessel.orbit", {}, { quality: Quality.Loaded });
      streamFixture.emit("vessel.flight", {
        latitude: kerbinLaunchpad["v.lat"],
        longitude: kerbinLaunchpad["v.long"],
        altitudeAsl: kerbinLaunchpad["v.altitude"],
        dynamicPressureKPa: kerbinLaunchpad["v.dynamicPressure"],
        mach: kerbinLaunchpad["v.mach"],
        surfaceSpeed: kerbinLaunchpad["v.surfaceSpeed"],
        verticalSpeed: kerbinLaunchpad["v.verticalSpeed"],
      });
    });

    // altSea lands off the derived vessel.state channel (measured basis) —
    // waiting on the mapped altitude readout proves the stream leg rendered.
    await waitFor(() => {
      if (!container.textContent?.includes("0.1 km")) {
        throw new Error("stream leg has not rendered altitude yet");
      }
    });
    expect(container.textContent).toContain("-0.10°");
    expect(container.textContent).toContain("-74.56°");
  });
});
