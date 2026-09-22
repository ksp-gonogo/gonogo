import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { derivedGetOf } from "./derived-get-fixture";
import { makeMeta, type WireOf, wrapWire } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import type { DerivedGet } from "./timeline-store";
import {
  deriveVesselState,
  deriveVesselStateReckoning,
  type SystemBodiesPayload,
  type VesselFlightPayload,
  type VesselOrbitPayload,
  type VesselPropulsionPayload,
  type VesselTargetPayload,
} from "./vessel-state";

/**
 * The three forward models inside `vessel.state`, held to what their doc
 * comments claim about them.
 *
 * None of the three is a registered reckoner and none of them can be:
 * `registerReckoner` takes a `TopicId` and `vessel.state` is a derived channel
 * (`reckoners.test-d.ts` asserts that refusal from both sides). So the file's
 * written reasons are all that stands between a reader and a guess, and prose
 * is not a gate. These cases are: each pins the one fact its site's reason
 * rests on, so a reason that stops being true fails here rather than going
 * quietly stale in a comment.
 */

const KERBIN_RADIUS = 600_000;
const MU_KERBIN = 3.5316e12;

/** A circular 200 km orbit round an airless Kerbin: admissible at every instant. */
const COAST = {
  referenceBodyIndex: 1,
  sma: KERBIN_RADIUS + 200_000,
  ecc: 0,
  inc: 0,
  lan: null,
  argPe: null,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  mu: MU_KERBIN,
  horizon: { kind: 1, trajectoryKind: 1 },
} satisfies WireOf<VesselOrbitPayload>;

/** The target's own conic, deliberately unlike the self craft's. */
const TARGET_ORBIT = {
  ...COAST,
  sma: KERBIN_RADIUS + 400_000,
  ecc: 0.2,
} satisfies WireOf<VesselOrbitPayload>;

const BODIES: SystemBodiesPayload = {
  bodies: [
    {
      name: "Kerbin",
      index: 1,
      parentIndex: 0,
      radius: KERBIN_RADIUS,
      rotationPeriod: 21_600,
      orbit: null,
    },
  ],
};

/** g = mu/(radius+alt)² = 8e10/200000² = 2.0 m/s² at the surface. */
const LANDING_BODIES: SystemBodiesPayload = {
  bodies: [
    {
      name: "Testmun",
      index: 3,
      parentIndex: 0,
      radius: 200_000,
      rotationPeriod: 21_600,
      orbit: null,
    },
  ],
};

const LANDING_ORBIT = {
  ...COAST,
  referenceBodyIndex: 3,
  sma: 250_000,
  mu: 8e10,
} satisfies WireOf<VesselOrbitPayload>;

/** Descending at 10 m/s, 100 m above terrain, thrust 6 m/s² against g = 2. */
const DESCENT = {
  latitude: 0,
  longitude: 0,
  altitudeAsl: 0,
  altitudeTerrain: 100,
  verticalSpeed: -10,
  surfaceSpeed: 20,
  orbitalSpeed: 20,
  gForce: 0,
  dynamicPressureKPa: 0,
  mach: 0,
  atmDensity: 0,
} satisfies WireOf<VesselFlightPayload>;

const PROPULSION: VesselPropulsionPayload = {
  totalMass: 1,
  dryMass: 0.5,
  currentThrust: 0,
  availableThrust: 6,
};

function point<T>(payload: T, quality: Quality): TimelinePoint<T> {
  return {
    validAt: 0,
    payload,
    meta: makeMeta({ validAt: 0, quality, source: "vessel:abc-123" }),
    epoch: 0,
  };
}

function getFrom(map: Record<string, TimelinePoint<unknown> | undefined>) {
  return derivedGetOf(map);
}

