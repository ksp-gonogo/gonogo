import { DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { MapViewComponent } from "./index";

/**
 * What MapView does when its position is no longer current. A dot on a map is
 * a claim about where the craft is now, so the marker is withheld, and the
 * overlay says why, so a withheld marker is distinguishable from a broken
 * widget. The HUD readouts are the contrast case: a dated number keeps the
 * last observed value.
 */

const CARRIED = [
  "vessel.flight",
  "vessel.orbit",
  "vessel.identity",
  "system.bodies",
];

function mount() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
    suspendFrames: true,
  });
  const rendered = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "mapview-stale" }}>
        <MapViewComponent id="mapview-stale" w={4} h={5} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, ...rendered };
}

/** A position arriving on the wire, at the launchpad. */
function emitPosition(fixture: ReturnType<typeof mount>["fixture"]) {
  act(() => {
    fixture.emit("vessel.orbit", {}, { quality: Quality.Loaded });
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
}

describe("MapView when the position is not current", () => {
  it("draws the position while it is current", async () => {
    // The control: without it every assertion below would pass on a widget that never renders a position.
    const { fixture, container } = mount();
    emitPosition(fixture);
    await waitFor(() => {
      expect(visibleText(container)).toContain("-0.10°");
    });
    expect(visibleText(container)).not.toContain("marker withheld");
  });

  // The altitude nulls on its own field's currency: the marker's caption cannot speak for it, and a confident figure would sit beside a withheld marker.
  it("nulls the altitude too, not just the position it has a caption for", async () => {
    const { fixture, container } = mount();
    /* `Unit` separates figure and unit with a thin space, so whitespace is normalised. */
    const shown = () => visibleText(container).replace(/\s+/g, " ");
    emitPosition(fixture);
    await waitFor(() => expect(shown()).toContain("80.0 m"));

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    // The absence of the figure, not a null-token count, which cannot say which row stopped claiming.
    await waitFor(() => expect(shown()).not.toContain("80.0 m"));
    // The marker's own statement is still made.
    expect(visibleText(container)).toContain("marker withheld");
  });

  it("withholds the marker once the position stops arriving, and SAYS SO", async () => {
    const { fixture, container } = mount();
    emitPosition(fixture);
    await waitFor(() => expect(visibleText(container)).toContain("-0.10°"));

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    await waitFor(() => {
      // Legible from outside: an empty map would satisfy "no marker" while looking broken.
      expect(visibleText(container)).toContain("Position not current");
      expect(visibleText(container)).toContain("marker withheld");
    });
  });

  it("stops rendering the coordinates it can no longer vouch for", async () => {
    // The lat/lon readout is the same position, so it goes with the marker.
    const { fixture, container } = mount();
    emitPosition(fixture);
    await waitFor(() => expect(visibleText(container)).toContain("-0.10°"));

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    await waitFor(() => {
      expect(visibleText(container)).not.toContain("-0.10°");
    });
  });

  it("says nothing about a withheld marker before anything has ever arrived", async () => {
    // A cold start is not a stale position, and must not accuse the link on first paint.
    const { container } = mount();
    await waitFor(() => {
      expect(visibleText(container)).not.toContain("marker withheld");
    });
  });
});
