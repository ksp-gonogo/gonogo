import {
  CORE_UPLINK_CLIENT,
  ContributionsProvider,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";
import { parentDirectionProjectionId } from "./projection";

/**
 * Where the BODIES are drawn, which is the half of the picture every frame test
 * before this one left out.
 *
 * `readFrame.integration.test.tsx` ended at an attribute on the drawn `<path>`,
 * and the bodies are not on that path: so a frame option reframed the craft's
 * curve while every body stayed in parent-centred inertial coordinates, two
 * frames in one picture, and every assertion in the tree stayed green. Everything
 * here ends at a child body's own `cx`/`cy`, which is the only place that defect
 * is visible.
 *
 * <b>One mount per case, and that is not a style choice.</b>
 * `setupStreamFixture` calls `clearProcessorRuntime()`, which is module-global,
 * so a second fixture in one test body replaces the catalogue the first view is
 * reading and both views end up showing the LAST system emitted. A comparison
 * between two renders in one body therefore compares a picture with itself and
 * passes whatever the code does. Every case below asserts an absolute geometric
 * invariant of the frame instead, which is a stronger claim than a difference.
 */

const KERBOL_MU = 1.1723328e18;
const KERBIN_MU = 3.5316e12;
const MUN_MU = 6.5138398e10;

const KERBOL_INDEX = 0;
const KERBIN_INDEX = 1;
const MUN_INDEX = 2;

const MUN_SMA = 12_000_000;

/**
 * Kerbin's mean anomaly at epoch, radians, and Mun's. Neither is near a half
 * turn on purpose: at a half turn the bearing to Kerbol lands on `+x`, the
 * parent-direction basis comes out as the identity, and a test built on that
 * phase would compare a frame with itself.
 */
const KERBIN_MEAN_ANOMALY = 1.0;
const MUN_MEAN_ANOMALY = 1.7;

/** A quarter of Mun's period about Kerbin, seconds. */
const MUN_QUARTER_PERIOD =
  (2 * Math.PI * Math.sqrt(MUN_SMA ** 3 / KERBIN_MU)) / 4;

/**
 * The Kerbin-Mun pair's own rotating-pulsating frame, contributed from OUTSIDE
 * the host exactly as an Uplink would contribute one.
 *
 * <b>This is the case unit tests on `toFrame` cannot fail.</b> The arithmetic has
 * its own tests and they pass whether or not the diagram calls it. What this pins
 * is the diagram: in the pair's own frame the secondary sits on the first axis at
 * every instant, so Mun's drawn `cy` is zero and its `cx` is positive, and it
 * stays that way a quarter period later while every inertial position in the
 * picture has moved. Nothing but the real transform, applied to the real body
 * placement, produces that.
 */
CORE_UPLINK_CLIENT.registerContribution({
  id: "test-kerbin-mun-pulsating",
  contributes: "system-view.projection",
  deps: ["system.bodies"],
  compute: () => [
    {
      id: "test.kerbin-mun",
      label: "Hold the Mun still",
      choice: { kind: "rotating-pulsating", bodyIndex: MUN_INDEX },
      // Coordinates are multiples of the pair's separation, so metres are not a
      // unit this picture has: an auto-fit over apoapsis in metres would size
      // the diagram by a quantity that is not on it.
      extent: { kind: "fixed-units", units: 1.4 },
      frameBodyIndex: KERBIN_INDEX,
    },
  ],
});

/**
 * A moon at `inclination`, placed a quarter turn past its ascending node so it
 * sits at its greatest distance from the reference plane. A flat projection puts
 * it a full `sma` from the parent whatever the inclination is; an honest one puts
 * it `sma * cos(inclination)` away.
 */
function inclinedMoon(inclination: number) {
  return {
    index: 3,
    name: "Minmus",
    parentIndex: KERBIN_INDEX,
    radius: 60_000,
    gravParameter: 1.7658e9,
    sphereOfInfluence: 2_247_428,
    orbit: {
      sma: MUN_SMA,
      ecc: 0,
      inc: inclination,
      lan: 0,
      argPe: 90,
      meanAnomalyAtEpoch: 0,
      epoch: 0,
    },
  };
}

function kerbolSystem(inclination: number) {
  return {
    bodies: [
      {
        index: KERBOL_INDEX,
        name: "Kerbol",
        parentIndex: null,
        radius: 261_600_000,
        gravParameter: KERBOL_MU,
        orbit: null,
      },
      {
        index: KERBIN_INDEX,
        name: "Kerbin",
        parentIndex: KERBOL_INDEX,
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
          meanAnomalyAtEpoch: KERBIN_MEAN_ANOMALY,
          epoch: 0,
        },
      },
      {
        index: MUN_INDEX,
        name: "Mun",
        parentIndex: KERBIN_INDEX,
        radius: 200_000,
        gravParameter: MUN_MU,
        sphereOfInfluence: 2_429_559,
        orbit: {
          sma: MUN_SMA,
          ecc: 0,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: MUN_MEAN_ANOMALY,
          epoch: 0,
        },
      },
      inclinedMoon(inclination),
    ],
  };
}

