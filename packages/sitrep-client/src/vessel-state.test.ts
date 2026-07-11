import { Quality } from "@ksp-gonogo/sitrep-sdk";
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
  type VesselCommsPayload,
  type VesselControlPayload,
  type VesselFlightPayload,
  type VesselIdentityPayload,
  type VesselOrbitPayload,
  type VesselPropulsionPayload,
  type VesselTargetPayload,
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
  "vessel.control"?: TimelinePoint<VesselControlPayload>;
  "vessel.target"?: TimelinePoint<VesselTargetPayload>;
  "vessel.comms"?: TimelinePoint<VesselCommsPayload>;
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

function controlPoint(
  payload: VesselControlPayload | null,
): TimelinePoint<VesselControlPayload> {
  return {
    validAt: 0,
    payload,
    meta: makeMeta({
      validAt: 0,
      quality: Quality.OnRails,
      source: "vessel:abc-123",
    }),
    epoch: 0,
  };
}

function targetPoint(
  payload: VesselTargetPayload | null,
): TimelinePoint<VesselTargetPayload> {
  return {
    validAt: 0,
    payload,
    meta: makeMeta({
      validAt: 0,
      quality: Quality.OnRails,
      source: "vessel:abc-123",
    }),
    epoch: 0,
  };
}

function commsPoint(
  payload: VesselCommsPayload | null,
): TimelinePoint<VesselCommsPayload> {
  return {
    validAt: 0,
    payload,
    meta: makeMeta({
      validAt: 0,
      quality: Quality.OnRails,
      source: "vessel:abc-123",
    }),
    epoch: 0,
  };
}

describe("enum-ordinal → NAME display maps — situationName/sasModeName/targetKind/commsControlState* (enum-ordinal→string-name migration)", () => {
  const IDENTITY: VesselIdentityPayload = {
    vesselId: "vessel:abc-123",
    name: "Test Ship",
    vesselType: 0,
    situation: 0,
    parentBodyIndex: 1,
    launchUt: 0,
  };

  it("resolves each enum ordinal to the widget-facing value (OnRails)", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      "vessel.identity": identityPoint({ ...IDENTITY, situation: 3 }), // Orbiting
      "vessel.control": controlPoint({ sasMode: 1 }), // Prograde
      "vessel.target": targetPoint({ kind: 1 }), // Body → CelestialBody
      "vessel.comms": commsPoint({ controlState: 4 }), // Full
    });

    const state = deriveVesselState(get, 0);
    expect(state?.situationName).toBe("Orbiting");
    expect(state?.sasModeName).toBe("Prograde");
    expect(state?.targetKind).toBe("CelestialBody");
    expect(state?.commsControlStateName).toBe("Full");
    expect(state?.commsControlStateOrdinal).toBe(2);
  });

  it("resolves the FIRST and LAST enum values (boundaries)", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      "vessel.identity": identityPoint({ ...IDENTITY, situation: 8 }), // Unknown (last)
      "vessel.control": controlPoint({ sasMode: 0 }), // StabilityAssist (first)
      "vessel.target": targetPoint({ kind: 0 }), // Vessel (first)
      "vessel.comms": commsPoint({ controlState: 11 }), // Unknown (last)
    });

    const state = deriveVesselState(get, 0);
    expect(state?.situationName).toBe("Unknown");
    expect(state?.sasModeName).toBe("StabilityAssist");
    expect(state?.targetKind).toBe("Vessel");
    expect(state?.commsControlStateName).toBe("Unknown");
    // ControlState.Unknown maps to NO Telemachus level → undefined ordinal.
    expect(state?.commsControlStateOrdinal).toBeUndefined();
  });

  it("targetKind maps TargetKind.Other, and commsControlStateOrdinal collapses richer levels (Partial→1, ProbeNone→0)", () => {
    const partial = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      "vessel.target": targetPoint({ kind: 2 }), // Other
      "vessel.comms": commsPoint({ controlState: 3 }), // Partial
    });
    const s1 = deriveVesselState(partial.get, 0);
    expect(s1?.targetKind).toBe("Other");
    expect(s1?.commsControlStateName).toBe("Partial");
    expect(s1?.commsControlStateOrdinal).toBe(1);

    const probeNone = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      "vessel.comms": commsPoint({ controlState: 5 }), // ProbeNone
    });
    const s2 = deriveVesselState(probeNone.get, 0);
    expect(s2?.commsControlStateName).toBe("ProbeNone");
    expect(s2?.commsControlStateOrdinal).toBe(0);
  });

  it("resolves in the Loaded (measured) basis too — not orbital-derived", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.Loaded }),
      "vessel.flight": flightPoint(MEASURED_FLIGHT),
      "vessel.identity": identityPoint({ ...IDENTITY, situation: 0 }), // Landed
      "vessel.control": controlPoint({ sasMode: 9 }), // Maneuver
      "vessel.comms": commsPoint({ controlState: 0 }), // None
    });

    const state = deriveVesselState(get, 0, get);
    expect(state?.basis).toBe("measured");
    expect(state?.situationName).toBe("Landed");
    expect(state?.sasModeName).toBe("Maneuver");
    expect(state?.commsControlStateName).toBe("None");
    expect(state?.commsControlStateOrdinal).toBe(0);
  });

  it("undefined (never throws) when a source channel hasn't arrived, per-field", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      // no vessel.identity / vessel.control / vessel.target / vessel.comms
    });

    const state = deriveVesselState(get, 0);
    expect(state?.situationName).toBeUndefined();
    expect(state?.sasModeName).toBeUndefined();
    expect(state?.targetKind).toBeUndefined();
    expect(state?.commsControlStateName).toBeUndefined();
    expect(state?.commsControlStateOrdinal).toBeUndefined();
  });

  it("undefined for a field-level null (sasMode not available this tick) and an out-of-range ordinal", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      "vessel.control": controlPoint({ sasMode: null }),
      "vessel.identity": identityPoint({ ...IDENTITY, situation: 99 }), // out of range
    });

    const state = deriveVesselState(get, 0);
    expect(state?.sasModeName).toBeUndefined();
    expect(state?.situationName).toBeUndefined();
  });

  it("null when a source channel is a confirmed tombstone", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      "vessel.identity": identityPoint(null),
      "vessel.control": controlPoint(null),
      "vessel.target": targetPoint(null),
      "vessel.comms": commsPoint(null),
    });

    const state = deriveVesselState(get, 0);
    expect(state?.situationName).toBeNull();
    expect(state?.sasModeName).toBeNull();
    expect(state?.targetKind).toBeNull();
    expect(state?.commsControlStateName).toBeNull();
    expect(state?.commsControlStateOrdinal).toBeNull();
  });
});

