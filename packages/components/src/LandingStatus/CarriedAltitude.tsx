import type { ReckonableReading } from "@ksp-gonogo/sitrep-client";
import { bandIn, readingOf, type VesselFlight } from "@ksp-gonogo/sitrep-sdk";
import {
  Band,
  bandClaim,
  Grid,
  NULL_DISPLAY,
  ReadoutCaption,
  Section,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { declinedState } from "../shared/declinedState";
import { altitudeDecimals, GridCellPair } from "./readouts";

/** The reading `vessel.flight` arrives as, spelled once so the readout and the widget body agree on the reckonable fields. */
export type FlightReading = ReckonableReading<
  VesselFlight,
  "altitudeAsl" | "orbitalSpeed"
>;

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
          <GridCellPair label="Carried to SCET">
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
      {band ? (
        <ReadoutCaption>
          {bandClaim(band.kind, "the carried altitude is inside that interval")}
        </ReadoutCaption>
      ) : modelState !== null ? (
        <ReadoutCaption title={declined?.note}>{modelState}</ReadoutCaption>
      ) : carried !== null ? (
        <ReadoutCaption>
          carried with no interval: this model bounds nothing
        </ReadoutCaption>
      ) : null}
    </Section>
  );
}
