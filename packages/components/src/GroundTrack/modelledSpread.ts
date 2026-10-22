import { predictGroundTrack } from "@ksp-gonogo/core";
import { type Value, type VesselOrbit, value } from "@ksp-gonogo/sitrep-sdk";
import { SPREAD_SAMPLES } from "../shared/orbitSpread";

/** A place on the ground, in degrees. */
export interface GroundPoint {
  lat: number;
  lon: number;
}

interface SpreadInputs {
  orbit: Pick<VesselOrbit, "sma" | "mu" | "ecc" | "patches">;
  /** The model's band on the mean anomaly at the reckoned instant. */
  band: { lo: Value<string>; hi: Value<string> };
  bodyId: string;
  bodyRadius: number;
  rotationPeriod: number;
  /** The last place the craft was observed at, which the track is stepped from. */
  ref: { ut: number; lat: Value<"°">; lon: Value<"°"> };
  /** The instant the modelled position is for. */
  reckonedUt: Value<"ut">;
}

/**
 * The ground points the craft may be at, from the earliest instant the band
 * allows to the latest, or `null` where the model cannot carry the craft
 * across that stretch. The band is in mean anomaly, which is time along the
 * orbit, so its half-width is divided by the mean motion to give seconds
 * either side of the reckoned instant. The stretch starts no earlier than the
 * last observation, which is where the craft is known to have been.
 *
 * Not a reckoner: the band and the reckoned instant are `vessel.orbit`'s own
 * registered reckoning, read as a Reading. What this adds is the conversion of
 * the band from mean anomaly to ground points along the patches, a drawing
 * figure on no channel.
 */
export function groundSpread({
  orbit,
  band,
  bodyId,
  bodyRadius,
  rotationPeriod,
  ref,
  reckonedUt,
}: Readonly<SpreadInputs>): readonly GroundPoint[] | null {
  if (
    !band.lo.isFinite() ||
    !band.hi.isFinite() ||
    band.hi.lessThanOrEqual(band.lo)
  ) {
    return null;
  }
  const full = band.hi.minus(band.lo).scaled(0.5);
  // A closed orbit repeats every turn, so a band wider than one turn is the whole orbit.
  const half = orbit.ecc.lessThan(1) ? full.min(value("rad", Math.PI)) : full;
  const meanMotion = Math.sqrt(
    orbit.mu.magnitude / Math.abs(orbit.sma.magnitude) ** 3,
  );
  if (!Number.isFinite(meanMotion) || meanMotion <= 0) return null;
  const seconds = half.in("rad").magnitude / meanMotion;
  const patches = orbit.patches ?? [];
  const centre = reckonedUt.magnitude;
  const start = Math.max(ref.ut, centre - seconds);
  const end = centre + seconds;
  if (!(end > start)) return null;

  const observed = {
    ut: ref.ut,
    lat: ref.lat.magnitude,
    lon: ref.lon.magnitude,
  };
  let from = observed;
  if (start > ref.ut) {
    const lead = predictGroundTrack(
      patches,
      bodyId,
      bodyRadius,
      rotationPeriod,
      observed,
      start - ref.ut,
      start - ref.ut,
    ).at(-1);
    if (lead === undefined) return null;
    from = lead;
  }
  const step = (end - from.ut) / (SPREAD_SAMPLES - 1);
  const samples = predictGroundTrack(
    patches,
    bodyId,
    bodyRadius,
    rotationPeriod,
    from,
    end - from.ut,
    step,
  );
  if (samples.length < 2) return null;
  return samples.map((s) => ({ lat: s.lat, lon: s.lon }));
}
