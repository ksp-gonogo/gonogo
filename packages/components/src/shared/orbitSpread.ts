import { solveOrbit, type TopicReading } from "@ksp-gonogo/sitrep-client";
import { type Value, type VesselOrbit, value } from "@ksp-gonogo/sitrep-sdk";

/** The elements a place on the orbit is solved from. */
type ObservedElements = Pick<
  VesselOrbit,
  | "sma"
  | "ecc"
  | "inc"
  | "lan"
  | "argPe"
  | "meanAnomalyAtEpoch"
  | "epoch"
  | "mu"
>;

/**
 * The stretch of orbit the craft may be anywhere on, as true anomalies in
 * degrees from its trailing end to its leading end, with the half-width of the
 * stretch in mean anomaly for its tooltip.
 */
export interface OrbitSpread {
  anomalies: readonly number[];
  halfWidth: Value<"°">;
}

/** Points along the arc; a quarter of an orbit still reads as a curve. */
const SPREAD_SAMPLES = 33;

/**
 * Where the craft's position spread lies along its orbit, read off the model's
 * band on the mean anomaly. Useful for drawing how far along the orbit the
 * craft could be, once the orbit has been carried forward from its last
 * observation. Used by the orbit diagram.
 *
 * `undefined` where the reading carries no band: no model, a model that offers
 * none, or a view past the horizon the provider stated. The band is in mean
 * anomaly, which is time along the orbit, so each sample is solved back to a
 * true anomaly rather than scaled.
 */
export function orbitSpread(
  reading: Pick<TopicReading<Pick<VesselOrbit, "epoch">>, "reckoning">,
  observed: ObservedElements | undefined,
): OrbitSpread | undefined {
  const { reckoning } = reading;
  if (observed === undefined || reckoning.status !== "available") {
    return undefined;
  }
  const band = reckoning.bands?.meanAnomalyAtEpoch;
  if (band === undefined) return undefined;
  if (
    !band.lo.isFinite() ||
    !band.hi.isFinite() ||
    band.hi.lessThanOrEqual(band.lo)
  ) {
    return undefined;
  }
  const epoch = reckoning.value.epoch ?? observed.epoch;
  const centre = band.lo.plus(band.hi).scaled(0.5);
  const full = band.hi.minus(band.lo).scaled(0.5);
  // A closed orbit repeats every turn, so a wider band than one turn is the whole orbit.
  const half = observed.ecc.lessThan(1)
    ? full.min(value("rad", Math.PI))
    : full;
  const anomalies: number[] = [];
  for (let i = 0; i < SPREAD_SAMPLES; i++) {
    const offset = half.scaled((2 * i) / (SPREAD_SAMPLES - 1) - 1);
    const nu = solveOrbit(
      { ...observed, epoch, meanAnomalyAtEpoch: centre.plus(offset) },
      epoch,
      undefined,
    ).trueAnomaly;
    if (nu == null) return undefined;
    anomalies.push(nu);
  }
  return { anomalies, halfWidth: half.in("°") };
}
