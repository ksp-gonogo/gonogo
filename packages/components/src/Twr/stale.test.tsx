import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TwrComponent } from "./index";

const STANDARD_GRAVITY = 9.80665;

const TWR_CHANNELS = ["vessel.propulsion"];

function mount() {
  const fixture = setupStreamFixture({
    carriedChannels: TWR_CHANNELS,
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
    const gauge = await screen.findByRole("meter", { name: /^TWR \d/ });
    expect(gauge).toHaveAccessibleName(/^TWR [\d.]+$/);
    expect(gauge).not.toHaveAttribute("data-not-current");
    // useElementSize picks up the gauge slot in an effect that settles after the body returns.
    await act(async () => {});
  });

  it("holds the dial and marks it, rather than blanking it", async () => {
    const fixture = mount();
    await screen.findByRole("meter", { name: /^TWR \d/ });

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    const gauge = screen.getByRole("meter", { name: /^TWR \d/ });
    expect(gauge).toHaveAttribute("data-not-current");
    expect(gauge).toHaveAccessibleName(/^TWR [\d.]+, \S/);
    // The empty state would claim the craft has no engine.
    expect(screen.queryByText(/no engine data/i)).toBeNull();
    await act(async () => {});
  });
});
