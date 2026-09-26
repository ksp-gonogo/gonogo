import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY, Unit } from "@ksp-gonogo/ui-kit";
import { MAX_TAG_STYLE } from "./styles";

// Drop to whole degrees once the number is wide, so the readout's width stays stable as a part heats through the thousands.
const celsiusDecimals = (kelvin: number): number =>
  Math.abs(kelvin - 273.15) >= 1000 ? 0 : 1;

// Takes Kelvin from the channel and shows Celsius.
export function Temp({ kelvin }: { kelvin: number | undefined }) {
  if (kelvin === undefined || !Number.isFinite(kelvin)) return NULL_DISPLAY;
  return (
    <Unit
      value={value("K", kelvin)}
      as="°C"
      decimals={celsiusDecimals(kelvin)}
    />
  );
}

/** `Temp`, for a reading rather than a bare number. */
function TempReading({
  reading,
}: {
  reading: Reading<Value<"K">> | undefined;
}) {
  const kelvin = reading?.value?.magnitude;
  if (reading === undefined || kelvin === undefined || !Number.isFinite(kelvin))
    return NULL_DISPLAY;
  return <Unit value={reading} as="°C" decimals={celsiusDecimals(kelvin)} />;
}

/** A temperature over its rated maximum; only the temperature is drawn as a reading, the maximum is a plain rating. */
export function TempOverMax({
  temp,
  max,
}: {
  temp: Reading<Value<"K">> | undefined;
  max: Reading<Value<"K">> | undefined;
}) {
  return (
    <>
      <TempReading reading={temp} />
      {max?.value != null && (
        <span style={MAX_TAG_STYLE}>
          {" / "}
          <Temp kelvin={max.value.magnitude} /> max
        </span>
      )}
    </>
  );
}

export function Flux({ kw }: { kw: number | undefined }) {
  if (kw === undefined || !Number.isFinite(kw)) return NULL_DISPLAY;
  return <Unit value={value("kW", kw)} />;
}
