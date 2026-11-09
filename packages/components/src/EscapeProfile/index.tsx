import type { BodyDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  escapeVelocity,
  registerComponent,
} from "@ksp-gonogo/core";
import { deriveReading, value } from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";
import {
  GraphView,
  type GraphViewConfig,
  ReadoutRows,
  type ReferenceCurve,
} from "../Graph";
import { useBodyName, useParentBodyIndex } from "../shared/useBodyName";
import { useStreamBody } from "../shared/useStreamBody";

const topics = defineTopicManifest({
  // The escape-velocity curve needs the body's own radius and gravitational parameter, both on `trackingStation.bodies`.
  channels: ["vessel.flight", "vessel.identity", "trackingStation.bodies"],
  fields: [
    "vessel.flight.altitudeAsl",
    "vessel.flight.orbitalSpeed",
    "vessel.identity.parentBodyIndex",
    "trackingStation.bodies",
  ],
});

export interface EscapeProfileConfig {
  /** Seconds of trace history retained. Default 600. */
  windowSec?: number;
  /** Override the auto-derived altitude ceiling for the reference curve (metres). */
  altitudeCeiling?: number;
}

const REFERENCE_SAMPLES = 60;

// Escape happens far higher than ascent: 10x the atmosphere ceiling on an atmospheric body, a few radii on an airless one; the trace's X domain still auto-extends.
function defaultCeiling(body: BodyDefinition): number {
  if (body.hasAtmosphere) return body.maxAtmosphere * 10;
  return Math.max(body.radius * 2, 200_000);
}

function buildEscapeCurve(
  body: BodyDefinition,
  ceiling: number,
  narrow: boolean,
): ReferenceCurve | null {
  if (body.gm === undefined) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= REFERENCE_SAMPLES; i++) {
    const altitude = (ceiling * i) / REFERENCE_SAMPLES;
    const v = escapeVelocity(body, altitude);
    if (v === undefined) continue;
    xs.push(altitude);
    ys.push(v);
  }
  return {
    id: "escape-velocity",
    // The shared legend draws one untruncated SVG line, so narrow cells drop the body name to stay inside the plot.
    label: narrow ? "Escape velocity" : `Escape velocity (${body.name})`,
    xs,
    ys,
    color: "var(--color-warn-mark)",
  };
}

function EscapeProfileComponent({
  config,
  w,
}: Readonly<ComponentProps<EscapeProfileConfig>>) {
  const flightReading = topics.useTelemetry("vessel.flight");
  const bodyName = useBodyName(useParentBodyIndex());
  // Matched by name against the same `trackingStation.bodies` roster the name came from, so planet-pack bodies resolve.
  const body = useStreamBody(bodyName);

  const windowSec = config?.windowSec ?? 600;

  // At about 6 columns or fewer the full legend does not fit, so it is shortened.
  const narrow = w !== undefined && w <= 6;

  const referenceCurve = useMemo(() => {
    if (!body) return null;
    const ceiling = config?.altitudeCeiling ?? defaultCeiling(body);
    return buildEscapeCurve(body, ceiling, narrow);
  }, [body, config?.altitudeCeiling, narrow]);

  /*
   * The head of the track is a filled dot while the newest sample is a
   * measurement and a ring while it is held or a model's figure, so the mark
   * never states more than the reading does.
   */
  const measured =
    flightReading.state === "observed" &&
    flightReading.reckoning.status !== "available";

  // Orbital speed against altitude: touching the curve means escape. The track is a line, and its head mark reads where a line has a single sample to join.
  const graphConfig: GraphViewConfig = useMemo(
    () => ({
      series: [
        {
          id: "speed-trace",
          source: { topic: "vessel.flight", field: "orbitalSpeed" },
          label: "Orbital speed",
          axis: "primary",
          type: "line",
          head: measured ? "dot" : "ring",
        },
      ],
      windowSec,
      x: { topic: "vessel.flight", field: "altitudeAsl" },
      xLabel: "Altitude",
      xUnit: "m",
      yLabel: "Speed",
      yUnit: "m/s",
    }),
    [windowSec, measured],
  );

  const showNoGmNotice = body !== undefined && body.gm === undefined;
  const showNoBodyNotice = bodyName !== undefined && body === undefined;

  const notice =
    (showNoGmNotice &&
      body &&
      `No reference data for ${body.name}: plotting trace only.`) ||
    (showNoBodyNotice && `Unknown body “${bodyName}”: plotting trace only.`) ||
    undefined;

  return (
    // gonogo:reads vessel.flight
    <GraphView
      config={graphConfig}
      referenceCurves={referenceCurve ? [referenceCurve] : undefined}
      title="ESCAPE PROFILE"
      notice={notice}
      plotReadout={(room) => {
        const { present } = room;
        const needed = present?.references["escape-velocity"];
        if (!present) return undefined;
        /* The figures keep the flight reading's currency; margin needs both of its inputs, so it is absent where the curve has no figure at this altitude. */
        const speed = deriveReading(
          flightReading,
          () => value("m/s", present.y),
          () => value("m/s", present.y),
        );
        const escapeSpeed = deriveReading(
          flightReading,
          () => (needed === undefined ? undefined : value("m/s", needed)),
          () => (needed === undefined ? undefined : value("m/s", needed)),
        );
        const margin = deriveReading(
          flightReading,
          () =>
            needed === undefined
              ? undefined
              : value("m/s", needed).minus(value("m/s", present.y)),
          () =>
            needed === undefined
              ? undefined
              : value("m/s", needed).minus(value("m/s", present.y)),
        );
        return (
          <ReadoutRows
            stacked={room.compact}
            rows={[
              { label: "Orbital speed", value: speed, decimals: 0 },
              { label: "Escape speed", value: escapeSpeed, decimals: 0 },
              { label: "Margin", value: margin, decimals: 0 },
            ]}
          />
        );
      }}
    />
  );
}

registerComponent<EscapeProfileConfig>({
  id: "escape-profile",
  name: "Escape Profile",
  description:
    "Your orbital speed plotted against altitude, beside the speed needed to escape the body. When your trace reaches the curve, you are on an escape trajectory.",
  tags: ["telemetry", "graph"],
  defaultSize: { w: 10, h: 8 },
  minSize: { w: 5, h: 4 },
  mobileHeight: 280,
  component: EscapeProfileComponent,
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: { windowSec: 600 },
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { EscapeProfileComponent };