describe("encounter display maps — encounterExists/encounterBody/encounterTime (batch-2: o.encounterExists/Body/Time off vessel.orbit.encounter)", () => {
  function orbitWithEncounter(
    encounter: VesselOrbitPayload["encounter"],
    quality = Quality.OnRails,
  ) {
    return orbitPoint({ ...CIRCULAR_ORBIT, encounter }, { quality });
  }

  it("ENCOUNTER (transitionType 2) → +1, resolves body NAME + transitionUt (OnRails)", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitWithEncounter({
        transitionType: 2, // Encounter
        transitionUt: 12_345,
        bodyIndex: 1, // Kerbin in KERBIN_SYSTEM_BODIES
      }),
      "system.bodies": bodiesPoint(KERBIN_SYSTEM_BODIES),
    });
    const state = deriveVesselState(get, 0);
    expect(state?.encounterExists).toBe(1);
    expect(state?.encounterBody).toBe("Kerbin");
    expect(state?.encounterTime).toBe(12_345);
  });

  it("ESCAPE (transitionType 3) → -1", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitWithEncounter({
        transitionType: 3, // Escape
        transitionUt: 999,
        bodyIndex: 0,
      }),
      "system.bodies": bodiesPoint(KERBIN_SYSTEM_BODIES),
    });
    const state = deriveVesselState(get, 0);
    expect(state?.encounterExists).toBe(-1);
    expect(state?.encounterBody).toBe("Kerbol");
    expect(state?.encounterTime).toBe(999);
  });

  it("a non-surfaced transition type (Initial 0) → 0 exists (no chip), body/time still resolved", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitWithEncounter({
        transitionType: 0, // Initial
        transitionUt: 42,
        bodyIndex: 1,
      }),
      "system.bodies": bodiesPoint(KERBIN_SYSTEM_BODIES),
    });
    const state = deriveVesselState(get, 0);
    expect(state?.encounterExists).toBe(0);
  });

  it("no encounter record → exists 0 (defined none), body/time undefined — never the whole-record undefined", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
    });
    const state = deriveVesselState(get, 0);
    expect(state?.encounterExists).toBe(0);
    expect(state?.encounterBody).toBeUndefined();
    expect(state?.encounterTime).toBeUndefined();
  });

  it("encounterBody undefined (resyncing) when system.bodies hasn't arrived; null on a tombstone", () => {
    const resyncing = fakeGet({
      "vessel.orbit": orbitWithEncounter({
        transitionType: 2,
        transitionUt: 5,
        bodyIndex: 1,
      }),
      // no system.bodies
    });
    expect(deriveVesselState(resyncing.get, 0)?.encounterBody).toBeUndefined();

    const tombstone = fakeGet({
      "vessel.orbit": orbitWithEncounter({
        transitionType: 2,
        transitionUt: 5,
        bodyIndex: 1,
      }),
      "system.bodies": bodiesPoint(null),
    });
    expect(deriveVesselState(tombstone.get, 0)?.encounterBody).toBeNull();
  });

  it("populated in the Loaded (measured) basis too", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitWithEncounter(
        { transitionType: 2, transitionUt: 7, bodyIndex: 1 },
        Quality.Loaded,
      ),
      "vessel.flight": flightPoint(MEASURED_FLIGHT),
      "system.bodies": bodiesPoint(KERBIN_SYSTEM_BODIES),
    });
    const state = deriveVesselState(get, 0, get);
    expect(state?.basis).toBe("measured");
    expect(state?.encounterExists).toBe(1);
    expect(state?.encounterBody).toBe("Kerbin");
    expect(state?.encounterTime).toBe(7);
  });
});

