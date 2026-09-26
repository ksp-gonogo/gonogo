import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TwrComponent } from "./index";

/**
 * What the dial does once its telemetry stops arriving.
 *
 * Without the reading's currency the gauge would go on drawing a confident
 * TWR after telemetry stopped. The figure is HELD, and the gauge marks it,
 * rather than withheld: this widget's whole content is the one number, and its
 * empty state says there is no engine, so nulling a dated TWR would say something false
 * about the craft rather than about the link.
 */
const STANDARD_GRAVITY = 9.80665;

const VESSEL_STATE_INPUTS = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.propulsion",
  "vessel.resources",
  "vessel.structure",
  "vessel.control",
  "vessel.identity",
  "vessel.crew",
];

const ORBIT = {
  apoapsisAltitude: 80_000,
  periapsisAltitude: 70_000,
  eccentricity: 0.01,
  inclination: 0,
  semiMajorAxis: 675_000,
  period: 1800,
  trueAnomaly: 0,
  referenceBodyName: "Kerbin",
};

function mount() {
  const fixture = setupStreamFixture({
    carriedChannels: VESSEL_STATE_INPUTS,
    pinnedUt: 10,
    suspendFrames: true,
  });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "twr-stale" }}>
        <TwrComponent config={{}} id="twr-stale" />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  const thrust = 1.8 * STANDARD_GRAVITY;
  act(() => {
    fixture.emit("vessel.orbit", ORBIT);
    fixture.emit("vessel.propulsion", {
      totalMass: 1,
      dryMass: 0,
      currentThrust: thrust,
      availableThrust: thrust,
    });
  });
  return fixture;
}

describe("Twr when vessel.propulsion is no longer current", () => {
  it("says nothing about currency while the channel is live", async () => {
    mount();
    const gauge = await screen.findByRole("img", { name: /^TWR \d/ });
    expect(gauge).toHaveAccessibleName(/^TWR [\d.]+$/);
    expect(gauge).not.toHaveAttribute("data-not-current");
    /*
     * The ResizeObserver that picks the variant settles after the body
     * returns, so holding the scope open across that microtask is what keeps
     * the update inside `act`.
     */
    await act(async () => {});
  });

  it("holds the dial and marks it, rather than blanking it", async () => {
    const fixture = mount();
    await screen.findByRole("img", { name: /^TWR \d/ });

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    // The figure survives: it is the last real one and still the best known.
    const gauge = screen.getByRole("img", { name: /^TWR \d/ });
    expect(gauge).toHaveAttribute("data-not-current");
    expect(gauge).toHaveAccessibleName(/^TWR [\d.]+, \S/);
    // And it must NOT claim the craft has no engine, which is what this
    // widget's empty state means.
    expect(screen.queryByText(/no engine data/i)).toBeNull();
    await act(async () => {});
  });
});
