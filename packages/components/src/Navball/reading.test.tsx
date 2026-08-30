import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

/**
 * Navball is the sharpest case in the absence-gate audit, on operational rather
 * than architectural grounds: it draws vessel ORIENTATION, and attitude is the
 * reading an operator acts on most directly and fastest. A stale attitude shown
 * as current is not a display bug, it is a wrong input to a control decision.
 *
 * It was worse than stale. `AttitudeIndicator` drew `pitch ?? 0`, `roll ?? 0`,
 * `heading ?? 0` regardless of whether anything had arrived, so with NO data the
 * dial painted a specific, plausible, wrong attitude: level, facing north. Its
 * `ready` flag gated only the numeric captions and `aria-hidden`, never the
 * drawing.
 *
 * `Targeting` answered the same question for its docking reticle by
 * refusing to draw it off a non-observed reading, and the ball is the same kind
 * of object, only more so: the reticle at least drew from real data that had
 * gone old, while the dial fabricated an attitude from nothing at all.
 */
afterEach(() => {
  clearActionHandlers();
});

const CARRIED = ["vessel.attitude", "vessel.control", "vessel.identity"];

function mount(
  instanceId: string,
  { w = 10, h = 12, controlMode = false } = {},
) {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
    suspendFrames: true,
  });
  const rendered = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <NavballComponent
          config={{ controlMode }}
          id={instanceId}
          w={w}
          h={h}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, rendered };
}

/**
 * The dial itself. Queried by its role and accessible name rather than a test
 * attribute, so the assertion is about what a user (or a screen reader) can
 * find: the instrument that means "this is where the craft is pointing".
 */
function dial(): HTMLElement | null {
  return screen.queryByRole("img", { name: /attitude indicator/i });
}

describe("Navball never draws an attitude it does not have", () => {
  it("draws no dial at all before any attitude arrives", () => {
    mount("nb-pending");

    // The defect: this used to paint a level, north-facing horizon, which is a
    // positive claim about the craft's orientation made from nothing.
    expect(dial()).toBeNull();
    expect(visibleText()).toMatch(/waiting for attitude/i);
  });

  it("draws the dial once an attitude is observed", async () => {
    const { fixture } = mount("nb-observed");

    act(() => {
      fixture.emit("vessel.attitude", {
        heading: 90,
        pitch: 45,
        roll: 0,
        headingRootFrame: 90,
        pitchRootFrame: 45,
        rollRootFrame: 0,
      });
    });

    await waitFor(() => expect(dial()).not.toBeNull());
    // And no caveat while we are hearing from the craft: under a light-time
    // delay every value is old, so a caveat on all of them would say nothing.
    expect(visibleText()).not.toMatch(/last contact/i);
  });

  it("stops drawing the dial when the link drops, and says why", async () => {
    const { fixture } = mount("nb-stale");

    act(() => {
      fixture.emit("vessel.attitude", {
        heading: 90,
        pitch: 45,
        roll: 0,
        headingRootFrame: 90,
        pitchRootFrame: 45,
        rollRootFrame: 0,
      });
    });
    await waitFor(() => expect(dial()).not.toBeNull());

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    // An attitude we know we have missed updates on cannot be drawn as an
    // orientation: a dial asserts "this is where the craft is pointing NOW",
    // and holding the last one there is indistinguishable from a live reading.
    await waitFor(() => expect(dial()).toBeNull());
    expect(visibleText()).toMatch(/last contact/i);
  });

  it("still reports the last observed angles as numbers when the link drops", async () => {
    // Refusing to DRAW is not refusing to tell. The last real attitude stays
    // legible as a dated readout, which is what an operator needs to reason
    // about what the craft was doing when contact was lost; what it must not do
    // is occupy the instrument that means "now".
    const { fixture } = mount("nb-stale-numbers");

    act(() => {
      fixture.emit("vessel.attitude", {
        heading: 90,
        pitch: 45,
        roll: 0,
        headingRootFrame: 90,
        pitchRootFrame: 45,
        rollRootFrame: 0,
      });
    });
    await waitFor(() => expect(visibleText()).toContain("90"));

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    await waitFor(() => expect(visibleText()).toMatch(/last contact/i));
    expect(visibleText()).toContain("90");
    expect(visibleText()).toContain("45");
  });

  it("leaves the control surface exactly as it was when the attitude goes stale", async () => {
    // Deliberate: the operator may well want to command SAS or cut the throttle
    // BECAUSE contact dropped. Withholding the controls alongside the dial would
    // make a bad situation unactionable, and a command's own delay is already
    // surfaced by the control-stream spine rather than by this widget.
    //
    // Asserted as an equality against the pre-drop state rather than as a list of
    // enabled buttons: several SAS mode controls are disabled for their own
    // reasons, and the claim here is only that STALENESS changed none of it.
    const { fixture } = mount("nb-stale-controls", {
      w: 10,
      h: 20,
      controlMode: true,
    });

    act(() => {
      fixture.emit("vessel.attitude", {
        heading: 90,
        pitch: 45,
        roll: 0,
        headingRootFrame: 90,
        pitchRootFrame: 45,
        rollRootFrame: 0,
      });
      fixture.emit("vessel.control", { sas: true, rcs: false, throttle: 0.5 });
    });
    await waitFor(() => expect(visibleText()).toContain("90"));

    const controlsBefore = screen
      .getAllByRole("button")
      .map((b) => `${b.textContent}:${b.hasAttribute("disabled")}`)
      .sort();
    expect(controlsBefore.length).toBeGreaterThan(0);

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });
    await waitFor(() => expect(visibleText()).toMatch(/last contact/i));

    const controlsAfter = screen
      .getAllByRole("button")
      .map((b) => `${b.textContent}:${b.hasAttribute("disabled")}`)
      .sort();
    expect(controlsAfter).toEqual(controlsBefore);
  });
});
