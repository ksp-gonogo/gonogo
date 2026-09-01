import { Quality, value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import type { DerivedGet } from "./timeline-store";
import {
  deriveVesselState,
  VESSEL_STATE_FIELDS,
  type VesselFlightPayload,
  type VesselOrbitPayload,
} from "./vessel-state";

/**
 * Guards against the exact class of bug the red-team
 * found: a `mapTopic` entry pointing at `vessel.state.<field>` for a
 * `<field>` the shipped `deriveVesselState` never actually produces. Such an
 * entry LOOKS mapped (passes `mapTopic.coverage.test.ts` in `@ksp-gonogo/core`,
 * which only checks "mapped or gapped"), but is structurally a dead
 * `undefined` forever once a `TelemetryProvider` is mounted,
 * `TimelineStore.sampleDerived`'s field lookup silently returns `undefined`
 * for an unknown field name (see its own doc comment: "unknown field name,
 * nothing to serve"), which is indistinguishable from ordinary "not whole
 * yet" loading at that layer.
 *
 * Rather than hardcoding the field list here (which would silently drift the
 * moment `VesselState` gains/loses a field), this computes the REAL produced
 * field set by actually invoking `deriveVesselState` for both quality bases
 * (OnRails ∪ Loaded: a field populated in only one basis, e.g.
 * `altitudeAsl`, must still count as real) and checks every
 * `vessel.state.<field>` target in the migration table against that set.
 */

const ORBIT: VesselOrbitPayload = {
  referenceBodyIndex: 1,
  sma: value("m", 700_000),
  ecc: value("1", 0),
  inc: value("°", 0),
  lan: null,
  argPe: null,
  meanAnomalyAtEpoch: value("rad", 0),
  epoch: value("s", 0),
  mu: value("m³/s²", 3.5316e12),
};

const FLIGHT: VesselFlightPayload = {
  latitude: value("°", -0.05),
  longitude: value("°", 42.3),
  altitudeAsl: value("m", 71_234),
  altitudeTerrain: value("m", 71_234),
  verticalSpeed: value("m/s", 12.5),
  surfaceSpeed: value("m/s", 1780.2),
  orbitalSpeed: value("m/s", 1790.9),
  gForce: value("g", 1.1),
  dynamicPressureKPa: value("kPa", 3.2),
  mach: value("1", 5.1),
  atmDensity: value("kg/m³", 0.01),
};

function orbitPoint(quality: Quality): TimelinePoint<VesselOrbitPayload> {
  return {
    validAt: 0,
    payload: ORBIT,
    meta: makeMeta({ validAt: 0, quality, source: "vessel:abc" }),
    epoch: 0,
  };
}

function flightPoint(): TimelinePoint<VesselFlightPayload> {
  return {
    validAt: 0,
    payload: FLIGHT,
    meta: makeMeta({
      validAt: 0,
      quality: Quality.Loaded,
      source: "vessel:abc",
    }),
    epoch: 0,
  };
}

/** Every field key `deriveVesselState` actually puts on its output, across both quality bases. */
function producedVesselStateFields(): Set<string> {
  const onRailsGet: DerivedGet = (<T>(topic: string) =>
    topic === "vessel.orbit"
      ? (orbitPoint(Quality.OnRails) as unknown as TimelinePoint<T>)
      : undefined) as DerivedGet;
  const onRailsState = deriveVesselState(onRailsGet, 0);

  const loadedPoints: Record<string, TimelinePoint<unknown>> = {
    "vessel.orbit": orbitPoint(
      Quality.Loaded,
    ) as unknown as TimelinePoint<unknown>,
    "vessel.flight": flightPoint() as unknown as TimelinePoint<unknown>,
  };
  const loadedGet: DerivedGet = (<T>(topic: string) =>
    loadedPoints[topic] as TimelinePoint<T> | undefined) as DerivedGet;
  const loadedState = deriveVesselState(loadedGet, 0, loadedGet);

  const fields = new Set<string>();
  for (const key of Object.keys(onRailsState ?? {})) fields.add(key);
  for (const key of Object.keys(loadedState ?? {})) fields.add(key);
  return fields;
}

describe("vessel.state's declared fields stay in sync with deriveVesselState's real output (phantom-field guard)", () => {
  const produced = producedVesselStateFields();
  const declared = new Set(Object.keys(VESSEL_STATE_FIELDS));

  it("sanity: the derivation actually produced a non-trivial field set", () => {
    expect(produced.size).toBeGreaterThan(3);
  });

  it("declares no field the derivation never produces", () => {
    // A declared field the derivation does not produce reads as a permanent
    // `undefined`, which `sampleDerived` cannot tell from "not whole yet". It
    // would sit in every picker looking like a value that has not arrived.
    const phantoms = [...declared].filter((field) => !produced.has(field));
    expect(phantoms).toEqual([]);
  });

  it("declares every field the derivation does produce", () => {
    // The other direction, which the check this replaces could not ask: it
    // read the migration table, so a field no legacy key ever named was
    // invisible to it. An undeclared field is absent from the catalogue, so
    // nothing can pick it and nothing says why.
    const undeclared = [...produced].filter((field) => !declared.has(field));
    expect(undeclared).toEqual([]);
  });
});
