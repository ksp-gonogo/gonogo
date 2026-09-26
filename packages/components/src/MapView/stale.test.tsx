import { DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { MapViewComponent } from "./index";

/**
 * What MapView does when its position is no longer current.
 *
 * This is the decision, not a description of the migration: a dot on a map is a
 * positive claim about where the craft is NOW, and `reading.ts` names a marker
 * placed from a last-known value as the sharpest form of the failure the type
 * exists to prevent. So the marker is WITHHELD.
 *
 * The second assertion is the one that matters more, and it is the reason this
 * file exists rather than a comment: a widget that renders nothing passes almost
 * every test ever written about it. Withholding the marker has to be
 * DELIBERATE and visible, so the overlay has to say why, and "the marker is
 * gone" and "the widget is broken" have to be distinguishable from the outside.
 *
 * The HUD readouts are the contrast case: a number beside a label can be dated
 * honestly, so those keep the last observed values.
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
    // The control: without this, every assertion below would also pass on a
    // widget that never renders a position at all.
    const { fixture, container } = mount();
    emitPosition(fixture);
    await waitFor(() => {
      expect(visibleText(container)).toContain("-0.10°");
    });
    expect(visibleText(container)).not.toContain("marker withheld");
  });

  /**
   * The ALTITUDE, which the marker's caption cannot speak for.
   *
   * `positionStale` is a statement about the marker, and the caption beside it
   * speaks for the marker alone. Without its own currency the altitude would
   * draw a confident figure beside a withheld marker and beside the caption
   * explaining the withholding: three answers in one readout.
   *
   * It nulls on its own field reading's currency.
   */
  it("nulls the altitude too, not just the position it has a caption for", async () => {
    const { fixture, container } = mount();
    /* Whitespace normalised: `Unit` sets a figure from its unit with a thin
       space, so a plain-space needle never matches the DOM's own text. */
    const shown = () => visibleText(container).replace(/\s+/g, " ");
    emitPosition(fixture);
    await waitFor(() => expect(shown()).toContain("80.0 m"));

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    /*
     * Asserted as the absence of the FIGURE rather than as a null-token count:
     * the readout has several rows and a count cannot say which one stopped
     * claiming. The altitude is the only thing on this widget that draws it.
     */
    await waitFor(() => expect(shown()).not.toContain("80.0 m"));
    // And the marker's own statement is still made: this did not silence it.
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
      // Deliberate, and legible from outside the component. An empty map would
      // satisfy "no marker" while being indistinguishable from broken.
      expect(visibleText(container)).toContain("Position not current");
      expect(visibleText(container)).toContain("marker withheld");
    });
  });

  it("stops rendering the coordinates it can no longer vouch for", async () => {
    // The latitude/longitude readout is fed from the same position as the
    // marker, so it goes with it: a bare "-0.10°" with no marker would be the
    // same false claim in text.
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
    // A cold start is not a stale position. "Waiting for telemetry" and
    // "withheld because it went stale" are different statements and a widget
    // that conflated them would accuse the link of dropping on first paint.
    const { container } = mount();
    await waitFor(() => {
      expect(visibleText(container)).not.toContain("marker withheld");
    });
  });
});
