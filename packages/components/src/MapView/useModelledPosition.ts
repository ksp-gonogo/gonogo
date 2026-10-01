import { predictGroundTrack, useTelemetry } from "@ksp-gonogo/core";
import { deriveReading, type Value } from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";
import type { bodyNamed } from "../shared/streamBody";
import { quantiseUt } from "./predictionThrottle";

interface ModelledPositionInputs {
  targetBodyId: string | undefined;
  body: ReturnType<typeof bodyNamed>;
  lat: Value<"°"> | undefined;
  lon: Value<"°"> | undefined;
  receivedUt: number | undefined;
}

/**
 * Where the conic puts the craft at the instant its reckoning is for, as a
 * ground point, or `null` where no model carries the orbit past the received
 * edge. Drawn beside the observed position, never in its place.
 *
 * Not a reckoner: the carrying forward is `vessel.orbit`'s own registered reckoning, read here as a Reading. What this adds is a coordinate conversion from the conic's state to a ground point, which is a drawing figure on no channel.
 */
export function useModelledPosition({
  targetBodyId,
  body,
  lat,
  lon,
  receivedUt,
}: Readonly<ModelledPositionInputs>): { lat: number; lon: number } | null {
  const orbitReading = useTelemetry("vessel.orbit");
  const reckoning = orbitReading.reckoning;
  const carriedTo =
    orbitReading.state === "observed" &&
    reckoning.status === "available" &&
    reckoning.beyondReceived
      ? reckoning.atUt
      : undefined;
  // Throttled like the ground track it continues: a second of body rotation is about 0.1 degree of longitude.
  const bucket =
    carriedTo === undefined ? undefined : quantiseUt(carriedTo.magnitude, 1);
  const from = receivedUt === undefined ? undefined : quantiseUt(receivedUt, 1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the reading changes every frame; invalidation is gated on the two instants' buckets
  return useMemo(() => {
    if (bucket === undefined || from === undefined) return null;
    if (lat === undefined || lon === undefined || !targetBodyId) return null;
    const rotationPeriod = body?.rotationPeriod;
    if (body === undefined || rotationPeriod === undefined) return null;
    const derived = deriveReading(
      orbitReading,
      () => undefined,
      (orbit, atUt) => {
        const patches = orbit.patches ?? [];
        const ahead = atUt.magnitude - from;
        if (ahead <= 0) return undefined;
        const samples = predictGroundTrack(
          patches,
          targetBodyId,
          body.radius,
          rotationPeriod,
          { ut: from, lat: lat.magnitude, lon: lon.magnitude },
          ahead,
          ahead,
        );
        const last = samples.at(-1);
        return last !== undefined && last.ut > from ? last : undefined;
      },
    );
    if (derived.reckoning.status !== "available") return null;
    const { lat: modelledLat, lon: modelledLon } = derived.reckoning.modelled;
    return { lat: modelledLat, lon: modelledLon };
  }, [bucket, from, lat, lon, targetBodyId, body]);
}