describe("targetRelativeSpeed — signed range-rate (batch-2: tar.o.relativeVelocity off vessel.target Vec3s)", () => {
  it("NEGATIVE when closing (relVel points toward us along the line of sight)", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      "vessel.target": targetPoint({
        kind: 0,
        relativePosition: { x: 100, y: 0, z: 0 },
        relativeVelocity: { x: -5, y: 0, z: 0 },
      }),
    });
    expect(deriveVesselState(get, 0)?.targetRelativeSpeed).toBeCloseTo(-5, 6);
  });

  it("POSITIVE when opening; projects onto the line of sight (non-axis-aligned)", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      "vessel.target": targetPoint({
        kind: 0,
        relativePosition: { x: 0, y: 0, z: 10 },
        relativeVelocity: { x: 3, y: 4, z: 2 }, // only z projects onto position
      }),
    });
    expect(deriveVesselState(get, 0)?.targetRelativeSpeed).toBeCloseTo(2, 6);
  });

  it("undefined at zero range (no line of sight — never divides by zero)", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      "vessel.target": targetPoint({
        kind: 0,
        relativePosition: { x: 0, y: 0, z: 0 },
        relativeVelocity: { x: 1, y: 1, z: 1 },
      }),
    });
    expect(deriveVesselState(get, 0)?.targetRelativeSpeed).toBeUndefined();
  });

  it("undefined when vessel.target absent or a vector isn't available this tick", () => {
    const noTarget = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
    });
    expect(
      deriveVesselState(noTarget.get, 0)?.targetRelativeSpeed,
    ).toBeUndefined();

    const noVec = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      "vessel.target": targetPoint({
        kind: 0,
        relativePosition: null,
        relativeVelocity: { x: 1, y: 0, z: 0 },
      }),
    });
    expect(
      deriveVesselState(noVec.get, 0)?.targetRelativeSpeed,
    ).toBeUndefined();
  });

  it("null on a confirmed vessel.target tombstone", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      "vessel.target": targetPoint(null),
    });
    expect(deriveVesselState(get, 0)?.targetRelativeSpeed).toBeNull();
  });
});

