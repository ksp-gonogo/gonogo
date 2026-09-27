import {
  type BandKind,
  type Reading,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";

const AT = value("ut", 42_000);

/** A model's interval around `v`, as a band on the same unit. */
export interface BandSpec {
  lo: number;
  hi: number;
  kind: BandKind;
}

function reckoningOf<U extends string>(
  drawn: Value<U>,
  band: BandSpec | undefined,
): Reading<Value<U>>["reckoning"] {
  if (!band) return { status: "none" };
  return {
    status: "available",
    atUt: value("ut", 0),
    beyondReceived: false,
    modelled: drawn,
    basis: "linear-dead-reckoning",
    band: {
      value: drawn,
      lo: value(drawn.unit, band.lo),
      hi: value(drawn.unit, band.hi),
      kind: band.kind,
    },
  };
}

/** A current observation, with the band a model puts around it where given. */
export function live<U extends string>(
  unit: U,
  magnitude: number,
  band?: BandSpec,
): Reading<Value<U>> {
  const drawn = value(unit, magnitude);
  return {
    state: "observed",
    value: drawn,
    atUt: AT,
    reckoning: reckoningOf(drawn, band),
  };
}

/** The last observation, held after its figures stopped arriving. */
export function held<U extends string>(
  unit: U,
  magnitude: number,
  band?: BandSpec,
): Reading<Value<U>> {
  const drawn = value(unit, magnitude);
  return {
    state: "stale",
    value: drawn,
    asOfUt: AT,
    grade: "held-stale",
    reckoning: reckoningOf(drawn, band),
  };
}

/** Nothing has arrived yet. */
export function pending<U extends string>(): Reading<Value<U>> {
  return { state: "pending", reckoning: { status: "none" } };
}

/** The source confirmed there is no value. */
export function absent<U extends string>(): Reading<Value<U>> {
  return { state: "absent", atUt: AT, reckoning: { status: "none" } };
}
