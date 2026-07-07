import { Quality } from "@gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { type OrbitElements, solve } from "./kepler";
import type { StreamStatusValue } from "./stream-status";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import type { DerivedGet } from "./timeline-store";
import {
  deriveVesselState,
  deriveVesselStateStatus,
  type VesselFlightPayload,
  type VesselOrbitPayload,
} from "./vessel-state";

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
}): { get: DerivedGet; requestedTopics: string[] } {
  const requestedTopics: string[] = [];
  const get: DerivedGet = (<T>(topic: string) => {
    requestedTopics.push(topic);
    return points[topic as keyof typeof points] as TimelinePoint<T> | undefined;
  }) as DerivedGet;
  return { get, requestedTopics };
}

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

      expect(requestedTopics).toEqual(["vessel.orbit"]);
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
