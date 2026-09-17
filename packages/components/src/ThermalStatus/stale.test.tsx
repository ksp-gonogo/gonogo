import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ThermalStatusComponent } from "./index";

/**
 * What ThermalStatus does when `vessel.thermal` stops arriving.
 *
 * It used to replace the whole panel with "Thermal readings no longer current",
 * throwing away every figure it was still holding. The comment that justified
 * that said a held reading "leaves nothing to hide behind a notice", which was
 * not true of this payload: the record carries the heat-shield temperature and
 * flux, the hottest part's name and its skin figures, and those are
 * MEASUREMENTS rather than judgements.
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

    act(() => {
      fixture.store.setTransportConnected(false);
    });

    await waitFor(() =>
      expect(visibleText(container)).toContain("no longer current"),
    );

    /* The figures survive. This is the whole point: the part that is hottest
       and how hot it was are exactly what the operator wants after the link
       goes, and the old collapse deleted both. */
    expect(visibleText(container)).toContain("Heat Shield (2.5m)");
    expect(visibleText(container)).toContain("1177 °C");

    // And the caption says which half is dated, so a populated panel does not
    // read as a dead one.
    expect(visibleText(container)).toContain("the temperatures are the last");
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
      expect(visibleText(container)).toContain("no longer current"),
    );
    expect(visibleText(container).toLowerCase()).not.toContain("nominal");
  });
});
