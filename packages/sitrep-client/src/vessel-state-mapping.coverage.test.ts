import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { TELEMACHUS_CLEAN_HOMES } from "./map-topic";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import type { DerivedGet } from "./timeline-store";
import {
  deriveVesselState,
  type VesselFlightPayload,
  type VesselOrbitPayload,
} from "./vessel-state";

/**
 * Guards against the exact class of bug the red-team
 * found — a `mapTopic` entry pointing at `vessel.state.<field>` for a
 * `<field>` the shipped `deriveVesselState` never actually produces. Such an
 * entry LOOKS mapped (passes `mapTopic.coverage.test.ts` in `@ksp-gonogo/core`,
 * which only checks "mapped or gapped"), but is structurally a dead
 * `undefined` forever once a `TelemetryProvider` is mounted —
 * `TimelineStore.sampleDerived`'s field lookup silently returns `undefined`
 * for an unknown field name (see its own doc comment: "unknown field name —
 * nothing to serve"), which is indistinguishable from ordinary "not whole
 * yet" loading at that layer.
 *
 * Rather than hardcoding the field list here (which would silently drift the
 * moment `VesselState` gains/loses a field), this computes the REAL produced
 * field set by actually invoking `deriveVesselState` for both quality bases
 * (OnRails ∪ Loaded — a field populated in only one basis, e.g.
 * `altitudeAsl`, must still count as real) and checks every
 * `vessel.state.<field>` target in the migration table against that set.
 */

const ORBIT: VesselOrbitPayload = {
  referenceBodyIndex: 1,
  sma: 700_000,
  ecc: 0,
  inc: 0,
  lan: null,
  argPe: null,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  mu: 3.5316e12,
};

const FLIGHT: VesselFlightPayload = {
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

describe("mapTopic vessel.state.* targets stay in sync with deriveVesselState's real output (Fix 2 phantom-field guard)", () => {
  const produced = producedVesselStateFields();

  it("sanity: the derivation actually produced a non-trivial field set", () => {
    expect(produced.size).toBeGreaterThan(3);
  });

  it("every mapTopic target under the vessel.state.* namespace names a field deriveVesselState actually produces", () => {
    const vesselStateTargets = Object.values(TELEMACHUS_CLEAN_HOMES).filter(
      (target) => target.startsWith("vessel.state."),
    );

    const phantoms = vesselStateTargets
      .map((target) => target.slice("vessel.state.".length))
      .filter((field) => !produced.has(field));

    expect(phantoms).toEqual([]);
  });
});
