import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";

/**
 * The read frame, driven from the widget's own config through to the drawn
 * path, with nothing stubbed between them.
 *
 * <b>This is the check that would have caught the last slice shipping dead.</b>
 * The frame arithmetic has its own tests and the propagation seam has its own
 * tests, and a feature can pass both while nothing in the app can reach it.
 * So the assertions here start at a saved config value and end at the DOM: no
 * flag is set by hand, no hook is mocked open, and if the config option stopped
 * reaching `useOrbitTrajectory` these would fail while every unit test stayed
 * green.
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

function mount(config: { frame: string; readFrame?: string }) {
  const fixture: StreamFixture = setupStreamFixture({
    carriedChannels: [
      "vessel.orbit",
      "vessel.identity",
      "system.bodies",
      "system.vessels",
    ],
    pinnedUt: 0,
  });

  const view = render(
    <fixture.Provider>
      <SystemViewComponent config={config as never} id="sv" />
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
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 0,
      mu: KERBIN_MU,
      // An integrating provider's shape answer, so the seam produces a sampled
      // path rather than the instruction to draw an ellipse: an arc is the
      // thing a frame can move.
      horizon: { kind: 1, trajectoryKind: 2 },
    });
  });

  return { fixture, view };
}

describe("SystemView read frame", () => {
  it("draws in the orbit's own plane, and says so, when nothing else was chosen", async () => {
    const { view } = mount({ frame: "Kerbin" });
    await waitFor(() => {
      expect(view.container.querySelector("svg")).not.toBeNull();
    });
    expect(view.container.textContent).toContain(
      "Drawn in the orbit's own plane",
    );
    await act(async () => {});
  });

  it("carries a saved rotating frame all the way from the config to the drawn path", async () => {
    const { view } = mount({ frame: "Kerbin", readFrame: "parent-direction" });
    const path = await waitFor(() => {
      const found = view.container.querySelector(
        '[data-vessel-trajectory="arc"]',
      );
      if (found === null) throw new Error("no arc drawn yet");
      return found;
    });
    // 4 is `BodyCentredParentDirection`. The path itself carries which frame
    // it was computed in, so the assertion is against the drawing rather than
    // against any intermediate value a test could have set.
    expect(path.getAttribute("data-trajectory-frame")).toBe("4");
    expect(view.container.textContent).toContain(
      "Drawn in Kerbin-centred, Kerbol held still",
    );
    await act(async () => {});
  });

  it("drops the orbit-plane rotation once the points are in another frame", async () => {
    const inPlane = mount({ frame: "Kerbin" });
    const rotating = mount({
      frame: "Kerbin",
      readFrame: "parent-direction",
    });
    const groupOf = async (view: { container: HTMLElement }) =>
      await waitFor(() => {
        const found = view.container.querySelector(
          '[data-vessel-trajectory="arc"]',
        )?.parentElement;
        if (!found) throw new Error("no arc drawn yet");
        return found;
      });
    // The orbit-plane path is turned into the diagram's plane by a rotation
    // built from the elements. Points that arrived in a rotating frame have
    // been through their own transform, so applying that rotation as well
    // would turn the curve by an angle that means nothing.
    expect((await groupOf(inPlane.view)).getAttribute("transform")).toMatch(
      /^rotate\(/,
    );
    expect((await groupOf(rotating.view)).getAttribute("transform")).toBeNull();
    await act(async () => {});
  });

  it("is operable and announced with the frame caption on screen", async () => {
    const { view } = mount({ frame: "Kerbin", readFrame: "parent-direction" });
    await waitFor(() => {
      expect(view.container.querySelector("svg")).not.toBeNull();
    });
    await expectNoA11yViolations(view.container);
  });
});
