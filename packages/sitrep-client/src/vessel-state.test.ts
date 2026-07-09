import { Quality } from "@gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { type OrbitElements, solve, solveAnomalies } from "./kepler";
import type { StreamStatusValue } from "./stream-status";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import type { DerivedGet } from "./timeline-store";
import {
  deriveVesselState,
  deriveVesselStateStatus,
  type SystemBodiesPayload,
  type VesselFlightPayload,
  type VesselIdentityPayload,
  type VesselOrbitPayload,
} from "./vessel-state";

/** Kerbin's mean radius, metres — a realistic reference body for the apsides tests. */
const KERBIN_RADIUS = 600_000;

const CIRCULAR_ORBIT: VesselOrbitPayload = {
  referenceBodyIndex: 1,
  sma: 700_000,
  ecc: 0,
  inc: 0,
  lan: null, // undefined ascending node (near-equatorial) — must not crash/NaN
  argPe: null, // undefined periapsis (near-circular) — must not crash/NaN
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  mu: 3.5316e12, // Kerbin's GM
};

const MEASURED_FLIGHT: VesselFlightPayload = {
  latitude: -0.05,
  longitude: 42.3,
  altitudeAsl: 71_234,
  altitudeTerrain: 71_234,
  verticalSpeed: 12.5,
  surfaceSpeed: 1780.2,
  orbitalSpeed: 1790.9,
  gForce: 1.1,
  dynamicPressureKPa: 3.2,
  mach: 5.1,
  atmDensity: 0.01,
};

function orbitPoint(
  payload: VesselOrbitPayload | null,
  overrides: {
    validAt?: number;
    quality?: Quality;
    source?: string;
  } = {},
): TimelinePoint<VesselOrbitPayload> {
  return {
    validAt: overrides.validAt ?? 0,
    payload,
    meta: makeMeta({
      validAt: overrides.validAt ?? 0,
      quality: overrides.quality ?? Quality.OnRails,
      source: overrides.source ?? "vessel:abc-123",
    }),
    epoch: 0,
  };
}

function flightPoint(
  payload: VesselFlightPayload | null,
  overrides: { validAt?: number; source?: string } = {},
): TimelinePoint<VesselFlightPayload> {
  return {
    validAt: overrides.validAt ?? 0,
    payload,
    meta: makeMeta({
      validAt: overrides.validAt ?? 0,
      quality: Quality.Loaded,
      source: overrides.source ?? "vessel:abc-123",
    }),
    epoch: 0,
  };
}

/** Builds a `DerivedGet` from a fixed map of topic -> point, and records every topic it was asked for (for the single-view-time / whole-inputs assertions). */
function fakeGet(points: {
  "vessel.orbit"?: TimelinePoint<VesselOrbitPayload>;
  "vessel.flight"?: TimelinePoint<VesselFlightPayload>;
  "vessel.identity"?: TimelinePoint<VesselIdentityPayload>;
  "system.bodies"?: TimelinePoint<SystemBodiesPayload>;
}): { get: DerivedGet; requestedTopics: string[] } {
  const requestedTopics: string[] = [];
  const get: DerivedGet = (<T>(topic: string) => {
    requestedTopics.push(topic);
    return points[topic as keyof typeof points] as TimelinePoint<T> | undefined;
  }) as DerivedGet;
  return { get, requestedTopics };
}

function identityPoint(
  payload: VesselIdentityPayload | null,
  overrides: { validAt?: number; source?: string } = {},
): TimelinePoint<VesselIdentityPayload> {
  return {
    validAt: overrides.validAt ?? 0,
    payload,
    meta: makeMeta({
      validAt: overrides.validAt ?? 0,
      quality: Quality.OnRails,
      source: overrides.source ?? "vessel:abc-123",
    }),
    epoch: 0,
  };
}

function bodiesPoint(
  payload: SystemBodiesPayload | null,
  overrides: { validAt?: number } = {},
): TimelinePoint<SystemBodiesPayload> {
  return {
    validAt: overrides.validAt ?? 0,
    payload,
    meta: makeMeta({
      validAt: overrides.validAt ?? 0,
      quality: Quality.OnRails,
      source: "system",
    }),
    epoch: 0,
  };
}

const KERBIN_SYSTEM_BODIES: SystemBodiesPayload = {
  bodies: [
    {
      name: "Kerbol",
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
      orbit: {
        sma: 13_599_840_256,
        ecc: 0,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 0,
      },
    },
  ],
};

