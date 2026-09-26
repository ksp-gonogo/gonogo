import {
  combineReadings,
  type Reading,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { Meter, speakQuantity, Unit } from "@ksp-gonogo/ui-kit";
import { ALT_METER_STYLE, altLabelStyle } from "./styles";

/**
 * Inline progress for ReachAltitudeEnvelope parameters: below the band the
 * bar fills toward the floor and the figure is the climb still needed; in the
 * band it is full; above it the figure is the overshoot.
 *
 * A held altitude dims the fill and an unreported one draws the absent form.
 * The band is judged against the modelled altitude where offered, since on
 * rails the model is the only answer.
 */
export function AltitudeProgress({
  min,
  max,
  altitude,
}: {
  min: number;
  max: number;
  altitude: Reading<Value<"m">>;
}) {
  const scored =
    altitude.reckoning.status === "available"
      ? altitude.reckoning.modelled
      : altitude.value;
  if (scored === undefined) {
    return (
      <Meter
        label="Altitude"
        value={null}
        layout="row"
        style={ALT_METER_STYLE}
      />
    );
  }
  const below = scored.lessThan(min);
  const inBand = !below && scored.lessThanOrEqual(max);
  const delta = below ? value("m", min).minus(scored) : scored.minus(max);
  const deltaReading = combineReadings([altitude], () => delta);
  const sign = below ? "−" : "+";
  return (
    <Meter
      label="Altitude"
      value={altitude}
      capacity={value("m", min)}
      layout="row"
      fillColor={
        inBand ? "var(--color-status-go-fg)" : "var(--color-accent-fg)"
      }
      valueLabelNode={
        <span style={altLabelStyle(inBand)}>
          {inBand ? (
            "in band"
          ) : (
            <>
              {sign}
              <AltitudeShort m={deltaReading} />
            </>
          )}
        </span>
      }
      valueLabel={
        inBand
          ? "in band"
          : `${speakQuantity(delta)} ${below ? "below" : "above"} the band`
      }
      style={ALT_METER_STYLE}
    />
  );
}

// Decimals track magnitude: this label sits inline, where width matters more than the last digit.
function AltitudeShort({ m }: { m: Reading<Value<"m">> }) {
  const short = m.value?.abs().lessThan(10_000) ?? true;
  return <Unit value={m} decimals={short ? 1 : 0} />;
}