const WIDGET_META = {
  componentId: "system-view",
  contributionSlots: ["system-view.projection"] as const,
};

function mount(options: {
  config: { frame: string; projection?: string };
  inclination?: number;
  ut?: number;
}) {
  const fixture: StreamFixture = setupStreamFixture({
    carriedChannels: [
      "vessel.orbit",
      "vessel.identity",
      "system.bodies",
      "system.vessels",
    ],
    pinnedUt: options.ut ?? 0,
    suspendFrames: true,
  });

  const view = render(
    <fixture.Provider>
      <WidgetMetaContext.Provider value={WIDGET_META}>
        <ContributionsProvider>
          <SystemViewComponent config={options.config as never} id="sv" />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );

  act(() => {
    fixture.emit("system.bodies", kerbolSystem(options.inclination ?? 0));
    fixture.emit("vessel.identity", {
      vesselId: "v-active",
      name: "Active Craft",
      vesselType: 0,
      situation: 3,
      parentBodyIndex: KERBIN_INDEX,
    });
    fixture.emit("vessel.orbit", {
      referenceBodyIndex: KERBIN_INDEX,
      sma: 3_000_000,
      ecc: 0.1,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 0,
      mu: KERBIN_MU,
      horizon: { kind: 1, trajectoryKind: 2 },
    });
  });

  return { fixture, view };
}

async function bodyAt(
  view: { container: HTMLElement },
  name: string,
): Promise<{ x: number; y: number }> {
  const dot = await waitFor(() => {
    const found = view.container.querySelector(`circle[data-body="${name}"]`);
    if (found === null) throw new Error(`${name} is not drawn yet`);
    return found;
  });
  return {
    x: Number(dot.getAttribute("cx")),
    y: Number(dot.getAttribute("cy")),
  };
}

