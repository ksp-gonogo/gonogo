import { predictGroundTrack, useTelemetry } from "@ksp-gonogo/core";
import { deriveReading, type Value } from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";
import type { bodyNamed } from "../shared/streamBody";
import { type GroundPoint, groundSpread } from "./modelledSpread";
import { useThrottledBuckets } from "./predictionThrottle";

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
  // Throttled like the ground track it continues: a second of body rotation is about 0.1 degree of longitude, and at warp the buckets are held between solves.
  // The bucket only decides when to solve again. The solve itself takes the received edge as it is: see `REACHED_SECONDS`.
  const [carriedBucket, receivedBucket] = useThrottledBuckets(
    [carriedTo?.magnitude, receivedUt],
    1,
  );
  const bucket = carriedTo === undefined ? undefined : carriedBucket;
  const from = receivedUt === undefined ? undefined : receivedBucket;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the reading changes every frame; invalidation is gated on the two instants' buckets
  return useMemo(() => {
    if (!enabled) return null;
    if (bucket === undefined || receivedUt === undefined) return null;
    if (lat === undefined || lon === undefined || !targetBodyId) return null;
    const rotationPeriod = body?.rotationPeriod;
    if (body === undefined || rotationPeriod === undefined) return null;
    let refUt = receivedUt;
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
        ref: { ut: refUt, lat, lon },
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
        /*
         * The orbit and the position are one sample, so when the patch starts
         * after the received edge (the view clock a frame behind the sample it
         * is drawing) the position is the craft's place at that start. The walk
         * steps from there in a single stride to the reckoned instant: a stride
         * of `ahead` would land its second sample past the horizon, leave the
         * walk ending at the patch's start, and drop the modelled mark.
         */
        refUt = Math.max(
          receivedUt,
          patches.find((p) => p.referenceBody === targetBodyId)?.startUt
            .magnitude ?? receivedUt,
        );
        const span = reckonedUt - refUt;
        if (span <= 0) return undefined;
        const samples = predictGroundTrack(
          patches,
          targetBodyId,
          body.radius,
          rotationPeriod,
          { ut: refUt, lat: lat.magnitude, lon: lon.magnitude },
          span + REACHED_SECONDS / 2,
          span,
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