/** A coasting craft with a target: the frame the conic owns. */
function onRailsGet(): DerivedGet {
  return getFrom({
    "vessel.orbit": point(
      wrapWire<VesselOrbitPayload>("VesselOrbit", { ...COAST }),
      Quality.OnRails,
    ),
    "system.bodies": point(BODIES, Quality.OnRails),
    // The wrap follows the nested `orbit` too, the same way the decode does.
    "vessel.target": point(
      wrapWire<VesselTargetPayload>("VesselTarget", {
        kind: 0,
        relativePosition: { x: 1, y: 0, z: 0 },
        orbit: { ...TARGET_ORBIT },
      }),
      Quality.OnRails,
    ),
  });
}

/** A craft under physics on a descent: the frame the landing set owns. */
function descendingGet(): DerivedGet {
  return getFrom({
    "vessel.orbit": point(
      wrapWire<VesselOrbitPayload>("VesselOrbit", { ...LANDING_ORBIT }),
      Quality.Loaded,
    ),
    "vessel.flight": point(
      wrapWire<VesselFlightPayload>("VesselFlight", { ...DESCENT }),
      Quality.Loaded,
    ),
    "system.bodies": point(LANDING_BODIES, Quality.OnRails),
    "vessel.propulsion": point(PROPULSION, Quality.Loaded),
  });
}

function modelledPaths(get: DerivedGet, viewUt: number): string[] | undefined {
  return deriveVesselStateReckoning(get, viewUt)?.map((entry) => entry.path);
}

describe("the conic: deriveVesselStateReckoning", () => {
  it("claims the record root, so a whole-topic read of a dark craft is reckoned", () => {
    expect(modelledPaths(onRailsGet(), 600)).toContain("");
  });
});

describe("the ballistic landing set: deriveLanding", () => {
  it("produces its six scalars on a frame that offers no model at all", () => {
    const get = descendingGet();
    const state = deriveVesselState(get, 0);

    // Real numbers, off the wire at this instant: g = 2, h = 100, vDown = 10.
    expect(state?.landingTimeToImpact).toBeCloseTo(
      (-10 + Math.sqrt(500)) / 2,
      6,
    );
    expect(state?.landingSpeedAtImpact).toBeCloseTo(Math.sqrt(800), 6);
    expect(state?.landingSuicideBurnCountdown).not.toBeNull();

    /*
     * And the whole reason the set needs no model of its own: a craft under
     * physics is one `keplerAdmissibility` withdraws from, so this record
     * carries no reckoning for anything to carry the landing set forward on.
     * The six scalars are only ever the answer for the instant that produced
     * them.
     */
    expect(deriveVesselStateReckoning(get, 0)).toBeUndefined();
  });

  it("is null on the frame the conic DOES model, so the two never overlap", () => {
    const get = onRailsGet();

    expect(deriveVesselStateReckoning(get, 600)).toBeDefined();
    const state = deriveVesselState(get, 600);
    expect(state?.landingTimeToImpact).toBeNull();
    expect(state?.landingSpeedAtImpact).toBeNull();
    expect(state?.landingBestSpeedAtImpact).toBeNull();
    expect(state?.landingSuicideBurnCountdown).toBeNull();
    expect(state?.landingPredictedLat).toBeNull();
    expect(state?.landingPredictedLon).toBeNull();
  });

  it("claims no path, so a reckoned tail can never draw one of the six", () => {
    const paths = modelledPaths(onRailsGet(), 600) ?? [];
    expect(paths.filter((path) => path.startsWith("landing"))).toEqual([]);
  });
});

describe("the target's conic: deriveTargetOrbit", () => {
  it("solves the target at the view time on a record the self conic models", () => {
    const state = deriveVesselState(onRailsGet(), 600);

    expect(state?.targetPeriod).toBeCloseTo(
      2 * Math.PI * Math.sqrt(TARGET_ORBIT.sma ** 3 / MU_KERBIN),
      6,
    );
    expect(state?.targetTrueAnomaly).not.toBeNull();
    expect(state?.targetPeriapsisAlt).not.toBeNull();
  });

  it("claims no path, so the self craft's horizon never bounds the target's arc", () => {
    const paths = modelledPaths(onRailsGet(), 600) ?? [];
    expect(paths.filter((path) => path.startsWith("target"))).toEqual([]);
  });
});
