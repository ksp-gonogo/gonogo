import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ThermalStatusComponent } from "./index";

/**
 * When `vessel.thermal` stops arriving, ThermalStatus holds every temperature, dated, and withdraws only the bands, which are verdicts about now. No caption repeats what each figure's staleness mark already says.
 */

const RE_ENTRY = {
  hottestPart: {
    skinTemp: 1450,
    skinMaxTemp: 2273.15,
    name: "Heat Shield (2.5m)",
  },
  maxInternalTempRatio: 0.64,
  heatShieldTemp: 1450,
  heatShieldFlux: 812,
};

function mount(instanceId: string) {
  const fixture = setupStreamFixture({
    pinnedUt: 10,
  });
  const rendered = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <ThermalStatusComponent id={instanceId} w={8} h={7} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.thermal", RE_ENTRY);
  });
  return { fixture, container: rendered.container };
}

describe("ThermalStatus: a thermal record that has stopped arriving", () => {
  it("draws the board while the readings are current", async () => {
    // The control: without it every assertion below would pass on a widget that never drew a temperature.
    const { container } = mount("therm-stale-control");

    await waitFor(() =>
      expect(visibleText(container)).toContain("Heat Shield"),
    );
  });

  it("holds every temperature and withholds only the judgement", async () => {
    const { fixture, container } = mount("therm-stale-held");
    await waitFor(() =>
      expect(visibleText(container)).toContain("Heat Shield"),
    );

    // The control for the wait below: a band must be showing before the link drops.
    expect(visibleText(container).toLowerCase()).toContain("nominal");

    act(() => {
      fixture.store.setTransportConnected(false);
    });

    // Wait on the band ceasing to be nominal, not on "unknown", which can already show while the link is up.
    await waitFor(() =>
      expect(visibleText(container).toLowerCase()).not.toContain("nominal"),
    );

    expect(visibleText(container)).toContain("Heat Shield (2.5m)");
    expect(visibleText(container)).toContain("1177 °C");
  });

  it("does not keep claiming a band a stale ratio cannot support", async () => {
    const { fixture, container } = mount("therm-stale-band");
    await waitFor(() =>
      expect(visibleText(container)).toContain("Heat Shield"),
    );
    expect(visibleText(container).toLowerCase()).toContain("nominal");

    act(() => {
      fixture.store.setTransportConnected(false);
    });

    await waitFor(() =>
      expect(visibleText(container).toLowerCase()).not.toContain("nominal"),
    );
  });

  it("keeps the hottest part's meter, its fill dimmed and its temperature marked", async () => {
    const { fixture } = mount("therm-stale-meter");
    const meter = await screen.findByRole("meter", {
      name: "Heat Shield (2.5m)",
    });
    const root = () => meter.parentElement?.parentElement;
    // The control: while current, nothing on the meter is marked
    expect(root()?.querySelector("[data-fill-held]")).toBeNull();
    expect(root()?.querySelector("[data-held-mark]")).toBeNull();

    act(() => {
      fixture.store.setTransportConnected(false);
    });

    await waitFor(() =>
      expect(root()?.querySelector("[data-fill-held]")).not.toBeNull(),
    );
    expect(meter).toHaveAttribute("aria-valuenow", "64");
    // One mark, on the temperature: the rated maximum is not marked a second time
    expect(root()?.querySelectorAll("[data-held-mark]")).toHaveLength(1);
  });
});
