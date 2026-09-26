import { DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import kerbinLaunchpad from "./__fixtures__/kerbin-launchpad.json";
import { MapViewComponent } from "./index";

/**
 * MapView's stream render golden. The kinematics read off `vessel.flight`,
 * the body off `vessel.identity` and `system.bodies`, and the patch chain,
 * encounter and impact off `vessel.orbit`, with no legacy fallback. This
 * proves the compact (`!showMap`) Lat/Lon/Alt readout renders the pre-launch
 * state off the real stream pipeline.
 *
 * Mode `4x5` selects the compact branch: the one MapView render path whose
 * Lat/Lon/Alt readout is plain DOM text rather than canvas drawing.
 */
describe("MapView: stream render golden (delay=0)", () => {
  it("renders the compact Lat/Lon/Alt readout off the stream for the launchpad state", async () => {
    const streamFixture = setupStreamFixture({
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

    // altSea lands off vessel.flight.altitudeAsl: waiting on the altitude
    // readout proves the stream leg rendered.
    await waitFor(() => {
      // 80 m at the pad: see the note in stream.test.tsx on the rung.
      if (!visibleText(container).includes("80.0 m")) {
        throw new Error("stream leg has not rendered altitude yet");
      }
    });
    expect(visibleText(container)).toContain("-0.10°");
    expect(visibleText(container)).toContain("-74.56°");
  });
});
