import {
  buildElements,
  defineUplinkClient,
  keplerAdmissibility,
  magnitudeOr,
  Quality,
  solve,
  type TimelinePoint,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { defineUplinkClient as spineDefineUplinkClient } from "@ksp-gonogo/sitrep-sdk/spine";
import { installTestHost } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearReckoners, registerCoreReckoners } from "./reckoners";
import { makeMeta } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { vesselStateChannel } from "./vessel-state";
import { ViewClock } from "./view-clock";

/**
 * The deliverable of the reckoning work: what the built-in does IS what a
 * third-party Uplink can do.
 *
 * Reckoning worked in this client long before a value could declare itself
 * reckonable, through `deriveVesselStateReckoning` on the `vessel.state` derived
 * channel. That path is not one an Uplink author can take. A derived channel can
 * only LABEL arithmetic that already happened inside its own `derive`, a wire
 * Topic has no `derive`, and every symbol of the conic sat behind `/spine`,
 * which the isolation gate blocks. So the declared extensibility surface held a
 * single registration: a stub that always declined.
 *
 * This asserts the gap is closed, and asserts it the only way that means
 * anything: by REGISTERING THE SAME MODEL A SECOND TIME through the surface an
 * author has, and comparing the numbers.
 *
 * ## What "the surface an author has" means here, precisely
 *
 * The probe below imports `defineUplinkClient`, `buildElements`, `solve`,
 * `keplerAdmissibility` and `value` from `@ksp-gonogo/sitrep-sdk`, the ROOT
 * barrel, which is the whole of what `docs/uplink-isolation.md` permits. It
 * registers through the client handle, so its model is owner-stamped the way an
 * Uplink's is. Nothing it does reaches `/spine`.
 *
 * The HARNESS (the store, the channel definition, the stub meta) imports
 * whatever it likes: driving a `TimelineStore` by hand is a test's job, not an
 * author's.
 *
 * ## Why the sweep includes the withdrawal instants
 *
 * Equality in the middle of the window proves nothing about the horizon, and the
 * horizon is where every disagreement between two copies of a model will be. So
 * the sweep walks the conic's own withdrawals: the SOI transition the elements
 * carry, and the atmosphere interface this eccentric orbit's periapsis passes
 * through. At each instant the two must AGREE ABOUT WITHDRAWING, not merely
 * agree about numbers while both are answering.
 */

const KERBIN_MU = 3.5316e12;
const KERBIN_RADIUS = 600_000;
const ATMOSPHERE_DEPTH = 70_000;

/**
 * An eccentric Kerbin orbit whose periapsis (540 km radius) is below the
 * atmosphere interface (670 km), so a sweep across one period crosses the air
 * without the fixture having to arrange it.
 */
const ECCENTRIC = {
  referenceBodyIndex: 1,
  sma: value("m", 900_000),
  ecc: value("1", 0.4),
  inc: value("°", 0),
  lan: value("°", 0),
  argPe: value("°", 0),
  meanAnomalyAtEpoch: value("rad", 0),
  epoch: value("ut", 0),
  mu: value("m³/s²", KERBIN_MU),
  horizon: { kind: 1, trajectoryKind: 1 },
} as const;

const SYSTEM = {
  bodies: [
    {
      name: "Sun",
      index: 0,
      parentIndex: null,
      radius: 261_600_000,
      orbit: null,
    },
    {
      name: "Kerbin",
      index: 1,
      parentIndex: 0,
      radius: KERBIN_RADIUS,
      orbit: null,
      atmosphere: { depth: ATMOSPHERE_DEPTH },
    },
  ],
};

function point<T>(validAt: number, payload: T): TimelinePoint<T> {
  return {
    validAt,
    payload,
    meta: makeMeta({
      validAt,
      deliveredAt: validAt,
      quality: Quality.OnRails,
      source: "vessel:equivalence",
    }),
    epoch: 0,
  };
}

/**
 * EXACTLY what an Uplink author would write, in the shape H.5 of the plan
 * spells out: declared inputs in `Dep` notation, the repo's own conic rather
 * than a vendored one, and a decline that names the input responsible.
 */