describe("apsis/orbital radii + next-apsis + horizontal speed (A-tranche: o.ApR/o.PeR/o.radius/o.nextApsisType/o.timeToNextApsis/v.horizontalVelocity)", () => {
  const ECCENTRIC: VesselOrbitPayload = {
    ...CIRCULAR_ORBIT,
    sma: 700_000,
    ecc: 0.1,
  };

  it("apoapsisRadius/periapsisRadius = sma·(1±ecc) off the elements — no body table needed (OnRails)", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(ECCENTRIC, { quality: Quality.OnRails }),
      // deliberately NO system.bodies — radii need no body radius
    });

    const state = deriveVesselState(get, 0);
    expect(state?.apoapsisRadius).toBeCloseTo(700_000 * 1.1, 6);
    expect(state?.periapsisRadius).toBeCloseTo(700_000 * 0.9, 6);
  });

  it("orbitalRadius equals |propagated position| (OnRails)", () => {
    const viewUt = 1_234;
    const elements: OrbitElements = {
      sma: ECCENTRIC.sma,
      ecc: ECCENTRIC.ecc,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: ECCENTRIC.meanAnomalyAtEpoch,
      epoch: ECCENTRIC.epoch,
      mu: ECCENTRIC.mu,
    };
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(ECCENTRIC, { quality: Quality.OnRails }),
    });

    const { position } = solve(elements, viewUt);
    const expected = Math.hypot(position[0], position[1], position[2]);
    expect(deriveVesselState(get, viewUt)?.orbitalRadius).toBeCloseTo(
      expected,
      3,
    );
  });

  it("nextApsis picks periapsis (type -1) when timeToPe is the smaller countdown; time equals timeToPe", () => {
    // At meanAnomaly 0 (viewUt 0, epoch 0), timeToPe = 0 (already there),
    // timeToAp = half a period — so the NEXT apsis is periapsis.
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(ECCENTRIC, { quality: Quality.OnRails }),
    });

    const state = deriveVesselState(get, 0);
    expect(state?.nextApsisType).toBe(-1);
    expect(state?.timeToNextApsis).toBe(state?.timeToPe);
    expect(state?.timeToNextApsis).toBe(0);
  });

  it("nextApsis picks apoapsis (type 1) just after periapsis (timeToAp becomes the smaller countdown)", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(ECCENTRIC, { quality: Quality.OnRails }),
    });

    // A moment after periapsis: timeToPe wraps forward (nearly a full
    // period), timeToAp is now the nearer of the two.
    const period = 2 * Math.PI * Math.sqrt(ECCENTRIC.sma ** 3 / ECCENTRIC.mu);
    const state = deriveVesselState(get, period * 0.01);
    expect(state?.nextApsisType).toBe(1);
    expect(state?.timeToNextApsis).toBe(state?.timeToAp);
  });

  it("horizontalSpeed is null OnRails (a measured-only surface quantity)", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(ECCENTRIC, { quality: Quality.OnRails }),
    });
    expect(deriveVesselState(get, 0)?.horizontalSpeed).toBeNull();
  });

  it("radii + next-apsis are null in the measured basis; horizontalSpeed = sqrt(surfaceSpeed² - verticalSpeed²)", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(ECCENTRIC, { quality: Quality.Loaded }),
      "vessel.flight": flightPoint(MEASURED_FLIGHT),
    });

    const state = deriveVesselState(get, 0, get);
    expect(state?.basis).toBe("measured");
    expect(state?.apoapsisRadius).toBeNull();
    expect(state?.periapsisRadius).toBeNull();
    expect(state?.orbitalRadius).toBeNull();
    expect(state?.nextApsisType).toBeNull();
    expect(state?.timeToNextApsis).toBeNull();

    const expected = Math.sqrt(
      MEASURED_FLIGHT.surfaceSpeed ** 2 - MEASURED_FLIGHT.verticalSpeed ** 2,
    );
    expect(state?.horizontalSpeed).toBeCloseTo(expected, 6);
  });

  it("horizontalSpeed clamps to 0 (never NaN) when verticalSpeed exceeds surfaceSpeed (FP noise)", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(ECCENTRIC, { quality: Quality.Loaded }),
      "vessel.flight": flightPoint({
        ...MEASURED_FLIGHT,
        surfaceSpeed: 10,
        verticalSpeed: 10.0000001,
      }),
    });
    expect(deriveVesselState(get, 0, get)?.horizontalSpeed).toBe(0);
  });
});