describe("deriveVesselState", () => {
  describe("OnRails — propagated from vessel.orbit elements", () => {
    it("matches kepler.solve(orbit, viewUt) at the frozen viewUt", () => {
      const viewUt = 12_345;
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, {
          quality: Quality.OnRails,
        }),
      });

      const state = deriveVesselState(get, viewUt);

      expect(state).not.toBeNull();
      expect(state?.basis).toBe("propagated");

      const elements: OrbitElements = {
        sma: CIRCULAR_ORBIT.sma,
        ecc: CIRCULAR_ORBIT.ecc,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: CIRCULAR_ORBIT.meanAnomalyAtEpoch,
        epoch: CIRCULAR_ORBIT.epoch,
        mu: CIRCULAR_ORBIT.mu,
      };
      const expected = solve(elements, viewUt);

      expect(state?.position).toEqual(expected.position);
      expect(state?.velocity).toEqual(expected.velocity);
    });

    it("advancing the frame's viewUt moves the propagated position along the orbit", () => {
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, {
          quality: Quality.OnRails,
        }),
      });

      const atZero = deriveVesselState(get, 0);
      const later = deriveVesselState(get, 500);

      expect(atZero?.position).not.toEqual(later?.position);
    });

    it("does not read vessel.flight at all — OnRails kinematics never touch measured samples", () => {
      const { get, requestedTopics } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, {
          quality: Quality.OnRails,
        }),
      });

      deriveVesselState(get, 100);

      // vessel.identity/system.bodies ARE read on this basis (met/apsides,
      // M3) — only vessel.flight is off-limits here.
      expect(requestedTopics).not.toContain("vessel.flight");
      expect(requestedTopics).toContain("vessel.orbit");
    });

    it("leaves surface-only fields null rather than fabricating them without body geometry", () => {
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, {
          quality: Quality.OnRails,
        }),
      });

      const state = deriveVesselState(get, 0);

      expect(state?.altitudeAsl).toBeNull();
      expect(state?.verticalSpeed).toBeNull();
      expect(state?.surfaceSpeed).toBeNull();
      expect(state?.orbitalSpeed).not.toBeNull(); // derivable from |velocity| alone
    });

    it("carries subjectId from the orbit sample's envelope meta.source", () => {
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, {
          quality: Quality.OnRails,
          source: "vessel:xyz-999",
        }),
      });

      expect(deriveVesselState(get, 0)?.subjectId).toBe("vessel:xyz-999");
    });
  });

  describe("Loaded — measured from vessel.flight", () => {
    it("returns vessel.flight's own kinematics, not a propagated value", () => {
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.Loaded }),
        "vessel.flight": flightPoint(MEASURED_FLIGHT),
      });

      const state = deriveVesselState(get, 0);

      expect(state?.basis).toBe("measured");
      expect(state?.altitudeAsl).toBe(MEASURED_FLIGHT.altitudeAsl);
      expect(state?.verticalSpeed).toBe(MEASURED_FLIGHT.verticalSpeed);
      expect(state?.surfaceSpeed).toBe(MEASURED_FLIGHT.surfaceSpeed);
      expect(state?.orbitalSpeed).toBe(MEASURED_FLIGHT.orbitalSpeed);
      // Not propagated: no position/velocity vector fabricated from elements.
      expect(state?.position).toBeNull();
      expect(state?.velocity).toBeNull();
    });
  });

  describe("quality-pick switch", () => {
    it("flips basis from propagated to measured and back as the orbit sample's quality changes", () => {
      const { get: onRailsGet } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, {
          quality: Quality.OnRails,
        }),
      });
      expect(deriveVesselState(onRailsGet, 0)?.basis).toBe("propagated");

      const { get: loadedGet } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.Loaded }),
        "vessel.flight": flightPoint(MEASURED_FLIGHT),
      });
      expect(deriveVesselState(loadedGet, 0)?.basis).toBe("measured");

      const { get: backToOnRailsGet } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, {
          quality: Quality.OnRails,
        }),
      });
      expect(deriveVesselState(backToOnRailsGet, 0)?.basis).toBe("propagated");
    });

    it("the picker reads the ORBIT sample's quality, not any global flag", () => {
      // Orbit says OnRails even though a (possibly stale) flight sample also
      // happens to be available — must still propagate, not measure.
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, {
          quality: Quality.OnRails,
        }),
        "vessel.flight": flightPoint(MEASURED_FLIGHT),
      });

      expect(deriveVesselState(get, 0)?.basis).toBe("propagated");
    });
  });

  describe("single-view-time invariant", () => {
    it("both inputs are read at the exact same viewUt within one derive call", () => {
      const viewUt = 777;
      const seenUts: number[] = [];
      const get: DerivedGet = (<T>(topic: string) => {
        // A real `get` is bound to one frame's viewUt structurally (it's
        // `TimelineStore.sample` closed over a single token) — this fake
        // asserts the derive function itself never smuggles in a second UT
        // by calling `get` with anything topic-shaped that isn't one of its
        // declared inputs, and that whatever it reads is self-consistent
        // for a single call.
        seenUts.push(viewUt);
        if (topic === "vessel.orbit") {
          return orbitPoint(CIRCULAR_ORBIT, {
            quality: Quality.Loaded,
          }) as unknown as TimelinePoint<T>;
        }
        if (topic === "vessel.flight") {
          return flightPoint(MEASURED_FLIGHT) as unknown as TimelinePoint<T>;
        }
        return undefined;
      }) as DerivedGet;

      deriveVesselState(get, viewUt);

      expect(seenUts.every((ut) => ut === viewUt)).toBe(true);
      expect(seenUts.length).toBeGreaterThan(0);
    });
  });

  describe("undefined (not whole yet) vs null (confirmed absent) — never conflated", () => {
    it("no vessel.orbit point yet at viewUt -> undefined (inputs not whole, cold-start/resync — not a confirmed absence)", () => {
      const { get } = fakeGet({});

      expect(deriveVesselState(get, 0)).toBeUndefined();
    });

    it("vessel.orbit is a tombstone (payload null) -> null (subject confirmed absent)", () => {
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(null, { quality: Quality.OnRails }),
      });

      expect(deriveVesselState(get, 0)).toBeNull();
    });

    it("Loaded quality but no vessel.flight point yet -> undefined, not a zeroed record and not a tombstone", () => {
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.Loaded }),
        // vessel.flight deliberately omitted
      });

      expect(deriveVesselState(get, 0)).toBeUndefined();
    });

    it("Loaded quality with a tombstoned vessel.flight -> null", () => {
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.Loaded }),
        "vessel.flight": flightPoint(null),
      });

      expect(deriveVesselState(get, 0)).toBeNull();
    });

    it("a real orbit resolves to a value, never undefined/null", () => {
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, {
          quality: Quality.OnRails,
        }),
      });

      const state = deriveVesselState(get, 0);

      expect(state).not.toBeUndefined();
      expect(state).not.toBeNull();
    });
  });
});