function registerProbeReckoner(): void {
  const PROBE = defineUplinkClient({
    id: "equivalence-probe",
    version: "0.0.0",
    name: "Equivalence Probe",
    description:
      "Registers core's conic a second time, through the author surface.",
  });
  PROBE.registerReckoner("vessel.flight", {
    deps: ["vessel.orbit", "system.bodies"],
    reckon(_point, [orbitPoint, bodiesPoint], { viewUt }) {
      const orbit = orbitPoint?.payload;
      const bodies = bodiesPoint?.payload ?? undefined;
      const admissible = keplerAdmissibility(orbitPoint, bodies, viewUt);
      if ("declined" in admissible || !orbit) {
        return "declined" in admissible
          ? admissible
          : { declined: { reason: "input-absent", input: "@vessel.orbit" } };
      }
      const elements = buildElements(orbit);
      const radius = bodies?.bodies.find(
        (b) => b.index === orbit.referenceBodyIndex,
      )?.radius;
      if (radius == null) {
        return {
          declined: { reason: "input-absent", input: "@system.bodies" },
        };
      }
      return {
        modelled: [
          { path: "", basis: "kepler-propagation" },
          { path: "altitudeAsl", basis: "kepler-propagation" },
          { path: "orbitalSpeed", basis: "kepler-propagation" },
        ],
        reckon: (at: number) => {
          const state = solve(elements, at);
          return {
            altitudeAsl: value(
              "m",
              Math.hypot(...state.position) - magnitudeOr(radius, Number.NaN),
            ),
            orbitalSpeed: value("m/s", Math.hypot(...state.velocity)),
          };
        },
      };
    },
  });
}

/**
 * A store whose view time is set directly, so the sweep can stand on a
 * withdrawal instant rather than near it. Predicted mode is what lets `viewUt`
 * run ahead of the newest sample at all; the wall clock is the dial.
 */