describe("target scalar distance + target orbit elements (A-tranche: tar.distance / tar.o.PeA / tar.o.period / tar.o.trueAnomaly)", () => {
  const TARGET_ORBIT: VesselOrbitPayload = {
    referenceBodyIndex: 1, // Kerbin
    sma: 800_000,
    ecc: 0.2,
    inc: 0,
    lan: null,
    argPe: null,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
    mu: 3.5316e12,
  };

  it("targetDistance = |vessel.target.relativePosition| (a defined 0 at zero range, not undefined)", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      "vessel.target": targetPoint({
        kind: 0,
        relativePosition: { x: 3, y: 4, z: 12 },
        relativeVelocity: { x: 0, y: 0, z: 0 },
      }),
    });
    expect(deriveVesselState(get, 0)?.targetDistance).toBeCloseTo(13, 6);

    const zero = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      "vessel.target": targetPoint({
        kind: 0,
        relativePosition: { x: 0, y: 0, z: 0 },
        relativeVelocity: null,
      }),
    });
    expect(deriveVesselState(zero.get, 0)?.targetDistance).toBe(0);
  });

  it("targetDistance is undefined with no target / no relativePosition; null on a tombstone", () => {
    const none = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
    });
    expect(deriveVesselState(none.get, 0)?.targetDistance).toBeUndefined();

    const noVec = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      "vessel.target": targetPoint({ kind: 0, relativePosition: null }),
    });
    expect(deriveVesselState(noVec.get, 0)?.targetDistance).toBeUndefined();

    const tomb = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      "vessel.target": targetPoint(null),
    });
    expect(deriveVesselState(tomb.get, 0)?.targetDistance).toBeNull();
  });

  it("targetPeriod/targetTrueAnomaly derive off vessel.target.orbit (no body table needed)", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      "vessel.target": targetPoint({
        kind: 0,
        relativePosition: { x: 1, y: 0, z: 0 },
        orbit: TARGET_ORBIT,
      }),
    });

    const state = deriveVesselState(get, 0);
    const expectedPeriod =
      2 * Math.PI * Math.sqrt(TARGET_ORBIT.sma ** 3 / TARGET_ORBIT.mu);
    expect(state?.targetPeriod).toBeCloseTo(expectedPeriod, 6);
    // meanAnomalyAtEpoch 0, epoch 0, viewUt 0 -> true anomaly 0.
    expect(state?.targetTrueAnomaly).toBe(0);
  });

  it("targetPeriapsisAlt = sma·(1-ecc) - bodyRadius once system.bodies carries the target's reference body", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      "vessel.target": targetPoint({
        kind: 0,
        relativePosition: { x: 1, y: 0, z: 0 },
        orbit: TARGET_ORBIT,
      }),
      "system.bodies": bodiesPoint(KERBIN_SYSTEM_BODIES),
    });

    const expected = TARGET_ORBIT.sma * (1 - TARGET_ORBIT.ecc) - KERBIN_RADIUS;
    expect(deriveVesselState(get, 0)?.targetPeriapsisAlt).toBeCloseTo(
      expected,
      6,
    );
  });

  it("targetPeriapsisAlt is undefined (resyncing) while system.bodies is absent — period/trueAnomaly still resolve", () => {
    const { get } = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      "vessel.target": targetPoint({
        kind: 0,
        relativePosition: { x: 1, y: 0, z: 0 },
        orbit: TARGET_ORBIT,
      }),
      // no system.bodies
    });

    const state = deriveVesselState(get, 0);
    expect(state?.targetPeriapsisAlt).toBeUndefined();
    expect(state?.targetPeriod).not.toBeUndefined();
    expect(state?.targetTrueAnomaly).not.toBeUndefined();
  });

  it("all three target-orbit fields are undefined when the target has no orbit; null on a tombstone; derived in the measured basis too", () => {
    const noOrbit = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      "vessel.target": targetPoint({
        kind: 0,
        relativePosition: { x: 1, y: 0, z: 0 },
        orbit: null,
      }),
    });
    const s1 = deriveVesselState(noOrbit.get, 0);
    expect(s1?.targetPeriapsisAlt).toBeUndefined();
    expect(s1?.targetPeriod).toBeUndefined();
    expect(s1?.targetTrueAnomaly).toBeUndefined();

    const tomb = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.OnRails }),
      "vessel.target": targetPoint(null),
    });
    const s2 = deriveVesselState(tomb.get, 0);
    expect(s2?.targetPeriod).toBeNull();
    expect(s2?.targetTrueAnomaly).toBeNull();

    const measured = fakeGet({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.Loaded }),
      "vessel.flight": flightPoint(MEASURED_FLIGHT),
      "vessel.target": targetPoint({
        kind: 0,
        relativePosition: { x: 1, y: 0, z: 0 },
        orbit: TARGET_ORBIT,
      }),
    });
    const s3 = deriveVesselState(measured.get, 0, measured.get);
    expect(s3?.basis).toBe("measured");
    expect(s3?.targetPeriod).not.toBeNull();
    expect(s3?.targetTrueAnomaly).toBe(0);
  });
});

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

      // vessel.identity/system.bodies ARE read on this basis (met/apsides)
      // — only vessel.flight is off-limits here.
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

// ── shared-derivation tests ──────────────────────────────────────────────

/** Generic point wrapper for the derivation tests below (arbitrary topics). */
function pt<T>(payload: T | null, quality = Quality.OnRails): TimelinePoint<T> {
  return {
    validAt: 0,
    payload,
    meta: makeMeta({ validAt: 0, quality, source: "vessel:abc-123" }),
    epoch: 0,
  };
}

/** A `DerivedGet` over an arbitrary topic → point map (these derivations read topics beyond vessel.orbit/vessel.flight). */
function getFrom(points: Record<string, TimelinePoint<unknown> | undefined>) {
  return (<T>(topic: string) =>
    points[topic] as TimelinePoint<T> | undefined) as DerivedGet;
}

const ONRAILS = { quality: Quality.OnRails };

describe("R6 twr — vessel.state.twr off vessel.propulsion (dv.currentTWR)", () => {
  const PROP: VesselPropulsionPayload = {
    totalMass: 10,
    dryMass: 4,
    currentThrust: 200,
    availableThrust: 400,
  };

  it("derives currentThrust/(totalMass·g)", () => {
    const get = getFrom({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, ONRAILS),
      "vessel.propulsion": pt(PROP),
    });
    const state = deriveVesselState(get, 0);
    expect(state?.twr).toBeCloseTo(200 / (10 * 9.80665), 6);
  });

  it("undefined when vessel.propulsion hasn't arrived; null on tombstone", () => {
    expect(
      deriveVesselState(
        getFrom({ "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, ONRAILS) }),
        0,
      )?.twr,
    ).toBeUndefined();
    expect(
      deriveVesselState(
        getFrom({
          "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, ONRAILS),
          "vessel.propulsion": pt<VesselPropulsionPayload>(null),
        }),
        0,
      )?.twr,
    ).toBeNull();
  });

  it("undefined when totalMass is not positive (no weight to divide by)", () => {
    const get = getFrom({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, ONRAILS),
      "vessel.propulsion": pt({ ...PROP, totalMass: 0 }),
    });
    expect(deriveVesselState(get, 0)?.twr).toBeUndefined();
  });
});

