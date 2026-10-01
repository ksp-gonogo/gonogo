/**
 * The altimeter as a full-height rail down one edge of the landing widget: AGL falling toward the ground line, the suicide-burn ignition band shaded as a hot zone, and the ignition cue beneath it.
 * `agl` is handed to the `Tape` as a whole reading so the rail marks a held height itself; before data arrives it renders an empty scale.
 * The scale runs from the craft down to the lower of the ground and sea level, so a band the model draws near the ground fills a readable part of the rail. Both levels are always drawn, pinned to an edge when off the scale.
 */

import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { Tape, Text, writeQuantity } from "@ksp-gonogo/ui-kit";

/** Where the model puts the craft now on the rail's scale, with the interval it claims around that. */
export interface RailPrediction {
  value: Value<"m">;
  bounds?: { lo: Value<"m">; hi: Value<"m"> };
}

export interface AltitudeRailProps {
  /** Height above terrain, of the vessel's lowest point unless `centreOfMass`. */
  agl: Reading<Value<"m">>;
  /** The height is the root part's, the lowest-point datum being unavailable: the rail draws no burn band and names no ignition. */
  centreOfMass?: boolean;
  /** Where the model puts the craft now, as a height on this rail's scale. Drawn beside the pointer, never in its place. */
  prediction?: RailPrediction | null;
  /** Sea level as a height on this rail's scale: below the ground over land, above it below sea level. */
  seaLevel?: Value<"m"> | null;
  /** AGL at which the suicide burn must begin, metres. */
  ignitionAltitude: number | null;
  /** Seconds to the latest ignition. */
  suicideBurnCountdown: number | null;
}

/** Round up to a "nice" 1/2/5 x 10^n tick spacing. */
function niceStep(x: number): number {
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
  seaLevel = null,
  ignitionAltitude,
  suicideBurnCountdown,
}: Readonly<AltitudeRailProps>) {
  const ground = value("m", 0);
  const height = agl.value ?? ground;
  // Quantised to the millimetre: the solve reaches this through pow and exp, whose last bits differ between platforms, and the rail must draw the same band everywhere.
  const ignition =
    !centreOfMass && ignitionAltitude != null && ignitionAltitude > 0
      ? value("m", Math.round(ignitionAltitude * 1000) / 1000)
      : null;
  const predicted = prediction?.bounds?.hi ?? prediction?.value ?? ground;
  const top = height
    .max(predicted)
    .max(ignition ?? ground)
    .max(value("m", 1));
  const bottom = seaLevel === null ? ground : ground.min(seaLevel);
  const span = top.minus(bottom);
  const tickStep = value("m", niceStep(span.magnitude / 4));

  // The hot band: from the ground up to the ignition altitude, the region in which the burn must already have started.
  const zones =
    ignition != null
      ? [
          {
            from: ground,
            to: ignition,
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
          min={bottom}
          max={top.plus(span.scaled(0.1))}
          tickStep={tickStep}
          groundLine={ground}
          seaLevel={seaLevel ?? undefined}
          zones={zones}
          markers={
            prediction === null
              ? undefined
              : [
                  {
                    value: prediction.value,
                    bounds: prediction.bounds,
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