function scene(encounterUt?: number) {
  let wall = 0;
  const clock = new ViewClock({
    nowWall: () => wall,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  clock.setMode("predicted");
  const store = new TimelineStore(clock);
  const at = (viewUt: number) => {
    wall = viewUt;
    store.beginFrame();
  };
  store.registerDerivedChannel(vesselStateChannel);
  store.ingest("system.bodies", point(0, SYSTEM));
  store.ingest(
    "vessel.orbit",
    point(0, {
      ...ECCENTRIC,
      ...(encounterUt === undefined
        ? {}
        : {
            encounter: {
              transitionType: 1,
              transitionUt: value("ut", encounterUt),
              bodyIndex: 0,
            },
          }),
    }),
  );
  store.ingest("vessel.flight", point(0, { altitudeAsl: value("m", 0) }));
  return { store, at };
}

/**
 * The two answers for one view time, as a comparable pair. `undefined` on either
 * side means that model withdrew, which is a result rather than a failure to
 * produce one.
 */
function bothAt(
  { store, at }: { store: TimelineStore; at: (viewUt: number) => void },
  viewUt: number,
): {
  builtIn: { altitudeAsl: number; orbitalSpeed: number } | undefined;
  uplink: { altitudeAsl: number; orbitalSpeed: number } | undefined;
} {
  at(viewUt);
  const state = store.sampleReading<{
    altitudeAsl: number | null;
    orbitalSpeed: number | null;
  }>("vessel.state");
  const flight = store.sampleReading<{
    altitudeAsl: { magnitude: number };
    orbitalSpeed: { magnitude: number };
  }>("vessel.flight");
  return {
    builtIn:
      state.reckoning === "available"
        ? {
            altitudeAsl: state.reckoned.value.altitudeAsl as number,
            orbitalSpeed: state.reckoned.value.orbitalSpeed as number,
          }
        : undefined,
    uplink:
      flight.reckoning === "available"
        ? {
            altitudeAsl: flight.reckoned.value.altitudeAsl.magnitude,
            orbitalSpeed: flight.reckoned.value.orbitalSpeed.magnitude,
          }
        : undefined,
  };
}

let disposeHost: () => void;

beforeAll(() => {
  /*
   * The one piece of app plumbing an Uplink assumes is present: the host the
   * SDK's stateful surface is injected through. Wiring only `defineUplinkClient`
   * is deliberate, it is the only host member the probe touches.
   */
  disposeHost = installTestHost({
    defineUplinkClient: spineDefineUplinkClient,
  });
});

afterAll(() => {
  disposeHost();
});

describe("core's conic and an Uplink's registration of it are the same model", () => {
  it("agrees at every instant of a full period, including the atmosphere crossing", () => {
    clearReckoners();
    registerCoreReckoners();
    registerProbeReckoner();
    const world = scene();

    // One period of an sma-900 km Kerbin orbit is about 2 850 s. Stepping 50 s
    // walks apoapsis, periapsis and the interface crossings on either side of
    // it, which is where the two models have to withdraw together or not at all.
    const disagreements: string[] = [];
    let answered = 0;
    let withdrawn = 0;
    for (let viewUt = 0; viewUt <= 2900; viewUt += 50) {
      const { builtIn, uplink } = bothAt(world, viewUt);
      if ((builtIn === undefined) !== (uplink === undefined)) {
        disagreements.push(
          `ut ${viewUt}: builtIn ${builtIn ? "answered" : "withdrew"}, uplink ${uplink ? "answered" : "withdrew"}`,
        );
        continue;
      }
      if (!builtIn || !uplink) {
        withdrawn += 1;
        continue;
      }
      answered += 1;
      if (
        Math.abs(builtIn.altitudeAsl - uplink.altitudeAsl) > 1e-6 ||
        Math.abs(builtIn.orbitalSpeed - uplink.orbitalSpeed) > 1e-9
      ) {
        disagreements.push(
          `ut ${viewUt}: alt ${builtIn.altitudeAsl} vs ${uplink.altitudeAsl}, speed ${builtIn.orbitalSpeed} vs ${uplink.orbitalSpeed}`,
        );
      }
    }

    expect(disagreements).toEqual([]);
    // The anti-vacuity half. Two models that both withdrew everywhere would
    // agree perfectly and prove nothing, and so would a sweep that never
    // reached the air.
    expect(answered).toBeGreaterThan(20);
    expect(withdrawn).toBeGreaterThan(0);
  });

  it("withdraws together at the SOI transition the elements carry", () => {
    clearReckoners();
    registerCoreReckoners();
    registerProbeReckoner();
    const world = scene(1200);

    // Just inside the transition both answer; at it and past it both stop. The
    // instant itself is the one that matters: an off-by-one in either copy of
    // the guard shows up here and nowhere else.
    const before = bothAt(world, 1100);
    expect(before.builtIn).toBeDefined();
    expect(before.uplink).toBeDefined();

    for (const viewUt of [1400, 1450]) {
      const { builtIn, uplink } = bothAt(world, viewUt);
      expect({ viewUt, builtIn, uplink }).toEqual({
        viewUt,
        builtIn: undefined,
        uplink: undefined,
      });
    }
  });

  it("names the absent input rather than falling silent", () => {
    // RO's second correction, end to end: the reason has to reach the CALLER.
    // A decline that dies inside the store is the silent `undefined` this whole
    // mechanism replaces.
    clearReckoners();
    registerCoreReckoners();
    const clock = new ViewClock({
      nowWall: () => 0,
      warpRate: () => 1,
      delaySeconds: () => 0,
    });
    const store = new TimelineStore(clock);
    store.ingest("vessel.flight", point(0, { altitudeAsl: value("m", 0) }));
    store.beginFrame();

    expect(store.sampleReading("vessel.flight")).toMatchObject({
      reckoning: "none",
      declined: { reason: "input-absent", input: "@vessel.orbit" },
    });

    store.ingest("vessel.orbit", point(0, ECCENTRIC));
    store.beginFrame();
    expect(store.sampleReading("vessel.flight")).toMatchObject({
      declined: { reason: "input-absent", input: "@system.bodies" },
    });
  });

  it("stamps the owner, so core's vanilla and an Uplink's are distinguishable", () => {
    clearReckoners();
    registerCoreReckoners();
    const world = scene();
    world.at(1400);
    const core = world.store.sampleReading("vessel.flight");
    expect(core).toMatchObject({ reckoned: { owner: "core" } });

    registerProbeReckoner();
    world.at(1401);
    expect(world.store.sampleReading("vessel.flight")).toMatchObject({
      reckoned: { owner: "equivalence-probe" },
    });
  });
});
