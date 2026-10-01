/**
 * The altimeter as a full-height rail down one edge of the landing widget: AGL falling toward the ground line, the suicide-burn ignition band shaded as a hot zone, and the ignition cue beneath it.
 * `agl` is handed to the `Tape` as a whole reading so the rail marks a held height itself; before data arrives it renders an empty scale.
 */

import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { Tape, Text, writeQuantity } from "@ksp-gonogo/ui-kit";

export interface AltitudeRailProps {
  /** Height above terrain, of the vessel's lowest point unless `centreOfMass`. */
  agl: Reading<Value<"m">>;
  /** The height is the root part's, the lowest-point datum being unavailable: the rail draws no burn band and names no ignition. */
  centreOfMass?: boolean;
  /** Where the model puts the craft now, as a height on this rail's scale. Drawn beside the pointer, never in its place. */
  prediction?: Value<"m"> | null;
  /** AGL at which the suicide burn must begin, metres. */
  ignitionAltitude: number | null;
  /** Seconds to the latest ignition. */
  suicideBurnCountdown: number | null;
}

/** Round up to a "nice" 1/2/5 x 10^n ceiling for the ladder's top of scale. */
function niceCeil(x: number): number {
  if (!(x > 0)) return 100;
  const pow = 10 ** Math.floor(Math.log10(x));
  const n = x / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

export function AltitudeRail({
  agl,
  centreOfMass = false,
  prediction = null,
  ignitionAltitude,
  suicideBurnCountdown,
}: Readonly<AltitudeRailProps>) {
  const height = agl.value ?? value("m", 0);
  const tallest = prediction === null ? height : height.max(prediction);
  const peakMeters = tallest.magnitude;
  // Quantised to the millimetre: the solve reaches this through pow and exp, whose last bits differ between platforms, and the rail must draw the same band everywhere.
  const ignition =
    !centreOfMass && ignitionAltitude != null && ignitionAltitude > 0
      ? Math.round(ignitionAltitude * 1000) / 1000
      : null;
  const maxScale = niceCeil(Math.max(peakMeters, ignition ?? 0, 1) * 1.1);

  // The hot band: from the ground up to the ignition altitude, the region in which the burn must already have started.
  const zones =
    ignition != null
      ? [
          {
            from: value("m", 0),
            to: value("m", ignition),
            color: "var(--color-nogo-text)",
            label: "burn",
          },
        ]
      : undefined;

  const near = suicideBurnCountdown != null && suicideBurnCountdown <= 5;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        height: "100%",
        // Root-relative, so the rail's rhythm tracks the browser font size.
        gap: "0.25rem",
        minWidth: 0,
      }}
    >
      <div style={{ flex: 1, minHeight: 0, width: "100%" }}>
        <Tape
          fillHeight
          labelSide="right"
          width={64}
          value={agl}
          min={value("m", 0)}
          max={value("m", maxScale)}
          tickStep={value("m", maxScale / 4)}
          groundLine={value("m", 0)}
          zones={zones}
          markers={
            prediction === null
              ? undefined
              : [
                  {
                    value: prediction,
                    color: "var(--color-warn-mark)",
                    label: "prediction",
                  },
                ]
          }
          ariaLabel={
            centreOfMass
              ? "Root-part altitude above terrain"
              : "Altitude above terrain"
          }
        />
      </div>
      {/* Panel.Body supplies the outer inset. */}
      {!centreOfMass && (
        <div style={{ alignSelf: "stretch" }}>
          <Text tone={near ? "go" : undefined} level="muted" size="xs">
            {suicideBurnCountdown == null
              ? "no burn"
              : suicideBurnCountdown <= 0
                ? "past ignition"
                : `ignite in ${writeQuantity(value("s", Math.ceil(suicideBurnCountdown)))}`}
          </Text>
        </div>
      )}
    </div>
  );
}
