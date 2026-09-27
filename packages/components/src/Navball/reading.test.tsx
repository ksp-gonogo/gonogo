import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

// A stale or absent attitude shown on the dial is a wrong input to a control decision.
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

function dial(): HTMLElement | null {
  return screen.queryByRole("img", { name: /attitude indicator/i });
}

function heldMarks(): NodeListOf<Element> {
  return document.querySelectorAll("[data-held-mark]");
}

describe("Navball never draws an attitude it does not have", () => {
  it("draws no dial at all before any attitude arrives", () => {
    mount("nb-pending");

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
    // Under light-time delay every value is old, so a live link carries no caveat.
    expect(visibleText()).not.toMatch(/last contact/i);
  });

  it("stops drawing the dial when the link drops, and marks the held angles", async () => {
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

    // A held dial is indistinguishable from a live one.
    await waitFor(() => expect(dial()).toBeNull());
    // Heading, pitch and roll each wear Unit's held mark and its spoken caption; the widget writes no time of its own.
    expect(heldMarks()).toHaveLength(3);
    expect(document.querySelectorAll("[data-unit-currency]")).toHaveLength(3);
    expect(visibleText()).not.toMatch(/last contact|ago/i);
  });

  it("still reports the last observed angles as numbers when the link drops", async () => {
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

    await waitFor(() => expect(heldMarks()).toHaveLength(3));
    expect(visibleText()).toContain("90");
    expect(visibleText()).toContain("45");
  });

  it("leaves the control surface exactly as it was when the attitude goes stale", async () => {
    /*
     * The operator may want to command SAS or cut throttle because contact
     * dropped. Compared against the pre-drop state, since some SAS controls are
     * disabled for their own reasons.
     */
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
    await waitFor(() => expect(heldMarks()).toHaveLength(3));

    const controlsAfter = screen
      .getAllByRole("button")
      .map((b) => `${b.textContent}:${b.hasAttribute("disabled")}`)
      .sort();
    expect(controlsAfter).toEqual(controlsBefore);
  });
});
