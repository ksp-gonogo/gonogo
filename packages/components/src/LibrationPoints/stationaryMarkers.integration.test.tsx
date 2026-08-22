import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { LibrationPointsComponent } from "./index";

/**
 * The pair reaches the drawn frame, and the markers hold still in it.
 *
 * <b>Nothing here sets a flag or mocks a hook open.</b> Each case starts at a
 * saved config value, goes through the real catalogue processor, the real frame
 * arithmetic and the real diagram, and ends at an attribute on the drawn SVG. If
 * the pair control stopped reaching the frame, or the frame stopped reaching the
 * drawing, these fail while every unit test in the tree stays green. That is the
 * shape of check a previous slice did not have, and it shipped a feature that
 * never ran once with two thousand tests passing.
 *
 * The pair is ECCENTRIC on purpose. Over a circular pair the separation never
 * changes, so a diagram scaled in metres would hold its markers still too and
 * the central assertion would pass on the code it exists to reject.
 */

const KERBOL_MU = 1.1723328e18;
const KERBIN_MU = 3.5316e12;
const MUN_MU = 6.5138398e10;

const MUN_SMA = 12_000_000;
const MUN_ECC = 0.4;
/** Mun's own period, so a sweep of view instants covers a real revolution. */
const MUN_PERIOD = 2 * Math.PI * Math.sqrt(MUN_SMA ** 3 / KERBIN_MU);

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
        gravParameter: MUN_MU,
        sphereOfInfluence: 2_429_559,
        orbit: {
          sma: MUN_SMA,
          // Eccentric, so the pair's separation really moves across the sweep.
          ecc: MUN_ECC,
          inc: 0,
          lan: 0,
          argPe: 0,
          // Periapsis at UT zero, so the sweep starts at one extreme.
          meanAnomalyAtEpoch: 0,
          epoch: 0,
        },
      },
    ],
  };
}

function mount(
  config: { pair?: string },
  pinnedUt: number,
  vesselSma = 9_000_000,
  /** Omit the horizon, the way a producer that never stated a shape would. */
  statesNoShape = false,
) {
  const fixture: StreamFixture = setupStreamFixture({
    carriedChannels: ["vessel.orbit", "vessel.identity", "system.bodies"],
    pinnedUt,
  });
  const view = render(
    <fixture.Provider>
      <LibrationPointsComponent config={config as never} id="lp" />
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("system.bodies", kerbolSystem());
    fixture.emit("vessel.identity", {
      vesselId: "v-active",
      name: "Waypoint",
      vesselType: 0,
      situation: 3,
      parentBodyIndex: 1,
    });
    fixture.emit("vessel.orbit", {
      referenceBodyIndex: 1,
      sma: vesselSma,
      ecc: 0.1,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 0,
      mu: KERBIN_MU,
      // What the stock closed-form solver really publishes: an unbounded horizon
      // on an analytic answer. The seam samples that into points when a read
      // frame is asked for, so the craft's curve is live here rather than only
      // where something integrates.
      horizon: statesNoShape ? undefined : { kind: 1, trajectoryKind: 1 },
    });
  });
  return { fixture, view };
}

async function svgOf(view: { container: HTMLElement }) {
  return await waitFor(() => {
    const found = view.container.querySelector("[data-libration-frame]");
    if (found === null) throw new Error("nothing drawn yet");
    return found;
  });
}

function markerPositions(svg: Element): Map<string, string> {
  const out = new Map<string, string>();
  for (const node of svg.querySelectorAll("[data-libration-point]")) {
    const name = node.getAttribute("data-libration-point") ?? "?";
    out.set(name, `${node.getAttribute("cx")},${node.getAttribute("cy")}`);
  }
  return out;
}

describe("LibrationPoints: the pair reaches the frame", () => {
  it("carries a saved pair all the way from the config to the drawn frame", async () => {
    const { view } = mount({ pair: "Mun" }, 0);
    const svg = await svgOf(view);
    expect(svg.getAttribute("data-libration-frame")).toBe("rotating-pulsating");
    expect(svg.getAttribute("data-libration-pair")).toBe("Kerbin-Mun");
    expect(markerPositions(svg).size).toBe(5);
    // And the widget says which frame it drew in, in the same words every other
    // trajectory-drawing widget uses.
    expect(view.container.textContent).toContain(
      "Drawn in Kerbin-Mun rotating-pulsating",
    );
    expect(view.container.textContent).toContain("lengths are not lengths");
    // And the craft's own curve arrived IN this frame rather than in metres: 5
    // is `RotatingPulsating`, carried from the answer onto the drawing, so the
    // assertion is against the picture and not against a value a test set.
    const path = svg.querySelector('[data-libration-path="arc"]');
    expect(path).not.toBeNull();
    expect(path?.getAttribute("data-trajectory-frame")).toBe("5");
    await act(async () => {});
  });

  it("draws a DIFFERENT pair's frame for a different saved value, so the config is really read", async () => {
    const { view } = mount({ pair: "Kerbin" }, 0);
    const svg = await svgOf(view);
    expect(svg.getAttribute("data-libration-pair")).toBe("Kerbol-Kerbin");
    await act(async () => {});
  });

  it("picks a pair itself on auto, and it is not the same one either saved value asks for", async () => {
    // Measured, not assumed: the two explicit cases above have to STRADDLE
    // whatever auto lands on, else one of them would pass on a widget that
    // ignored its config entirely and fell through to auto.
    const { view } = mount({}, 0);
    const svg = await svgOf(view);
    const auto = svg.getAttribute("data-libration-pair");
    expect(auto).not.toBeNull();
    expect(["Kerbol-Kerbin", "Kerbin-Mun"]).toContain(auto);
    // Whichever it chose, one of the two saved-value cases asks for the other,
    // so at least one of them fails if the config stops being read.
    await act(async () => {});
  });

  it("says which pair has no points and why, rather than drawing nothing", async () => {
    const { view } = mount({ pair: "Kerbol" }, 0);
    await waitFor(() => {
      expect(view.container.textContent).toContain("orbits nothing");
    });
    expect(view.container.textContent).toContain("Kerbol");
    // No diagram, because there is no frame: the sentence is the whole answer.
    expect(view.container.querySelector("[data-libration-frame]")).toBeNull();
    await act(async () => {});
  });
});

