import { useTelemetry } from "@ksp-gonogo/core";
import {
  mapOrbitPatch,
  type OrbitTrajectory,
  predictImpactPoint,
  useOrbitTrajectory,
  useStream,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import type { Reading, Value, VesselManeuver } from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";
import { type EncounterKind, encounterKindOf } from "../shared/encounterKind";
import { magnitudeOf } from "../shared/magnitude";
import { bodyNamed } from "../shared/streamBody";
import { useBodyName, useParentBodyIndex } from "../shared/useBodyName";

/** What the map draws from, each figure resolved to the currency its draw needs. */
export interface MapTelemetry {
  /** Where the marker stands: a current reading or a model, never a held one. */
  lat: Value<"°"> | undefined;
  lon: Value<"°"> | undefined;
  /** The position is held and nothing models it, so no marker draws. */
  positionStale: boolean;
  /** The readouts' own readings, which mark a held figure. */
  latitudeReading: Reading<Value<"°">>;
  longitudeReading: Reading<Value<"°">>;
  altitudeReading: Reading<Value<"m">>;
  /** The last observed altitude, for the flown trail. */
  altSea: number | undefined;
  /** The altitude now, for the imaging verdict. */
  altSeaReadout: number | undefined;
  q: number | undefined;
  mach: number | undefined;
  speed: number | undefined;
  vSpeed: number | undefined;
  orbitPatches: ReturnType<typeof mapOrbitPatch>[] | undefined;
  encounterKind: EncounterKind | null;
  trajectory: OrbitTrajectory | null;
  trajectoryWithheld: Extract<OrbitTrajectory, { shape: "withheld" }> | null;
  hasPatchChain: boolean;
  maneuverNodes: VesselManeuver["nodes"] | undefined;
  universalTime: number | undefined;
  targetBodyId: string | undefined;
  body: ReturnType<typeof bodyNamed>;
  impactLat: number | undefined;
  impactLon: number | undefined;
  vesselOnThisBody: boolean;
}

/**
 * Everything the map reads off the stream, resolved to what each draw may use:
 * the HUD figures, the position the marker stands on, the orbit the ground
 * track solves from, and the body being mapped.
 */
export function useMapTelemetry(
  bodyOverride: string | undefined,
): MapTelemetry {
  const flightReading = useTelemetry("vessel.flight");
  // The HUD readouts show the last observed numbers, captioned with their age.
  const flight =
    flightReading.state === "observed" || flightReading.state === "stale"
      ? flightReading.value
      : undefined;
  /* The marker is a claim about where the craft is now, so it comes from a current reading or a model, never a held one. The conic does not move lat/lon (the body-fixed mapping is not on the wire), so the dot still draws from the last observed pair under a model. */
  const positioned =
    flight && flightReading.reckoning.status === "available"
      ? { ...flight, ...flightReading.reckoning.value }
      : flightReading.state === "observed"
        ? flightReading.value
        : undefined;
  // True exactly when no marker is drawn: a stale reading with a model still draws.
  const positionStale =
    flightReading.state === "stale" &&
    flightReading.reckoning.status !== "available";
  const lat = positioned?.latitude;
  const lon = positioned?.longitude;
  /* `altitudeReading` feeds the readout, which marks its own currency. `altSea` is the last observed magnitude and feeds the flown trail, where a modelled altitude does not belong. */
  const altitudeReading = flightReading.altitudeAsl;
  const altSea =
    (altitudeReading.state === "observed" || altitudeReading.state === "stale"
      ? magnitudeOf(altitudeReading.value)
      : undefined) ?? undefined;
  // The imaging verdict is about now: modelled altitude if on offer, else a current observation.
  const altSeaReadout =
    magnitudeOf(
      altitudeReading.reckoning.status === "available"
        ? altitudeReading.reckoning.modelled
        : altitudeReading.state === "observed"
          ? altitudeReading.value
          : undefined,
    ) ?? undefined;
  const bodyName = useBodyName(useParentBodyIndex()) ?? undefined;
  // A patch carries no shape: the horizon's `trajectoryKind` decides whether a Kepler solve fits.
  const orbitReading = useTelemetry("vessel.orbit");
  /* The observation overlaid by what the conic moved (the phase). `reckoning.value` alone is not an orbit. */
  const orbitSampleObserved =
    orbitReading.state === "observed" || orbitReading.state === "stale"
      ? orbitReading.value
      : undefined;
  const orbitSample =
    orbitSampleObserved === undefined
      ? undefined
      : orbitReading.reckoning.status === "available"
        ? { ...orbitSampleObserved, ...orbitReading.reckoning.value }
        : orbitSampleObserved;
  // Holds when stale. Memoised on the sample so the memos keyed on the array rerun only on a new sample.
  const orbitPatches = useMemo(
    () =>
      orbitSampleObserved === undefined
        ? undefined
        : (orbitSampleObserved.patches ?? []).map(mapOrbitPatch),
    [orbitSampleObserved],
  );
  // The encounter and impact point are markers, so they need a current reading.
  const orbitCurrent =
    orbitReading.state === "observed" ? orbitReading.value : undefined;
  const flightCurrent =
    flightReading.state === "observed" ? flightReading.value : undefined;
  // Only the marker draw cares which kind; the chips own the body and time.
  const encounterKind = encounterKindOf(orbitCurrent?.encounter);
  const trajectory: OrbitTrajectory | null = useOrbitTrajectory(orbitSample);
  const trajectoryWithheld =
    trajectory !== null && trajectory.shape === "withheld" ? trajectory : null;
  // No refusal caption before the first elements arrive: a cold stream is not a refusal.
  const hasPatchChain = (orbitPatches?.length ?? 0) > 0;
  const planReading = useStream<VesselManeuver>("vessel.maneuver");
  const maneuverNodes =
    planReading.state === "observed" || planReading.state === "stale"
      ? planReading.value.nodes
      : undefined;
  const universalTime = useViewUt()?.magnitude;

  // The body picker (config.bodyOverride) lets the operator inspect any body; unset follows the vessel.
  const targetBodyId = bodyOverride ?? bodyName;
  /* Radius and rotation period come off `system.bodies`, matched by name, so a planet-pack rename still gets a ground track. */
  const bodiesReading = useTelemetry("system.bodies");
  /* A body's radius does not decay, so a stale roster is the right read. */
  const bodies =
    bodiesReading.state === "observed" || bodiesReading.state === "stale"
      ? bodiesReading.value
      : undefined;
  /* Memoised: an unmemoised merge would re-solve Kepler every render and defeat the `utBucket` throttle. */
  const body = useMemo(
    () => bodyNamed(bodies, targetBodyId),
    [bodies, targetBodyId],
  );
  const impact = useMemo(
    () =>
      orbitCurrent === undefined ||
      flightCurrent === undefined ||
      universalTime === undefined
        ? null
        : predictImpactPoint({
            orbit: orbitCurrent,
            flight: flightCurrent,
            bodies,
            viewUt: universalTime,
          }),
    [orbitCurrent, flightCurrent, bodies, universalTime],
  );
  // (0, 0) is the "no prediction" sentinel, never a point to mark.
  const impactMarked =
    impact !== null &&
    Number.isFinite(impact.lat) &&
    Number.isFinite(impact.lon) &&
    !(impact.lat === 0 && impact.lon === 0);

  return {
    lat,
    lon,
    positionStale,
    latitudeReading: flightReading.latitude,
    longitudeReading: flightReading.longitude,
    altitudeReading,
    altSea,
    altSeaReadout,
    q: flight?.dynamicPressureKPa?.magnitude,
    mach: flight?.mach?.magnitude,
    speed: flight?.surfaceSpeed?.magnitude,
    vSpeed: flight?.verticalSpeed?.magnitude,
    orbitPatches,
    encounterKind,
    trajectory,
    trajectoryWithheld,
    hasPatchChain,
    maneuverNodes,
    universalTime,
    targetBodyId,
    body,
    impactLat: impactMarked ? impact.lat : undefined,
    impactLon: impactMarked ? impact.lon : undefined,
    // An override that diverges from the vessel's body suppresses every vessel-relative draw and the follow chrome.
    vesselOnThisBody: !bodyOverride || bodyOverride === bodyName,
  };
}