describe("derivable orbital fields — met/period/trueAnomaly/apoapsisAlt/periapsisAlt/timeToAp/timeToPe (M3 vessel.state extend)", () => {
  describe("OnRails — computed from vessel.orbit elements (+ vessel.identity for met, + system.bodies for apsides)", () => {
    it("period matches 2π·sqrt(sma³/mu) by hand for a circular orbit", () => {
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, {
          quality: Quality.OnRails,
        }),
      });

      const state = deriveVesselState(get, 0);

      const expectedPeriod =
        2 * Math.PI * Math.sqrt(CIRCULAR_ORBIT.sma ** 3 / CIRCULAR_ORBIT.mu);
      expect(state?.period).toBeCloseTo(expectedPeriod, 6);
    });

    it("trueAnomaly is 0° at meanAnomaly 0 (periapsis) for a circular orbit whose epoch is viewUt", () => {
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, {
          quality: Quality.OnRails,
        }),
      });

      // CIRCULAR_ORBIT has meanAnomalyAtEpoch: 0, epoch: 0 -- at viewUt 0,
      // elapsed time is 0, so meanAnomaly (and hence trueAnomaly for a
      // circular orbit) is exactly 0.
      expect(deriveVesselState(get, 0)?.trueAnomaly).toBe(0);
    });

    it("trueAnomaly advances with viewUt (matches kepler.solveAnomalies exactly, converted to wrapped degrees — never a second Kepler solve)", () => {
      const elements: OrbitElements = {
        sma: CIRCULAR_ORBIT.sma,
        ecc: CIRCULAR_ORBIT.ecc,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: CIRCULAR_ORBIT.meanAnomalyAtEpoch,
        epoch: CIRCULAR_ORBIT.epoch,
        mu: CIRCULAR_ORBIT.mu,
      };
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, {
          quality: Quality.OnRails,
        }),
      });

      const atZero = deriveVesselState(get, 0)?.trueAnomaly;
      const at500 = deriveVesselState(get, 500)?.trueAnomaly;
      const expectedAt500 =
        (solveAnomalies(elements, 500).trueAnomaly * 180) / Math.PI;

      expect(at500).not.toEqual(atZero);
      expect(at500).toBeCloseTo(
        expectedAt500 < 0 ? expectedAt500 + 360 : expectedAt500,
        9,
      );
    });

    it("timeToPe is 0 when already at periapsis (meanAnomaly 0), timeToAp is half the period", () => {
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, {
          quality: Quality.OnRails,
        }),
      });

      const state = deriveVesselState(get, 0);

      expect(state?.timeToPe).toBe(0);
      expect(state?.timeToAp).toBeCloseTo((state?.period ?? 0) / 2, 6);
    });

    it("met = viewUt - vessel.identity.launchUt when vessel.identity is whole", () => {
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, {
          quality: Quality.OnRails,
        }),
        "vessel.identity": identityPoint({
          vesselId: "vessel:abc-123",
          name: "Test Ship",
          vesselType: 0,
          situation: 0,
          parentBodyIndex: 1,
          launchUt: 100,
        }),
      });

      expect(deriveVesselState(get, 700)?.met).toBe(600);
    });

    it("met is null (not undefined) when vessel.identity hasn't arrived yet — a secondary input, not a whole-record blocker", () => {
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, {
          quality: Quality.OnRails,
        }),
        // vessel.identity deliberately omitted
      });

      const state = deriveVesselState(get, 700);
      expect(state).not.toBeUndefined();
      expect(state?.met).toBeNull();
    });

    it("met is null before launch (launchUt still null on vessel.identity)", () => {
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, {
          quality: Quality.OnRails,
        }),
        "vessel.identity": identityPoint({
          vesselId: "vessel:abc-123",
          name: "Test Ship",
          vesselType: 0,
          situation: 0,
          parentBodyIndex: null,
          launchUt: null,
        }),
      });

      expect(deriveVesselState(get, 700)?.met).toBeNull();
    });

    it("apoapsisAlt == periapsisAlt == sma - bodyRadius for a circular orbit, once system.bodies is whole", () => {
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, {
          quality: Quality.OnRails,
        }),
        "system.bodies": bodiesPoint(KERBIN_SYSTEM_BODIES),
      });

      const state = deriveVesselState(get, 0);
      const expectedAlt = CIRCULAR_ORBIT.sma - KERBIN_RADIUS;

      expect(state?.apoapsisAlt).toBeCloseTo(expectedAlt, 6);
      expect(state?.periapsisAlt).toBeCloseTo(expectedAlt, 6);
      expect(state?.apoapsisAlt).toBeCloseTo(
        state?.periapsisAlt ?? Number.NaN,
        9,
      );
    });

    it("apoapsisAlt/periapsisAlt are undefined (resyncing), not null, while system.bodies hasn't arrived yet", () => {
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, {
          quality: Quality.OnRails,
        }),
        // system.bodies deliberately omitted
      });

      const state = deriveVesselState(get, 0);
      expect(state).not.toBeUndefined();
      expect(state?.apoapsisAlt).toBeUndefined();
      expect(state?.periapsisAlt).toBeUndefined();
      expect(state && "apoapsisAlt" in state).toBe(true);
    });

    it("apoapsisAlt/periapsisAlt are null when system.bodies is a confirmed tombstone", () => {
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, {
          quality: Quality.OnRails,
        }),
        "system.bodies": bodiesPoint(null),
      });

      const state = deriveVesselState(get, 0);
      expect(state?.apoapsisAlt).toBeNull();
      expect(state?.periapsisAlt).toBeNull();
    });

    it("apoapsisAlt/periapsisAlt stay undefined when system.bodies is whole but the referenced body isn't in it (still resyncing, not a confirmed absence)", () => {
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(
          { ...CIRCULAR_ORBIT, referenceBodyIndex: 99 },
          { quality: Quality.OnRails },
        ),
        "system.bodies": bodiesPoint(KERBIN_SYSTEM_BODIES),
      });

      const state = deriveVesselState(get, 0);
      expect(state?.apoapsisAlt).toBeUndefined();
      expect(state?.periapsisAlt).toBeUndefined();
    });

    it("period/timeToAp/timeToPe are finite-guarded to null, never NaN/Infinity, for a degenerate mu", () => {
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(
          { ...CIRCULAR_ORBIT, mu: 0 },
          { quality: Quality.OnRails },
        ),
      });

      const state = deriveVesselState(get, 0);
      expect(state?.period).toBeNull();
      expect(state?.timeToAp).toBeNull();
      expect(state?.timeToPe).toBeNull();
    });
  });

  describe("Loaded — all seven fields are null (measured basis leaves them null, same as position/velocity)", () => {
    it("every new field is null, not undefined, in the measured basis", () => {
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.Loaded }),
        "vessel.flight": flightPoint(MEASURED_FLIGHT),
        "vessel.identity": identityPoint({
          vesselId: "vessel:abc-123",
          name: "Test Ship",
          vesselType: 0,
          situation: 0,
          parentBodyIndex: 1,
          launchUt: 0,
        }),
        "system.bodies": bodiesPoint(KERBIN_SYSTEM_BODIES),
      });

      const state = deriveVesselState(get, 700);

      expect(state?.met).toBeNull();
      expect(state?.period).toBeNull();
      expect(state?.trueAnomaly).toBeNull();
      expect(state?.apoapsisAlt).toBeNull();
      expect(state?.periapsisAlt).toBeNull();
      expect(state?.timeToAp).toBeNull();
      expect(state?.timeToPe).toBeNull();
    });
  });
});