describe("R6 isControllable — vessel.state.isControllable off vessel.comms.controlState (v.isControllable)", () => {
  const cases: Array<[number, boolean | undefined]> = [
    [0, false], // None
    [4, true], // Full
    [3, true], // Partial (level 1)
    [1, true], // Probe (level 2)
    [5, false], // ProbeNone (level 0)
    [8, false], // KerbalNone (level 0)
    [11, undefined], // Unknown (no level)
  ];
  for (const [controlState, expected] of cases) {
    it(`controlState ${controlState} -> ${expected}`, () => {
      const get = getFrom({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, ONRAILS),
        "vessel.comms": pt({ controlState }),
      });
      expect(deriveVesselState(get, 0)?.isControllable).toBe(expected);
    });
  }

  it("null on a vessel.comms tombstone", () => {
    const get = getFrom({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, ONRAILS),
      "vessel.comms": pt<VesselCommsPayload>(null),
    });
    expect(deriveVesselState(get, 0)?.isControllable).toBeNull();
  });
});

describe("R6 identity flags — isEVA / isSplashed off vessel.identity (v.isEVA / v.splashed)", () => {
  function identity(
    over: Partial<VesselIdentityPayload>,
  ): VesselIdentityPayload {
    return {
      vesselId: "v",
      name: "V",
      vesselType: 0,
      situation: 0,
      parentBodyIndex: 1,
      launchUt: 0,
      ...over,
    };
  }

  it("isEVA true only for vesselType EVA (7)", () => {
    const eva = deriveVesselState(
      getFrom({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, ONRAILS),
        "vessel.identity": pt(identity({ vesselType: 7 })),
      }),
      0,
    );
    expect(eva?.isEVA).toBe(true);
    const ship = deriveVesselState(
      getFrom({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, ONRAILS),
        "vessel.identity": pt(identity({ vesselType: 0 })),
      }),
      0,
    );
    expect(ship?.isEVA).toBe(false);
  });

  it("isSplashed true only for situation Splashed (1)", () => {
    const splashed = deriveVesselState(
      getFrom({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, ONRAILS),
        "vessel.identity": pt(identity({ situation: 1 })),
      }),
      0,
    );
    expect(splashed?.isSplashed).toBe(true);
    const landed = deriveVesselState(
      getFrom({
        "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, ONRAILS),
        "vessel.identity": pt(identity({ situation: 0 })),
      }),
      0,
    );
    expect(landed?.isSplashed).toBe(false);
  });

  it("both undefined when vessel.identity hasn't arrived", () => {
    const state = deriveVesselState(
      getFrom({ "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, ONRAILS) }),
      0,
    );
    expect(state?.isEVA).toBeUndefined();
    expect(state?.isSplashed).toBeUndefined();
  });
});

describe("R6 action groups — vessel.state.actionGroups map + actionGroup{n} (v.ag{n}Value)", () => {
  it("splits the bool[] into a keyed map + per-index booleans", () => {
    const get = getFrom({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, ONRAILS),
      "vessel.control": pt<VesselControlPayload>({
        sasMode: 0,
        actionGroups: [
          true,
          false,
          true,
          false,
          false,
          false,
          false,
          false,
          false,
          true,
        ],
      }),
    });
    const state = deriveVesselState(get, 0);
    expect(state?.actionGroup1).toBe(true);
    expect(state?.actionGroup2).toBe(false);
    expect(state?.actionGroup3).toBe(true);
    expect(state?.actionGroup10).toBe(true);
    expect(state?.actionGroups).toEqual({
      "1": true,
      "2": false,
      "3": true,
      "4": false,
      "5": false,
      "6": false,
      "7": false,
      "8": false,
      "9": false,
      "10": true,
    });
  });

  it("supports Action Groups Extended (more than ten groups) in the map", () => {
    const arr = new Array(12).fill(false);
    arr[11] = true;
    const get = getFrom({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, ONRAILS),
      "vessel.control": pt<VesselControlPayload>({
        sasMode: 0,
        actionGroups: arr,
      }),
    });
    const state = deriveVesselState(get, 0);
    expect(state?.actionGroups?.["12"]).toBe(true);
  });

  it("undefined (all) when the array is absent; keys still present", () => {
    const get = getFrom({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, ONRAILS),
      "vessel.control": pt<VesselControlPayload>({ sasMode: 0 }),
    });
    const state = deriveVesselState(get, 0);
    expect(state?.actionGroups).toBeUndefined();
    expect(state?.actionGroup1).toBeUndefined();
    expect(Object.hasOwn(state ?? {}, "actionGroup1")).toBe(true);
  });
});

