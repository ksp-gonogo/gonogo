import { Quality, wrapTypePayload } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { makeMeta } from "./stub-transport";
import { deriveVesselState } from "./vessel-state";

/**
 * A `vessel.flight` frame that carries only some of its fields, on the MEASURED
 * (Loaded) basis.
 *
 * Every kinematic field on `VesselState` is declared `number | null`, and the
 * whole file is written to that discipline: `finiteOrNull` wraps each derived
 * scalar so a non-finite intermediate becomes `null` rather than escaping. Four
 * fields on the Loaded path were assigned straight from the wire without it,
 * and the local unwrap they go through answers `NaN` for an absent field, so
 * those four could be `NaN`, which is neither of their two declared answers.
 *
 * `NaN` matters more than it looks. Every consumer reads
 * `vesselState?.altitudeAsl ?? undefined`, and `??` catches `null` and
 * `undefined` and not `NaN`. The DISPLAY survives it, `<Unit>` renders a
 * non-finite value as the absence placeholder. What does not survive it is
 * every comparison: `NaN > x` and `NaN < x` are both false, so an altitude
 * threshold silently never trips and `ContractManager`'s altitude-band match
 * never fires. It is the absent-reads-as-a-value failure with the polarity
 * flipped, a gate that quietly does nothing instead of a reading that lies.
 *
 * `deriveVesselState` is called directly rather than through a `TimelineStore`:
 * it is exported, it is pure, and the question here is what one derivation
 * answers for one frame.
 */

const ORBIT = {
  referenceBodyIndex: 1,
  sma: 700000,
  ecc: 0,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  mu: 3.5316e12,
};

/** Every field `vessel.flight` declares, so a case can drop exactly one. */
const FLIGHT_FULL: Readonly<Record<string, number>> = {
  latitude: 0,
  longitude: 0,
  altitudeAsl: 1000,
  altitudeTerrain: 1000,
  verticalSpeed: 5,
  surfaceSpeed: 100,
  orbitalSpeed: 2200,
  gForce: 1,
  dynamicPressureKPa: 0,
  mach: 0,
  atmDensity: 0,
  externalTemperature: 250,
  atmosphericTemperature: 250,
};

function point(type: string, payload: Record<string, unknown>) {
  return {
    validAt: 0,
    payload: wrapTypePayload(type, payload) as never,
    meta: makeMeta({
      validAt: 0,
      deliveredAt: 0,
      quality: Quality.Loaded,
      source: "vessel:abc-123",
    }),
    epoch: 0,
  };
}

function deriveWithout(dropped: string) {
  const flight: Record<string, number> = { ...FLIGHT_FULL };
  delete flight[dropped];
  const get = ((topic: string) => {
    if (topic === "vessel.orbit") return point("VesselOrbit", ORBIT);
    if (topic === "vessel.flight") return point("VesselFlight", flight);
    return undefined;
  }) as never;
  return deriveVesselState(get, 0);
}

/**
 * The four fields the measured basis takes straight off the wire. Named
 * individually rather than swept, so a failure says WHICH reading escaped.
 */
const WIRE_SOURCED = [
  "altitudeAsl",
  "verticalSpeed",
  "surfaceSpeed",
  "orbitalSpeed",
] as const;

describe("vessel.state on a partial vessel.flight frame", () => {
  it("derives a record at all, so the assertions below are about a real one", () => {
    expect(deriveWithout("altitudeAsl")).not.toBeUndefined();
    expect(deriveWithout("altitudeAsl")).not.toBeNull();
  });

  for (const field of WIRE_SOURCED) {
    it(`answers null, never NaN, for an unreported ${field}`, () => {
      // No `Record<string, unknown>` cast: `WIRE_SOURCED` is a const tuple, so
      // every element of it is already a key of `VesselState` and the compiler
      // checks that it stays one.
      const state = deriveWithout(field);
      const value = state?.[field];
      // Both assertions, and in this order. `toBeNull` alone would report
      // `expected NaN to be null`, which is legible; the explicit isNaN check
      // is here because NaN is the ONE wrong answer this file exists to catch
      // and it should be named in the failure rather than inferred.
      expect(Number.isNaN(value)).toBe(false);
      expect(value).toBeNull();
    });
  }

  it("still reads every one of them when the frame is whole", () => {
    const flight: Record<string, number> = { ...FLIGHT_FULL };
    const get = ((topic: string) => {
      if (topic === "vessel.orbit") return point("VesselOrbit", ORBIT);
      if (topic === "vessel.flight") return point("VesselFlight", flight);
      return undefined;
    }) as never;
    const state = deriveVesselState(get, 0);
    // The other half of the fix: a guard that nulls an absent field must not
    // also null a present one, and a test that only checks absence cannot
    // tell those apart.
    expect(state?.altitudeAsl).toBe(1000);
    expect(state?.verticalSpeed).toBe(5);
    expect(state?.surfaceSpeed).toBe(100);
    expect(state?.orbitalSpeed).toBe(2200);
  });
});
