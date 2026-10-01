import type { ReckonableReading } from "@ksp-gonogo/sitrep-client";
import {
  bandIn,
  type Reading,
  readingOf,
  type Value,
  type VesselFlight,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Band,
  Grid,
  NULL_DISPLAY,
  ReadoutCaption,
  Section,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { declinedState } from "../shared/declinedState";
import type { RailPrediction } from "./AltitudeRail";
import { altitudeDecimals, GridCellPair } from "./readouts";

/** The reading `vessel.flight` arrives as, spelled once so the readout and the widget body agree on the reckonable fields. */
export type FlightReading = ReckonableReading<
  VesselFlight,
  "altitudeAsl" | "orbitalSpeed"
>;

/** Where the model puts the craft now, as an altitude above sea level, or `null` while the observation stands as the present or nothing models it. */
function carriedAltitude(reading: FlightReading): Value<"m"> | null {
  const altitude = reading.altitudeAsl;
  const carrying =
    reading.state === "held" ||
    (altitude.reckoning.status === "available" &&
      altitude.reckoning.beyondReceived);
  return carrying && altitude.reckoning.status === "available"
    ? altitude.reckoning.modelled
    : null;
}

/** The observed altitude above sea level less the height above terrain: the ground's own altitude under the craft at the last observation. */
function groundBelow(
  reading: FlightReading,
  agl: Reading<Value<"m">>,
): Value<"m"> | null {
  const observed = reading.altitudeAsl;
  const observedAsl =
    observed.state === "observed" || observed.state === "held"
      ? observed.value
      : undefined;
  if (observedAsl === undefined || agl.value === undefined) return null;
  return observedAsl.minus(agl.value);
}

/**
 * The prediction as a height on the terrain-relative rail: the carried altitude less the ground the craft stands over at the last observation, with the model's interval shifted the same way.
 * That ground is the craft's own, not the ground at the predicted point, which the rail makes no claim about.
 */
export function predictionOnRail(
  reading: FlightReading,
  agl: Reading<Value<"m">>,
): RailPrediction | null {
  const carried = carriedAltitude(reading);
  const ground = groundBelow(reading, agl);
  if (carried === null || ground === null) return null;
  const { reckoning } = reading.altitudeAsl;
  const interval =
    reckoning.status === "available" ? bandIn(reckoning.band, "m") : undefined;
  const onRail = (altitude: Value<"m">) => altitude.minus(ground).max(0);
  return {
    value: onRail(carried),
    bounds:
      interval === undefined
        ? undefined
        : { lo: onRail(interval.lo), hi: onRail(interval.hi) },
  };
}

/** Sea level as a height on the terrain-relative rail: the negative of the ground's altitude, or `null` before the craft has been observed. */
export function seaLevelOnRail(
  reading: FlightReading,
  agl: Reading<Value<"m">>,
): Value<"m"> | null {
  return groundBelow(reading, agl)?.scaled(-1) ?? null;
}

/**
 * Altitude above sea level: the last measurement, where the model puts it now, and how well it claims to know that.
 *
 * ASL is the quantity `vessel.flight` has a reckoner for; AGL has none, since a fitted rate says nothing about the terrain ahead. The observation stays the headline and is marked, never replaced, and the carried figure and interval appear whenever the observation is not the craft's present: the reading is held, or a light-time behind SCET.
 */
export function CarriedAltitude({ reading }: { reading: FlightReading }) {
  const observed = readingOf(reading, (f) => f.altitudeAsl);
  const decimals =
    "value" in observed ? altitudeDecimals(observed.value) : undefined;
  // The field reading, which carries its own band and carried figure.
  const altitude = reading.altitudeAsl;
  const carrying =
    reading.state === "held" ||
    (altitude.reckoning.status === "available" &&
      altitude.reckoning.beyondReceived);
  const modelled =
    carrying && altitude.reckoning.status === "available"
      ? altitude.reckoning
      : undefined;
  const carried = modelled ? modelled.modelled : null;
  const band = bandIn(modelled?.band, "m");
  // Only while the reading is held; a current one the model declines to carry stands as the observation.
  const declined =
    reading.state === "held" && reading.reckoning.status === "declined"
      ? reading.reckoning.declined
      : undefined;
  const modelState = declined ? declinedState(declined) : null;
  return (
    <Section title="Altitude ASL">
      <Grid cols="auto 1fr" gap="readout-row">
        {carrying ? (
          <GridCellPair label="Last observed">
            <Unit value={observed} decimals={decimals} />
          </GridCellPair>
        ) : (
          <Text style={{ gridColumn: "1 / -1" }}>
            <Unit value={observed} decimals={decimals} />
          </Text>
        )}
        {carrying && (
          <GridCellPair label="Prediction">
            {carried === null ? (
              NULL_DISPLAY
            ) : (
              <Unit value={carried} decimals={decimals} />
            )}
          </GridCellPair>
        )}
        {band && (
          <GridCellPair label="Known to">
            <Band min={band.lo} max={band.hi} />
          </GridCellPair>
        )}
      </Grid>
      {modelState !== null ? (
        <ReadoutCaption title={declined?.note}>{modelState}</ReadoutCaption>
      ) : null}
    </Section>
  );
}
