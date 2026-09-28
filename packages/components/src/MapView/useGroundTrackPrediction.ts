import { predictGroundTrack } from "@ksp-gonogo/core";
import type { OrbitTrajectory, TrackSample } from "@ksp-gonogo/sitrep-client";
import type { OrbitPatch, VesselManeuver } from "@ksp-gonogo/sitrep-sdk";
import { kspCalendar } from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import type { bodyNamed } from "../shared/streamBody";
import { splitOnDrawnLongitudeWrap } from "./groundTrackWrap";
import { quantiseUt } from "./predictionThrottle";

interface GroundTrackInputs {
  enabled: boolean;
  trajectory: OrbitTrajectory | null;
  orbitPatches: readonly OrbitPatch[] | undefined;
  maneuverNodes: VesselManeuver["nodes"] | undefined;
  targetBodyId: string | undefined;
  body: ReturnType<typeof bodyNamed>;
  lat: { magnitude: number } | undefined;
  lon: { magnitude: number } | undefined;
  universalTime: number | undefined;
}

/**
 * The predicted ground track of the current orbit, and one per planned
 * manoeuvre, each split where it wraps in longitude.
 */
export function useGroundTrackPrediction({
  enabled,
  trajectory,
  orbitPatches,
  maneuverNodes,
  targetBodyId,
  body,
  lat,
  lon,
  universalTime,
}: Readonly<GroundTrackInputs>): {
  predictionSegments: TrackSample[][];
  maneuverSegments: TrackSample[][][];
} {
  // Throttled to once a second via `quantiseUt`: body-rotation drift over a second is about 0.1 degree of longitude.
  const utBucket = quantiseUt(universalTime, 1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: lat/lon/universalTime read inside, but invalidation gated on utBucket; see comment above
  const predictionSegments = useMemo<TrackSample[][]>(() => {
    if (!enabled) return [];
    // Conic only: an integrated path carries no lat/lon on the wire, and a two-body guess would lay a route the craft will not fly.
    if (trajectory?.shape !== "conic") return [];
    if (
      !orbitPatches ||
      orbitPatches.length === 0 ||
      !targetBodyId ||
      body?.rotationPeriod === undefined ||
      lat === undefined ||
      lon === undefined ||
      universalTime === undefined
    ) {
      return [];
    }
    const firstForBody = orbitPatches.find(
      (p) => p.referenceBody === targetBodyId,
    );
    if (!firstForBody) return [];
    // 1.5 periods shows the closed loop, capped at one calendar day (about one rotation, which a planet pack changes).
    const horizon = Math.min(
      1.5 * firstForBody.period.magnitude,
      kspCalendar().day,
    );
    const samples = predictGroundTrack(
      orbitPatches,
      targetBodyId,
      body.radius,
      body.rotationPeriod,
      { ut: universalTime, lat: lat.magnitude, lon: lon.magnitude },
      horizon,
      10,
    );
    return splitOnDrawnLongitudeWrap(samples, body.longitudeOffset ?? 0);
  }, [enabled, orbitPatches, trajectory, targetBodyId, body, utBucket]);

  // Each node's patches are the post-burn trajectory, calibrated from the current orbit's patches.
  // biome-ignore lint/correctness/useExhaustiveDependencies: lat/lon/universalTime read inside, but invalidation gated on utBucket
  const maneuverSegments = useMemo<TrackSample[][][]>(() => {
    if (!enabled) return [];
    if (
      !orbitPatches ||
      !maneuverNodes ||
      maneuverNodes.length === 0 ||
      !targetBodyId ||
      body?.rotationPeriod === undefined ||
      lat === undefined ||
      lon === undefined ||
      universalTime === undefined
    ) {
      return [];
    }
    // Capture past the outer guard so TS doesn't re-widen inside the map callback below.
    const bodyRadius = body.radius;
    const rotPeriod = body.rotationPeriod;
    const longitudeOffset = body.longitudeOffset ?? 0;
    return maneuverNodes.map((node) => {
      const patches = node.patches ?? [];
      const firstPatch = patches.find((p) => p.referenceBody === targetBodyId);
      if (!firstPatch) return [];
      // Horizon extends from ref.ut up through the maneuver and 1.5 × its first post-burn period: enough to see the new orbit close up.
      const horizon = Math.min(
        node.ut.magnitude - universalTime + 1.5 * firstPatch.period.magnitude,
        kspCalendar().day,
      );
      if (horizon <= 0) return [];
      const samples = predictGroundTrack(
        patches,
        targetBodyId,
        bodyRadius,
        rotPeriod,
        { ut: universalTime, lat: lat.magnitude, lon: lon.magnitude },
        horizon,
        10,
        orbitPatches,
      );
      return splitOnDrawnLongitudeWrap(samples, longitudeOffset);
    });
  }, [enabled, orbitPatches, maneuverNodes, targetBodyId, body, utBucket]);

  return { predictionSegments, maneuverSegments };
}
