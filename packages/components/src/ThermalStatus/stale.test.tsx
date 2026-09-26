import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ThermalStatusComponent } from "./index";

/**
 * What ThermalStatus does when `vessel.thermal` stops arriving.
 *
 * It holds every figure it has and withdraws only the bands. The record carries
 * the heat-shield temperature and flux, the hottest part's name and its skin
 * figures, and those are MEASUREMENTS rather than judgements, so a dropped link
 * is no reason to delete them.
 *
 * Nothing says so in words. Each held figure carries its own staleness mark, and
 * a sentence repeating them is the same statement twice.
 *
 * The split now: the band tags and the summary pill go to `unknown`, because a
 * band is read as the situation NOW and a craft that has since flown deeper
 * into re-entry would keep showing "nominal" for as long as the link stayed
 * down. The temperatures stay, dated, because an operator who has just lost the
 * link during re-entry is better served by the last heat-shield reading than by
 * a panel that has discarded it.
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
    carriedChannels: ["vessel.thermal"],
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
    // The control. Without it every assertion below would also pass on a
    // widget that never drew a temperature at all.
    const { container } = mount("therm-stale-control");

    await waitFor(() =>
      expect(visibleText(container)).toContain("Heat Shield"),
    );
    expect(visibleText(container)).not.toContain("no longer current");
  });

  it("holds every temperature and withholds only the judgement", async () => {
    const { fixture, container } = mount("therm-stale-held");
    await waitFor(() =>
      expect(visibleText(container)).toContain("Heat Shield"),
    );

    /* The control for the wait below. Without it, a fixture that never showed a
       band would satisfy "no longer says nominal" before the link even drops,
       and the wait would assert nothing. */
    expect(visibleText(container).toLowerCase()).toContain("nominal");

    act(() => {
      fixture.store.setTransportConnected(false);
    });

    /* Waiting on the TRANSITION, not on a word. No sentence announces the drop
       any more, and "unknown" is not a signal because a band can already be
       unknown while the link is up: waiting on it returns at once and asserts
       against the state before the drop. A band that WAS a verdict ceasing to
       be one only happens after it lands. */
    await waitFor(() =>
      expect(visibleText(container).toLowerCase()).not.toContain("nominal"),
    );

    /* The figures survive. This is the whole point: the part that is hottest
       and how hot it was are exactly what the operator wants after the link
       goes, and the old collapse deleted both. */
    expect(visibleText(container)).toContain("Heat Shield (2.5m)");
    expect(visibleText(container)).toContain("1177 °C");

    /* And no sentence says any of it. Each held figure carries its own staleness
       mark, so a caption repeating them is the same statement twice, in the
       space the readings need. */
    expect(visibleText(container)).not.toContain("no longer current");
  });

  it("does not keep claiming a band a stale ratio cannot support", async () => {
    /* The half that MUST still be withheld. A band is a verdict about now, so
       holding "nominal" across a dropped link would tell an operator the craft
       is fine while it flies deeper into re-entry. */
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
    expect(visibleText(container)).not.toContain("no longer current");
  });

  it("keeps the hottest part's meter, its fill dimmed and its temperature marked", async () => {
    const { fixture } = mount("therm-stale-meter");
    const meter = await screen.findByRole("meter", {
      name: "Heat Shield (2.5m)",
    });
    const root = () => meter.parentElement?.parentElement;
    // The control: while current, nothing on the meter is marked
    expect(root()?.querySelector("[data-fill-not-current]")).toBeNull();
    expect(root()?.querySelector("[data-not-current-mark]")).toBeNull();

    act(() => {
      fixture.store.setTransportConnected(false);
    });

    await waitFor(() =>
      expect(root()?.querySelector("[data-fill-not-current]")).not.toBeNull(),
    );
    expect(meter).toHaveAttribute("aria-valuenow", "64");
    // One mark, on the temperature: the rated maximum is not marked a second time
    expect(root()?.querySelectorAll("[data-not-current-mark]")).toHaveLength(1);
  });
});
