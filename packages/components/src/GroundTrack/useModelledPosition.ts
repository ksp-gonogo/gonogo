import { predictGroundTrack, useTelemetry } from "@ksp-gonogo/core";
import { deriveReading, type Value } from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";
import type { bodyNamed } from "../shared/streamBody";
import { type GroundPoint, groundSpread } from "./modelledSpread";
import { quantiseUt } from "./predictionThrottle";

interface ModelledPositionInputs {
  /** False while the craft is on the ground, where no conic carries its position. */
  enabled: boolean;
  targetBodyId: string | undefined;
  body: ReturnType<typeof bodyNamed>;
  lat: Value<"°"> | undefined;
  lon: Value<"°"> | undefined;
  receivedUt: number | undefined;
}

/**
 * How close the track's last point must be to the reckoned instant to be the
 * craft's place at it.
 *
 * The track is stepped from the later of the reference instant and the current
 * patch's start, and KSP restarts the active craft's current patch at the game
 * clock on every update, so a patch starts at its own sample's instant. A
 * reference instant even a fraction of a second before that (the received edge
 * rounded down to its bucket was one) makes the track a single point at the
 * patch's start, which is where the craft was last observed, and the modelled
 * mark was drawn there on every such frame.
 */
const REACHED_SECONDS = 1e-3;

/** Where the model puts the craft, and the ground points it may be at about there. */
export interface ModelledPosition extends GroundPoint {
  /** From the earliest place the model's band allows to the latest; `null` where it states no band or cannot carry the craft across it. */
  spread: readonly GroundPoint[] | null;
}

/**
 * Where the conic puts the craft at the instant its reckoning is for, as a
 * ground point, or `null` where no model carries the orbit past the received
 * edge. Drawn beside the observed position, never in its place.
 *
 * Not a reckoner: the carrying forward is `vessel.orbit`'s own registered reckoning, read here as a Reading. What this adds is a coordinate conversion from the conic's state to a ground point, which is a drawing figure on no channel.
 */
export function useModelledPosition({
  enabled,
  targetBodyId,
  body,
  lat,
  lon,
  receivedUt,
}: Readonly<ModelledPositionInputs>): ModelledPosition | null {
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
  // The bucket only decides when to solve again. The solve itself takes the received edge as it is: see `REACHED_SECONDS`.
  const from = receivedUt === undefined ? undefined : quantiseUt(receivedUt, 1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the reading changes every frame; invalidation is gated on the two instants' buckets
  return useMemo(() => {
    if (!enabled) return null;
    if (bucket === undefined || receivedUt === undefined) return null;
    if (lat === undefined || lon === undefined || !targetBodyId) return null;
    const rotationPeriod = body?.rotationPeriod;
    if (body === undefined || rotationPeriod === undefined) return null;
    const spreadOf = () => {
      const band =
        reckoning.status === "available"
          ? reckoning.bands?.meanAnomalyAtEpoch
          : undefined;
      const orbit =
        orbitReading.state === "observed" || orbitReading.state === "held"
          ? orbitReading.value
          : undefined;
      if (
        band === undefined ||
        orbit === undefined ||
        carriedTo === undefined
      ) {
        return null;
      }
      return groundSpread({
        orbit,
        band,
        bodyId: targetBodyId,
        bodyRadius: body.radius,
        rotationPeriod,
        ref: { ut: receivedUt, lat, lon },
        reckonedUt: carriedTo,
      });
    };
    const derived = deriveReading(
      orbitReading,
      () => undefined,
      (orbit, atUt) => {
        const patches = orbit.patches ?? [];
        const reckonedUt = atUt.magnitude;
        const ahead = reckonedUt - receivedUt;
        if (ahead <= 0) return undefined;
        const samples = predictGroundTrack(
          patches,
          targetBodyId,
          body.radius,
          rotationPeriod,
          { ut: receivedUt, lat: lat.magnitude, lon: lon.magnitude },
          ahead,
          ahead,
        );
        const last = samples.at(-1);
        return last !== undefined &&
          Math.abs(last.ut - reckonedUt) < REACHED_SECONDS
          ? last
          : undefined;
      },
    );
    if (derived.reckoning.status !== "available") return null;
    const { lat: modelledLat, lon: modelledLon } = derived.reckoning.modelled;
    return {
      lat: modelledLat,
      lon: modelledLon,
      spread: spreadOf(),
    };
  }, [enabled, bucket, from, lat, lon, targetBodyId, body]);
}