/** An angle in (-pi, pi]. */
function wrapAngle(radians: number): number {
  let a = radians % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

describe("SystemView body placement", () => {
  it("turns the bodies into the frame the picture is drawn in, not just the curve", async () => {
    const { view } = mount({
      config: {
        frame: "Kerbin",
        projection: parentDirectionProjectionId(KERBIN_INDEX),
      },
    });
    const mun = await bodyAt(view, "Mun");

    // A parent-direction frame on Kerbin points its first axis at Kerbol, so
    // every drawn position turns by the bearing to Kerbol and nothing else: a
    // rotation, so the distance from the frame body is unchanged, and the angle
    // moves by exactly that bearing. Kerbin is on a circular orbit, so its own
    // true anomaly IS its mean anomaly, and Kerbol's bearing from it is a half
    // turn on from that.
    const parentBearing = KERBIN_MEAN_ANOMALY + Math.PI;
    const munInertialAngle = MUN_MEAN_ANOMALY;
    expect(Math.hypot(mun.x, mun.y)).toBeGreaterThan(1);
    expect(wrapAngle(Math.atan2(mun.y, mun.x))).toBeCloseTo(
      wrapAngle(munInertialAngle - parentBearing),
      3,
    );
    await act(async () => {});
  });

  it("holds the pair's own secondary on the first axis, at the first instant", async () => {
    const { view } = mount({
      config: { frame: "Kerbin", projection: "test.kerbin-mun" },
    });
    const mun = await bodyAt(view, "Mun");
    // On the axis, at the far end of it: `cy` is zero and `cx` is positive. In
    // the inertial picture Mun is at 1.7 radians and neither of those holds.
    expect(Math.abs(mun.y)).toBeLessThan(0.01);
    expect(mun.x).toBeGreaterThan(1);
    await act(async () => {});
  });

  it("still holds it there a quarter period later", async () => {
    const { view } = mount({
      config: { frame: "Kerbin", projection: "test.kerbin-mun" },
      ut: MUN_QUARTER_PERIOD,
    });
    const mun = await bodyAt(view, "Mun");
    // Every inertial position in this picture has moved a quarter turn since the
    // case above, and this one has not moved at all. That is the whole reason to
    // draw in a pair's own frame, and it is a claim about the DIAGRAM: the frame
    // arithmetic's own tests pass whether or not the diagram calls it.
    expect(Math.abs(mun.y)).toBeLessThan(0.01);
    expect(mun.x).toBeGreaterThan(1);
    await act(async () => {});
  });

  it("foreshortens an inclined body instead of drawing it flat", async () => {
    const { view } = mount({ config: { frame: "Kerbin" }, inclination: 60 });
    const minmus = await bodyAt(view, "Minmus");
    const mun = await bodyAt(view, "Mun");

    // Both moons share a semi-major axis and a circular orbit, so in a flat
    // projection they are drawn exactly the same distance from Kerbin. Minmus is
    // a quarter turn past its ascending node, so the whole of its inclination
    // shows: its projected distance is `sma * cos(inc)`, which at 60 degrees is
    // half of Mun's.
    const munRadius = Math.hypot(mun.x, mun.y);
    const minmusRadius = Math.hypot(minmus.x, minmus.y);
    expect(munRadius).toBeGreaterThan(1);
    expect(minmusRadius / munRadius).toBeCloseTo(
      Math.cos((60 * Math.PI) / 180),
      3,
    );
    await act(async () => {});
  });

  it("says how far out of the plane a body is, from where the body IS", async () => {
    const { view } = mount({ config: { frame: "Kerbin" }, inclination: 60 });
    const depthOf = async (name: string) => {
      await bodyAt(view, name);
      const dot = view.container.querySelector(`circle[data-body="${name}"]`);
      return Number(dot?.getAttribute("data-depth-px"));
    };
    // Mun's orbit is equatorial, so it has no depth. Minmus is 60 degrees
    // inclined AND a quarter turn from its node, which is where the whole of
    // that inclination turns into depth. The distinction the old inclination
    // gradient could not make is the other case: a body at its node has no depth
    // however inclined its orbit, and this reading comes from the position.
    expect(await depthOf("Mun")).toBeCloseTo(0, 6);
    expect(Math.abs(await depthOf("Minmus"))).toBeGreaterThan(1);
    await act(async () => {});
  });

  it("is operable with the frame it drew in named on screen", async () => {
    const { view } = mount({
      config: { frame: "Kerbin", projection: "test.kerbin-mun" },
    });
    await waitFor(() => {
      expect(view.container.querySelector("svg")).not.toBeNull();
    });
    // The frame's name carries that its lengths pulsate: it is the name the
    // operator selected the frame by.
    expect(view.container.textContent).toContain("Lagrange");
    await expectNoA11yViolations(view.container);
  });
});