describe("LibrationPoints: the markers hold still", () => {
  it("holds every marker at the same drawn position across a revolution of an eccentric pair", async () => {
    const instants = [
      0,
      MUN_PERIOD / 6,
      MUN_PERIOD / 3,
      MUN_PERIOD / 2,
      (MUN_PERIOD * 5) / 6,
    ];
    const drawn: {
      markers: Map<string, string>;
      unitLength: number;
      bodyGap: number;
    }[] = [];
    for (const ut of instants) {
      const { view } = mount({ pair: "Mun" }, ut);
      const svg = await svgOf(view);
      const unitLength = Number(svg.getAttribute("data-libration-unit-length"));
      const primary = svg.querySelector('[data-libration-body="primary"]');
      const secondary = svg.querySelector('[data-libration-body="secondary"]');
      drawn.push({
        markers: markerPositions(svg),
        unitLength,
        bodyGap:
          Number(secondary?.getAttribute("cx")) -
          Number(primary?.getAttribute("cx")),
      });
      view.unmount();
      await act(async () => {});
    }

    // The pair really did move, else the assertion below proves nothing: the
    // separation swings between periapsis and apoapsis of a 0.4-eccentricity
    // orbit, which is a factor of better than two.
    const lengths = drawn.map((d) => d.unitLength);
    expect(Math.min(...lengths)).toBeGreaterThan(
      MUN_SMA * (1 - MUN_ECC) * 0.99,
    );
    expect(Math.max(...lengths)).toBeLessThan(MUN_SMA * (1 + MUN_ECC) * 1.01);
    expect(Math.max(...lengths) / Math.min(...lengths)).toBeGreaterThan(2);

    // And the five markers did not.
    const first = drawn[0].markers;
    expect(first.size).toBe(5);
    for (const sample of drawn) {
      expect([...sample.markers.entries()].sort()).toEqual(
        [...first.entries()].sort(),
      );
      // The two bodies are one frame unit apart at every instant, whatever the
      // separation is in metres. That is the property being drawn.
      expect(sample.bodyGap).toBeCloseTo(drawn[0].bodyGap, 9);
    }
  });

  it("reports the pair's separation in metres beside a diagram whose units are ratios", async () => {
    // The coordinates are multiples of the separation, so the separation is the
    // only thing that turns them back into distances and the widget has to show
    // it. Peri at UT zero.
    const { view } = mount({ pair: "Mun" }, 0);
    await svgOf(view);
    await waitFor(() => {
      expect(view.container.textContent).toContain("Separation");
    });
    // 7.2 Mm is periapsis of a 12 Mm, 0.4-eccentricity orbit, laddered by the
    // one unit renderer rather than formatted here.
    // Whitespace-tolerant: the one unit renderer sets its own space between the
    // number and the symbol, and it is not an ASCII one.
    expect(view.container.textContent).toMatch(/7\.2\s*Mm/);
    await act(async () => {});
  });
});

describe("LibrationPoints: the craft's path", () => {
  it("still places the five points when the path itself is withheld, and says why", async () => {
    // A producer that stated no shape. The five points are a property of the
    // PAIR and are unaffected, so covering them would overstate the refusal.
    const { view } = mount({ pair: "Mun" }, 0, 9_000_000, true);
    const svg = await svgOf(view);
    expect(svg.querySelectorAll("[data-libration-point]")).toHaveLength(5);
    expect(svg.querySelector('[data-libration-path="arc"]')).toBeNull();
    expect(view.container.textContent).toMatch(/shape|state/i);
    await act(async () => {});
  });
});

describe("LibrationPoints: the craft's offset", () => {
  it("names the point a craft near the pair is nearest, and calls it drifting", async () => {
    const { view } = mount({ pair: "Mun" }, 0);
    await svgOf(view);
    await waitFor(() => {
      expect(view.container.textContent).toContain("Nearest");
    });
    // A craft 9 Mm out from Kerbin, with Mun 7.2 Mm away, is close to the far
    // collinear point and not on it.
    expect(view.container.textContent).toContain("L2 · drifting off station");
    expect(view.container.textContent).toContain("Off station");
    await act(async () => {});
  });

  it("says a craft in low orbit is not stationkeeping on anything, rather than alarming about it", async () => {
    const { view } = mount({ pair: "Mun" }, 0, 700_000);
    await svgOf(view);
    await waitFor(() => {
      expect(view.container.textContent).toContain("Nearest");
    });
    expect(view.container.textContent).toContain("not stationkeeping on it");
    await act(async () => {});
  });

  it("is operable and announced", async () => {
    const { view } = mount({ pair: "Mun" }, 0);
    await svgOf(view);
    await expectNoA11yViolations(view.container);
  });
});