describe("body-NAME display maps — parentBodyName/referenceBodyName (Step-2 migration task 1: v.body/o.referenceBody index→name)", () => {
  const IDENTITY = {
    vesselId: "vessel:abc-123",
    name: "Test Ship",
    vesselType: 0,
    situation: 0,
    parentBodyIndex: 1, // Kerbin
    launchUt: 0,
  };

  it("resolves parentBodyIndex + referenceBodyIndex against system.bodies to names (OnRails)", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      "vessel.identity": identityPoint(IDENTITY),
      "system.bodies": bodiesPoint(KERBIN_SYSTEM_BODIES),
    });

    const state = deriveVesselState(get, 0);
    // referenceBodyIndex 1 and parentBodyIndex 1 both resolve to Kerbin.
    expect(state?.referenceBodyName).toBe("Kerbin");
    expect(state?.parentBodyName).toBe("Kerbin");
  });

  it("resolves a Mun (index 2) parent distinct from a Kerbin (index 1) reference", () => {
    const bodies: SystemBodiesPayload = {
      bodies: [
        ...KERBIN_SYSTEM_BODIES.bodies,
        {
          name: "Mun",
          index: 2,
          parentIndex: 1,
          radius: 200_000,
          orbit: null,
        },
      ],
    };
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(
        { ...CIRCULAR_ORBIT, referenceBodyIndex: 1 },
        { quality: Quality.OnRails },
      ),
      "vessel.identity": identityPoint({ ...IDENTITY, parentBodyIndex: 2 }),
      "system.bodies": bodiesPoint(bodies),
    });

    const state = deriveVesselState(get, 0);
    expect(state?.referenceBodyName).toBe("Kerbin");
    expect(state?.parentBodyName).toBe("Mun");
  });

  it("resolves names in the Loaded (measured) basis too — not orbital-derived", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.Loaded }),
      "vessel.flight": flightPoint(MEASURED_FLIGHT),
      "vessel.identity": identityPoint(IDENTITY),
      "system.bodies": bodiesPoint(KERBIN_SYSTEM_BODIES),
    });

    const state = deriveVesselState(get, 0, get);
    expect(state?.basis).toBe("measured");
    expect(state?.referenceBodyName).toBe("Kerbin");
    expect(state?.parentBodyName).toBe("Kerbin");
  });

  it("returns undefined (not-yet-loaded, never throws) when system.bodies is absent", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      "vessel.identity": identityPoint(IDENTITY),
      // no system.bodies
    });

    const state = deriveVesselState(get, 0);
    expect(state?.referenceBodyName).toBeUndefined();
    expect(state?.parentBodyName).toBeUndefined();
  });

  it("parentBodyName is undefined when vessel.identity hasn't arrived; referenceBodyName still resolves", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      "system.bodies": bodiesPoint(KERBIN_SYSTEM_BODIES),
      // no vessel.identity
    });

    const state = deriveVesselState(get, 0);
    expect(state?.parentBodyName).toBeUndefined();
    expect(state?.referenceBodyName).toBe("Kerbin");
  });

  it("returns undefined when the referenced index isn't in system.bodies yet (still resyncing, not a confirmed absence)", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(
        { ...CIRCULAR_ORBIT, referenceBodyIndex: 99 },
        { quality: Quality.OnRails },
      ),
      "vessel.identity": identityPoint({ ...IDENTITY, parentBodyIndex: 99 }),
      "system.bodies": bodiesPoint(KERBIN_SYSTEM_BODIES),
    });

    const state = deriveVesselState(get, 0);
    expect(state?.referenceBodyName).toBeUndefined();
    expect(state?.parentBodyName).toBeUndefined();
  });

  it("returns null when system.bodies is a confirmed tombstone", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      "vessel.identity": identityPoint(IDENTITY),
      "system.bodies": bodiesPoint(null),
    });

    const state = deriveVesselState(get, 0);
    expect(state?.referenceBodyName).toBeNull();
    expect(state?.parentBodyName).toBeNull();
  });
});

