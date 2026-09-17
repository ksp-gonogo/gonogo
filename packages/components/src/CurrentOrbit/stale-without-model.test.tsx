import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CurrentOrbitComponent } from "./index";

/**
 * A stale orbit with NO model draws nothing, which is the widget's stated rule
 * and the case that regressed while `vessel.orbit` was being given a conic.
 *
 * The rule is in this widget's own header: it DRAWS the orbit and the craft's
 * place on it, so what it shows is a positive claim about where the craft is
 * NOW. An element that merely stopped arriving does not support that claim, and
 * the operator settled the same question for comms on 2026-09-17: "it would make
 * no sense to reckon a dead link, nor really to share old values. It doesn't
 * really say anything."
 *
 * Giving the topic a model briefly broke this. Taking the observation on
 * `observed` OR `stale` and then overlaying the model is right when a model is
 * on offer, and leaves a bare stale reading drawn as current when one is not.
 * Nothing caught it, because every test here fed a live stream.
 *
 * The sibling case, a stale reading WITH a model, is deliberately not this
 * test's subject and is legitimate: `sma`, `ecc` and `inc` are constants of the
 * orbit rather than figures that go out of date, so a conic that moves the
 * phase assembles a current answer rather than holding an old one.
 */
describe("CurrentOrbit: a stale orbit with no model", () => {
  it("draws nothing rather than holding the last elements", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.orbit", "vessel.state"],
      pinnedUt: 10,
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "orbit-stale" }}>
          <CurrentOrbitComponent id="orbit-stale" w={9} h={18} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    /*
     * What "nothing to draw" looks like in THIS fixture, measured rather than
     * guessed. A hard-coded count is a number that depends on how many channels
     * the fixture carries, and asserting one told me 4 was not 6 while the
     * behaviour under test was already correct.
     */
    const placeholdersWhenEmpty = screen.getAllByText(NULL_DISPLAY).length;

    act(() => {
      fixture.emit("vessel.orbit", {
        sma: 682500,
        ecc: 0.00367,
        inc: 0.3,
        argPe: 12.5,
        mu: 3.5316e12,
        horizon: ANALYTIC_UNBOUNDED_HORIZON,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
      });
    });

    // It really did arrive and really was drawn, so the disappearance below is
    // a change rather than a field that was never there.
    await waitFor(() => expect(visibleText()).toContain("0.3°"));

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    const reading = () => fixture.store.sampleReading("vessel.orbit");

    // Both halves of the premise, asserted rather than assumed. Without the
    // first this passes on a stream that never stopped; without the second it
    // would pass for the wrong reason the day the reckoner starts answering
    // here, which is exactly the case this test is NOT about.
    await waitFor(() => expect(reading().state).toBe("stale"));
    expect(reading().reckoning.status).not.toBe("available");

    /*
     * The ELEMENTS, which are what this widget takes from `vessel.orbit` and so
     * what the rule above governs. Named individually rather than counted: a
     * count over the whole widget conflates them with the rows fed from
     * `vessel.state`, and those come through `useStream`, which carries no
     * currency at all and is a separate hole (see below).
     */
    expect(visibleText()).not.toContain("0.3°"); // inclination
    expect(visibleText()).not.toContain("0.00367"); // eccentricity
    for (const row of ["Ap", "Pe", "Inc", "Ecc"]) {
      expect(visibleText(), `${row} row`).toContain(`${row}${NULL_DISPLAY}`);
    }

    /*
     * The SECOND path, which this assertion used to record as open and now
     * pins as closed.
     *
     * `t-Ap`, `t-Pe` and `T` are derived on `vessel.state`, which has no
     * `Reading`, so they went on showing figures after the orbit stopped
     * arriving: the same falsehood by a different route, in the same column.
     * The comment here used to say "no change to the reading path can fix it",
     * and that was right — the fix was not in the reading path. `vessel.state`
     * computes its own currency through `deriveStatus` on its channel
     * definition, and nothing read it (ticket 346); `useOrbitElements` now
     * reports it and `CurrentOrbit` nulls these rows on it.
     *
     * So the whole grid nulls together and the count is EQUAL to the
     * never-arrived baseline rather than short of it. Asserting equality is
     * what stops the hole reopening: a row that goes back to drawing from the
     * derived channel drops the count and fails here.
     */
    expect(screen.getAllByText(NULL_DISPLAY).length).toBe(
      placeholdersWhenEmpty,
    );
  });
});
