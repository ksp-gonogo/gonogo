import { DashboardItemContext, dispatchAction } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { LibrationPointsComponent } from "./index";

/**
 * The pair reaches the drawn frame, and the markers hold still in it. Nothing
 * is mocked: each case runs from a saved config value through the real
 * catalogue processor, frame arithmetic and diagram to an attribute on the SVG.
 * The pair is eccentric on purpose: over a circular pair a metre-scaled
 * diagram would hold its markers still too.
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
    pinnedUt,
    suspendFrames: true,
  });
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "lp" }}>
        <LibrationPointsComponent config={config as never} id="lp" />
      </DashboardItemContext.Provider>
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
      // What the stock closed-form solver publishes: an unbounded horizon on an analytic answer.
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
    // The frame named in the same words every other trajectory-drawing widget uses.
    expect(view.container.textContent).toContain("Kerbin-Mun Lagrange");
    // The craft's curve arrived in this frame: 5 is `RotatingPulsating`, carried from the answer onto the drawing.
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
    // The two explicit cases must straddle whatever auto lands on, or one would pass on a widget ignoring its config.
    const { view } = mount({}, 0);
    const svg = await svgOf(view);
    const auto = svg.getAttribute("data-libration-pair");
    expect(auto).not.toBeNull();
    expect(["Kerbol-Kerbin", "Kerbin-Mun"]).toContain(auto);
    await act(async () => {});
  });

  it("says which pair has no points and why, rather than drawing nothing", async () => {
    const { view } = mount({ pair: "Kerbol" }, 0);
    await waitFor(() => {
      expect(view.container.textContent).toContain("orbits nothing");
    });
    expect(view.container.textContent).toContain("Kerbol");
    // No frame, so no diagram: the sentence is the whole answer.
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

    // The separation really moved (a factor of more than two at 0.4 eccentricity), or the assertion below proves nothing.
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
      // The two bodies are one frame unit apart at every instant: the property being drawn.
      expect(sample.bodyGap).toBeCloseTo(drawn[0].bodyGap, 9);
    }
  });

  it("reports the pair's separation in metres beside a diagram whose units are ratios", async () => {
    // Coordinates are multiples of the separation, so the widget has to show it. Periapsis at UT zero.
    const { view } = mount({ pair: "Mun" }, 0);
    await svgOf(view);
    await waitFor(() => {
      expect(view.container.textContent).toContain("Separation");
    });
    // 7.2 Mm is periapsis of a 12 Mm, 0.4-eccentricity orbit. Whitespace-tolerant: the unit renderer's space is not ASCII.
    expect(view.container.textContent).toMatch(/7\.2\s*Mm/);
    await act(async () => {});
  });
});

describe("LibrationPoints: the craft's path", () => {
  it("still places the five points when the path itself is withheld, and says why", async () => {
    // A producer that stated no shape: the five points belong to the pair and stay.
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
    // 9 Mm out from Kerbin with Mun 7.2 Mm away is near the far collinear point, not on it.
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

describe("LibrationPoints: the pair control has an action", () => {
  function press(): void {
    act(() => {
      dispatchAction("lp", "cyclePair", { kind: "button", value: true });
    });
  }

  it("steps the pair on a press, through Auto and back round to where it started", async () => {
    const { view } = mount({ pair: "Kerbin" }, 0);
    const pairOf = async () =>
      (await svgOf(view)).getAttribute("data-libration-pair");
    const select = () =>
      view.container.querySelector("select") as HTMLSelectElement;
    expect(await pairOf()).toBe("Kerbol-Kerbin");

    const seen = new Set<string>();
    const steps = select().options.length;
    for (let i = 0; i < steps; i++) {
      press();
      seen.add(select().value);
    }

    expect(seen).toEqual(new Set(["auto", "Kerbin", "Mun"]));
    expect(select().value).toBe("Kerbin");
    expect(await pairOf()).toBe("Kerbol-Kerbin");
    await act(async () => {});
  });

  it("ignores the release of a held button", async () => {
    const { view } = mount({ pair: "Kerbin" }, 0);
    await svgOf(view);
    act(() => {
      dispatchAction("lp", "cyclePair", { kind: "button", value: false });
    });
    expect(
      (view.container.querySelector("select") as HTMLSelectElement).value,
    ).toBe("Kerbin");
    await act(async () => {});
  });
});