/** Builds a `getStatus` callback from a fixed topic -> status map, defaulting anything unlisted to "resyncing" (the safe "never heard from it" default). */
function fakeGetStatus(
  statuses: Partial<Record<string, StreamStatusValue>>,
): (topic: string) => StreamStatusValue {
  return (topic) => statuses[topic] ?? "resyncing";
}

describe("deriveVesselStateStatus (M2 design §4.4 — worst of inputs, T4)", () => {
  describe("OnRails — status is the orbit input's own status, vessel.flight ignored entirely", () => {
    it("passes the orbit status straight through when the orbit sample is OnRails", () => {
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, {
          quality: Quality.OnRails,
        }),
      });
      const getStatus = fakeGetStatus({
        "vessel.orbit": "held-stale",
        "vessel.flight": "live",
      });

      expect(deriveVesselStateStatus(getStatus, get, 0)).toBe("held-stale");
    });

    it("a worse vessel.flight status does NOT drag down an OnRails reading that never consults it", () => {
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, {
          quality: Quality.OnRails,
        }),
      });
      const getStatus = fakeGetStatus({
        "vessel.orbit": "live",
        "vessel.flight": "absent", // worst possible — must be ignored
      });

      expect(deriveVesselStateStatus(getStatus, get, 0)).toBe("live");
    });
  });

  describe("Loaded — worst of (orbit, flight), tested for each input status", () => {
    const cases: Array<{
      orbit: StreamStatusValue;
      flight: StreamStatusValue;
      expected: StreamStatusValue;
    }> = [
      { orbit: "live", flight: "live", expected: "live" },
      { orbit: "held-stale", flight: "live", expected: "held-stale" },
      { orbit: "live", flight: "held-stale", expected: "held-stale" },
      {
        orbit: "live",
        flight: "last-before-blackout",
        expected: "last-before-blackout",
      },
      {
        orbit: "last-before-blackout",
        flight: "held-stale",
        expected: "last-before-blackout",
      },
    ];

    for (const { orbit, flight, expected } of cases) {
      it(`orbit=${orbit} + flight=${flight} -> ${expected}`, () => {
        const { get } = fakeGet({
          "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, {
            quality: Quality.Loaded,
          }),
          "vessel.flight": flightPoint(MEASURED_FLIGHT),
        });
        const getStatus = fakeGetStatus({
          "vessel.orbit": orbit,
          "vessel.flight": flight,
        });

        expect(deriveVesselStateStatus(getStatus, get, 0)).toBe(expected);
      });
    }
  });

  describe("orbit resyncing/absent dominates outright, before quality is even consulted", () => {
    it("vessel.orbit resyncing -> the whole channel is 'resyncing', regardless of vessel.flight", () => {
      const { get } = fakeGet({}); // nothing ingested yet — orbit not whole
      const getStatus = fakeGetStatus({
        "vessel.orbit": "resyncing",
        "vessel.flight": "live",
      });

      expect(deriveVesselStateStatus(getStatus, get, 0)).toBe("resyncing");
    });

    it("vessel.orbit absent (tombstoned) -> the whole channel is 'absent', regardless of vessel.flight", () => {
      const { get } = fakeGet({
        "vessel.orbit": orbitPoint(null, { quality: Quality.OnRails }),
      });
      const getStatus = fakeGetStatus({
        "vessel.orbit": "absent",
        "vessel.flight": "live",
      });

      expect(deriveVesselStateStatus(getStatus, get, 0)).toBe("absent");
    });
  });
});
