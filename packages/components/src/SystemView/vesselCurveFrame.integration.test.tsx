import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";

/** The craft's own curve is lifted into the same frame as the bodies, whatever shape the propagation seam authorises, rather than turned by a rotation built from the elements. */

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

function mount(options: {
  config: { frame: string };
  /** `2` is an integrating provider sending a sampled arc; `1` is analytic, where the elements are the curve. */
  trajectoryKind: number;
}) {
  const fixture: StreamFixture = setupStreamFixture({
    pinnedUt: 0,
    suspendFrames: true,
  });

  const view = render(
    <fixture.Provider>
      <SystemViewComponent config={options.config as never} id="sv" />
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
      horizon: { kind: 1, trajectoryKind: options.trajectoryKind },
    });
  });

  return { fixture, view };
}

/** The points of an `Mx,y Lx,y ...` path, closed or open. */
function pathPoints(d: string): { x: number; y: number }[] {
  return d
    .replace(/[MLZ]/g, " ")
    .trim()
    .split(/\s+/)
    .filter((piece) => piece.length > 0)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x, y };
    });
}

describe("SystemView vessel curve", () => {
  it("names the frame the whole picture is drawn in", async () => {
    const { view } = mount({ config: { frame: "Kerbin" }, trajectoryKind: 1 });
    await waitFor(() => {
      expect(view.container.querySelector("svg")).not.toBeNull();
    });
    // The frame the diagram is in, not the frame the seam happened to compute in.
    expect(view.container.textContent).toContain("Kerbin-Centred Inertial");
    await act(async () => {});
  });

  it("draws an analytic answer as a placed ring, never an SVG ellipse", async () => {
    const { view } = mount({ config: { frame: "Kerbin" }, trajectoryKind: 1 });
    const path = await waitFor(() => {
      const found = view.container.querySelector(
        'path[data-vessel-trajectory="conic"]',
      );
      if (found === null) throw new Error("no conic drawn yet");
      return found;
    });
    // The ring is sampled and placed rather than an ellipse in a rotate() group: inclined 40 degrees, its projected centre is not one cx/cy can express.
    expect(
      view.container.querySelector('ellipse[data-vessel-trajectory="conic"]'),
    ).toBeNull();
    expect(path.getAttribute("transform")).toBeNull();
    // Periapsis a quarter turn from the node puts the apsis line on the foreshortened axis, so the ring is narrower across it than a flat projection.
    const points = pathPoints(path.getAttribute("d") ?? "");
    expect(points.length).toBeGreaterThan(50);
    const spanY =
      Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y));
    const spanX =
      Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
    expect(spanY).toBeLessThan(spanX);
    await act(async () => {});
  });

  it("lifts an integrated arc into the picture's frame with no residual rotation", async () => {
    const { view } = mount({ config: { frame: "Kerbin" }, trajectoryKind: 2 });
    const path = await waitFor(() => {
      const found = view.container.querySelector(
        'path[data-vessel-trajectory="arc"]',
      );
      if (found === null) throw new Error("no arc drawn yet");
      return found;
    });
    // `Perifocal`: the diagram lifts the points with the elements' full three-dimensional rotation.
    expect(path.getAttribute("data-trajectory-frame")).toBe("1");
    expect(path.getAttribute("transform")).toBeNull();
    expect(path.parentElement?.getAttribute("transform")).toBeNull();
    await act(async () => {});
  });

  it("is operable and announced with the frame caption on screen", async () => {
    const { view } = mount({ config: { frame: "Kerbin" }, trajectoryKind: 2 });
    await waitFor(() => {
      expect(view.container.querySelector("svg")).not.toBeNull();
    });
    await expectNoA11yViolations(view.container);
  });
});