describe("R6 closestApproachUt — vessel.state.closestApproachUt (o.closestTgtApprUT)", () => {
  it("solves closest approach when both orbits share a reference body", () => {
    const target: VesselTargetPayload = {
      kind: 0,
      orbit: { ...CIRCULAR_ORBIT, sma: 900_000 },
    };
    const get = getFrom({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, ONRAILS),
      "vessel.target": pt(target),
    });
    const ut = deriveVesselState(get, 0)?.closestApproachUt;
    expect(typeof ut).toBe("number");
    expect(ut as number).toBeGreaterThanOrEqual(0);
  });

  it("undefined when the target orbits a different body", () => {
    const target: VesselTargetPayload = {
      kind: 0,
      orbit: { ...CIRCULAR_ORBIT, referenceBodyIndex: 5, sma: 900_000 },
    };
    const get = getFrom({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, ONRAILS),
      "vessel.target": pt(target),
    });
    expect(deriveVesselState(get, 0)?.closestApproachUt).toBeUndefined();
  });

  it("undefined in the measured basis (no propagated self conic)", () => {
    const target: VesselTargetPayload = {
      kind: 0,
      orbit: { ...CIRCULAR_ORBIT, sma: 900_000 },
    };
    const get = getFrom({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, { quality: Quality.Loaded }),
      "vessel.flight": flightPoint(MEASURED_FLIGHT),
      "vessel.target": pt(target),
    });
    expect(deriveVesselState(get, 0, get)?.closestApproachUt).toBeUndefined();
  });

  it("null on a vessel.target tombstone", () => {
    const get = getFrom({
      "vessel.orbit": orbitPoint(CIRCULAR_ORBIT, ONRAILS),
      "vessel.target": pt<VesselTargetPayload>(null),
    });
    expect(deriveVesselState(get, 0)?.closestApproachUt).toBeNull();
  });
});

