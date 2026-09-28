import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";

/**
 * When `vessel.orbit` stops being current the picture is kept, and only the craft's place in it and the countdowns off its elements are marked: catalogue figures do not decay because a craft went quiet.
 */

const KERBOL_MU = 1.1723328e18;
const KERBIN_MU = 3.5316e12;

function kerbolSystem() {
  return {
    bodies: [
      {
        index: 0,
        name: "Kerbol",
        parentIndex: null,
        radius: 261_600_000,
        gravParameter: KERBOL_MU,
        orbit: null,
      },
      {
        index: 1,
        name: "Kerbin",
        parentIndex: 0,
        radius: 600_000,
        gravParameter: KERBIN_MU,
        sphereOfInfluence: 84_159_286,
        isHome: true,
        rotationPeriod: 21_549,
        orbit: {
          sma: 13_599_840_256,
          ecc: 0,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 3.14,
          epoch: 0,
        },
      },
      // A child of the frame body, without which the diagram draws its empty hint and no vessel marker.
      {
        index: 2,
        name: "Mun",
        parentIndex: 1,
        radius: 200_000,
        gravParameter: 6.5138398e10,
        sphereOfInfluence: 2_429_559,
        orbit: {
          sma: 12_000_000,
          ecc: 0,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 1.7,
          epoch: 0,
        },
      },
    ],
  };
}

function mount() {
  const fixture: StreamFixture = setupStreamFixture({
    pinnedUt: 0,
    suspendFrames: true,
  });
  const view = render(
    <fixture.Provider>
      <SystemViewComponent
        config={{ frame: "Kerbin" } as never}
        id="sv-stale"
        w={10}
        h={12}
      />
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("system.bodies", kerbolSystem());
    fixture.emit("vessel.identity", {
      vesselId: "v-active",
      name: "Active Craft",
      vesselType: 0,
      situation: 3,
      parentBodyIndex: 1,
    });
    fixture.emit("vessel.orbit", {
      referenceBodyIndex: 1,
      sma: 3_000_000,
      ecc: 0.1,
      inc: 40,
      lan: 0,
      argPe: 90,
      meanAnomalyAtEpoch: 0,
      epoch: 0,
      mu: KERBIN_MU,
      horizon: { kind: 1, trajectoryKind: 1 },
    });
  });
  return { fixture, view };
}

/** Drop the link, then run a frame: nothing else re-derives the readings. */
function goStale(fixture: StreamFixture): void {
  act(() => {
    fixture.store.setTransportConnected(false);
    fixture.store.beginFrame();
  });
}

describe("SystemView when vessel.orbit is no longer current", () => {
  it("marks the almanac figures taken off the craft's own orbit", async () => {
    const { fixture, view } = mount();
    await waitFor(() => {
      expect(view.container.querySelector("svg")).not.toBeNull();
    });
    // The control: a widget that marked unconditionally would pass the assertion below.
    expect(view.container.querySelectorAll("[data-held]")).toHaveLength(0);

    goStale(fixture);

    const marks = view.container.querySelectorAll("[data-held]");
    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) {
      // A mark with no caption looks marked and says nothing.
      expect(mark.querySelector("[data-unit-currency]")).not.toBeNull();
    }
    await act(async () => {});
  });

  it("draws the vessel marker hollow rather than dimmed, and names it as held", async () => {
    const { fixture, view } = mount();
    const marker = await waitFor(() => {
      const found = view.container.querySelector("[data-vessel-position]");
      if (found === null) throw new Error("no vessel marker drawn yet");
      return found;
    });
    expect(marker.getAttribute("data-vessel-position")).toBe("current");
    expect(marker.querySelector("title")?.textContent).toBe("Vessel position");

    goStale(fixture);

    const held = view.container.querySelector("[data-vessel-position]");
    expect(held?.getAttribute("data-vessel-position")).toBe("held");
    expect(held?.querySelector("title")?.textContent).toBe(
      "Vessel position, no longer current",
    );
    // Shape, not shade: the marker has no text to fall back on (WCAG 1.4.1), so held draws the hollow dashed ring of a computed position.
    const ring = held?.querySelector("[data-vessel-marker]");
    expect(ring?.getAttribute("fill")).toBe("none");
    expect(ring?.getAttribute("stroke-dasharray")).not.toBeNull();
    await act(async () => {});
  });
});
