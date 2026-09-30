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
import {
  followControlFrameProjectionId,
  parentDirectionProjectionId,
  type SystemViewProjection,
} from "./projection";

/**
 * Where the BODIES are drawn under each frame: every case ends at a child body's own `cx`/`cy`, since reframing only the craft's curve would leave two frames in one picture.
 *
 * One mount per case: `setupStreamFixture` clears the module-global processor runtime, so two fixtures in one body would both show the last system emitted. Each case asserts an absolute geometric invariant instead of a difference.
 */

const KERBOL_MU = 1.1723328e18;
const KERBIN_MU = 3.5316e12;
const MUN_MU = 6.5138398e10;

const KERBOL_INDEX = 0;
const KERBIN_INDEX = 1;
const MUN_INDEX = 2;

const MUN_SMA = 12_000_000;

/** Kerbin's and Mun's mean anomaly at epoch, radians, kept off a half turn, where the parent-direction basis is the identity and a frame would compare with itself. */
const KERBIN_MEAN_ANOMALY = 1.0;
const MUN_MEAN_ANOMALY = 1.7;

/** A quarter of Mun's period about Kerbin, seconds. */
const MUN_QUARTER_PERIOD =
  (2 * Math.PI * Math.sqrt(MUN_SMA ** 3 / KERBIN_MU)) / 4;

/** The Kerbin-Mun rotating-pulsating frame, contributed from outside the host as an Uplink would; in it Mun sits on the first axis at every instant, which only the real transform on the real placement produces. */
CORE_UPLINK_CLIENT.registerContribution({
  id: "test-kerbin-mun-pulsating",
  contributes: "system-view.projection",
  deps: ["system.bodies"],
  compute: (): SystemViewProjection[] => [
    {
      id: "test.kerbin-mun",
      label: "Hold the Mun still",
      choice: { kind: "rotating-pulsating", bodyIndex: MUN_INDEX },
      // Coordinates are multiples of the pair's separation, so an auto-fit over apoapsis in metres would size by a quantity not on the diagram.
      extent: { kind: "fixed-units", units: 1.4 },
      frameBodyIndex: KERBIN_INDEX,
    },
  ],
});

/** A moon a quarter turn past its ascending node, at its greatest depth: an honest projection puts it `sma * cos(inclination)` from the parent. */
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

    // A parent-direction frame turns every position by the bearing to Kerbol, a half turn on from Kerbin's mean anomaly on its circular orbit, and leaves distances unchanged.
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
    // On the far end of the axis: `cy` zero and `cx` positive, neither of which holds inertially.
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
    // Every inertial position has moved a quarter turn since the case above, and Mun has not moved at all.
    expect(Math.abs(mun.y)).toBeLessThan(0.01);
    expect(mun.x).toBeGreaterThan(1);
    await act(async () => {});
  });

  it("foreshortens an inclined body instead of drawing it flat", async () => {
    const { view } = mount({ config: { frame: "Kerbin" }, inclination: 60 });
    const minmus = await bodyAt(view, "Minmus");
    const mun = await bodyAt(view, "Mun");

    // Same sma and circular orbits, but Minmus is at its greatest depth, so its projected distance is `sma * cos(60 deg)`, half of Mun's.
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
    // Mun is equatorial, so no depth; Minmus is inclined and a quarter turn from its node, where the whole inclination is depth.
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
    // The frame's name, which the operator selected it by, carries that its lengths pulsate.
    expect(view.container.textContent).toContain("Lagrange");
    await expectNoA11yViolations(view.container);
  });
});

describe("SystemView follow-control-frame", () => {
  const followId = followControlFrameProjectionId(KERBIN_INDEX);

  it("falls back to the default picture when the Control Frame draws the same thing (the option was hidden, a stale pinned id is a no-op)", async () => {
    const { view, fixture } = mount({
      config: { frame: "Kerbin", projection: followId },
    });
    act(() => {
      // Same as the diagram's own default: Kerbin-centred inertial.
      fixture.emit("system.frame", { kind: 1, centreBody: "Kerbin" });
    });
    const mun = await bodyAt(view, "Mun");
    expect(Math.hypot(mun.x, mun.y)).toBeGreaterThan(1);
    expect(wrapAngle(Math.atan2(mun.y, mun.x))).toBeCloseTo(
      wrapAngle(MUN_MEAN_ANOMALY),
      3,
    );
    await act(async () => {});
  });

  it("follows the Control Frame once it draws something new: a rotating-pulsating election puts the secondary on the first axis", async () => {
    // Kerbin-Minmus, not Kerbin-Mun: this file already contributes a hand-authored "test.kerbin-mun" entry at module scope (above), and a Control Frame that coincided with an already-offered choice is the OTHER case, covered by the previous test.
    const { view, fixture } = mount({
      config: { frame: "Kerbin", projection: followId },
    });
    // Minmus is already drawn from the initial (pre-frame) picture, so the assertion itself has to be the thing `waitFor` retries, not just the element's presence: `bodyAt` would otherwise hand back that first, un-reframed render.
    await bodyAt(view, "Minmus");
    act(() => {
      fixture.emit("system.frame", {
        kind: 4,
        primaryBody: "Kerbin",
        secondaryBody: "Minmus",
      });
    });
    // Same invariant `resolveProjection` already proves for a hand-authored rotating-pulsating contribution; here it is reached through resolveReadFrame instead.
    await waitFor(() => {
      const dot = view.container.querySelector('circle[data-body="Minmus"]');
      expect(Math.abs(Number(dot?.getAttribute("cy")))).toBeLessThan(0.01);
      expect(Number(dot?.getAttribute("cx"))).toBeGreaterThan(1);
    });
    await act(async () => {});
  });
});