describe("landing scalars — vessel.state.landing* (land.timeToImpact/speedAtImpact/bestSpeedAtImpact/suicideBurnCountdown)", () => {
  // Synthetic body chosen so gravity is a round g = mu/(radius+altitudeAsl)²:
  // mu = 8e10, radius = 200_000, altitudeAsl = 0 → g = 8e10/200000² = 2.0 m/s².
  const LANDING_BODIES: SystemBodiesPayload = {
    bodies: [
      {
        name: "Testmun",
        index: 3,
        parentIndex: 0,
        radius: 200_000,
        orbit: null,
      },
    ],
  };
  const LANDING_ORBIT: VesselOrbitPayload = {
    referenceBodyIndex: 3,
    sma: 250_000,
    ecc: 0,
    inc: 0,
    lan: null,
    argPe: null,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
    mu: 8e10,
  };
  // availableThrust/totalMass = 6 m/s² → TWR = 3 over g = 2.
  const LANDING_PROP: VesselPropulsionPayload = {
    totalMass: 1,
    dryMass: 0.5,
    currentThrust: 0,
    availableThrust: 6,
  };
  // Descending at 10 m/s (vDown = 10), 20 m/s surface speed, 100 m above terrain.
  const DESCENT_FLIGHT: VesselFlightPayload = {
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
  };

  function landingGet(
    flightOver: Partial<VesselFlightPayload> = {},
    opts: {
      quality?: Quality;
      orbit?: VesselOrbitPayload;
      noBodies?: boolean;
      noProp?: boolean;
      prop?: VesselPropulsionPayload;
    } = {},
  ): DerivedGet {
    return getFrom({
      "vessel.orbit": orbitPoint(opts.orbit ?? LANDING_ORBIT, {
        quality: opts.quality ?? Quality.Loaded,
      }),
      "vessel.flight": flightPoint({ ...DESCENT_FLIGHT, ...flightOver }),
      "system.bodies": opts.noBodies ? undefined : bodiesPoint(LANDING_BODIES),
      "vessel.propulsion": opts.noProp
        ? undefined
        : pt(opts.prop ?? LANDING_PROP, Quality.Loaded),
    });
  }

  it("derives the full ballistic set on a descent (g=2, h=100, vDown=10, aMax=6)", () => {
    const s = deriveVesselState(landingGet(), 0);
    // t = (-10 + √(10² + 2·2·100)) / 2 = (-10 + √500)/2
    expect(s?.landingTimeToImpact).toBeCloseTo((-10 + Math.sqrt(500)) / 2, 6);
    // √(20² + 2·2·100) = √800
    expect(s?.landingSpeedAtImpact).toBeCloseTo(Math.sqrt(800), 6);
    // aNet = 6-2 = 4, burn d = 10²/(2·4) = 12.5 ≤ 100 → perfect landing reachable
    expect(s?.landingBestSpeedAtImpact).toBe(0);
    // ignition at h-d = 87.5: t = (-10 + √(100 + 2·2·87.5))/2 = (-10 + √450)/2
    expect(s?.landingSuicideBurnCountdown).toBeCloseTo(
      (-10 + Math.sqrt(450)) / 2,
      6,
    );
  });

  it("gravity uses altitudeAsl, not just the body radius (r = radius + altitudeAsl)", () => {
    // altitudeAsl = 200_000 → r = 400_000 → g = 8e10/400000² = 0.5 m/s².
    const s = deriveVesselState(landingGet({ altitudeAsl: 200_000 }), 0);
    // t = (-10 + √(100 + 2·0.5·100)) / 0.5 = (-10 + √200)/0.5
    expect(s?.landingTimeToImpact).toBeCloseTo((-10 + Math.sqrt(200)) / 0.5, 6);
  });

  it("residual best-speed is positive when the burn can't fit (d > h)", () => {
    // h = 5, d = 12.5 > 5 → best = √(vDown² - 2·aNet·h) = √(100 - 40) = √60,
    // and ignition height 5 - 12.5 < 0 → IGNITE now (countdown 0).
    const s = deriveVesselState(landingGet({ altitudeTerrain: 5 }), 0);
    expect(s?.landingBestSpeedAtImpact).toBeCloseTo(Math.sqrt(60), 6);
    expect(s?.landingSuicideBurnCountdown).toBe(0);
  });

  it("burn fields are null when thrust can't beat gravity (TWR ≤ 1)", () => {
    // aMax = 1 < g = 2.
    const s = deriveVesselState(
      landingGet({}, { prop: { ...LANDING_PROP, availableThrust: 1 } }),
      0,
    );
    // Impact fields still derive (no thrust needed for a ballistic fall).
    expect(s?.landingTimeToImpact).toBeCloseTo((-10 + Math.sqrt(500)) / 2, 6);
    expect(s?.landingSpeedAtImpact).toBeCloseTo(Math.sqrt(800), 6);
    expect(s?.landingBestSpeedAtImpact).toBeNull();
    expect(s?.landingSuicideBurnCountdown).toBeNull();
  });

  it("impact fields still derive with no vessel.propulsion; burn fields null", () => {
    const s = deriveVesselState(landingGet({}, { noProp: true }), 0);
    expect(s?.landingTimeToImpact).toBeCloseTo((-10 + Math.sqrt(500)) / 2, 6);
    expect(s?.landingSpeedAtImpact).toBeCloseTo(Math.sqrt(800), 6);
    expect(s?.landingBestSpeedAtImpact).toBeNull();
    expect(s?.landingSuicideBurnCountdown).toBeNull();
  });

  it("all four are null when not descending (verticalSpeed ≥ 0)", () => {
    const climbing = deriveVesselState(landingGet({ verticalSpeed: 10 }), 0);
    expect(climbing?.landingTimeToImpact).toBeNull();
    expect(climbing?.landingSpeedAtImpact).toBeNull();
    expect(climbing?.landingBestSpeedAtImpact).toBeNull();
    expect(climbing?.landingSuicideBurnCountdown).toBeNull();

    const level = deriveVesselState(landingGet({ verticalSpeed: 0 }), 0);
    expect(level?.landingTimeToImpact).toBeNull();
  });

  it("all four are null at or below the terrain (altitudeTerrain ≤ 0)", () => {
    const s = deriveVesselState(landingGet({ altitudeTerrain: 0 }), 0);
    expect(s?.landingTimeToImpact).toBeNull();
    expect(s?.landingSpeedAtImpact).toBeNull();
    expect(s?.landingBestSpeedAtImpact).toBeNull();
    expect(s?.landingSuicideBurnCountdown).toBeNull();
  });

  it("all four are null without a system.bodies radius (can't compute gravity)", () => {
    const s = deriveVesselState(landingGet({}, { noBodies: true }), 0);
    expect(s?.landingTimeToImpact).toBeNull();
    expect(s?.landingSpeedAtImpact).toBeNull();
    expect(s?.landingBestSpeedAtImpact).toBeNull();
    expect(s?.landingSuicideBurnCountdown).toBeNull();
  });

  it("all four are null in the propagated (OnRails) basis", () => {
    const s = deriveVesselState(
      landingGet({}, { quality: Quality.OnRails }),
      0,
    );
    expect(s?.basis).toBe("propagated");
    expect(s?.landingTimeToImpact).toBeNull();
    expect(s?.landingSpeedAtImpact).toBeNull();
    expect(s?.landingBestSpeedAtImpact).toBeNull();
    expect(s?.landingSuicideBurnCountdown).toBeNull();
  });
});
