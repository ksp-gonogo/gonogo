import type { BodyDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  circularOrbitVelocity,
  defineTopicManifest,
  registerComponent,
} from "@ksp-gonogo/core";
import { deriveReading, value } from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";
import {
  type ComputedSeries,
  GraphView,
  type GraphViewConfig,
  ReadoutRows,
  type ReferenceCurve,
} from "../Graph";
import { useBodyName, useParentBodyIndex } from "../shared/useBodyName";
import { useComputedSeries } from "../shared/useComputedSeries";
import { useStreamBody } from "../shared/useStreamBody";
import read from "./orbital-ascent.declarations.g";

/** Horizontal speed, computed here: the wire carries its two components, not it. */
const HORIZONTAL_SPEED_KEY = "orbital-ascent.horizontalSpeed";

/**
 * The orbital-speed split: what is left of the speed in the inertial frame once
 * the vertical part is taken out. That is the figure a circular orbit's speed
 * is compared against; the surface-relative speed is short of it by the body's
 * rotation, so a craft in orbit would never reach the curve. Clamped before the
 * root, so rounding in two independently reported speeds never yields NaN.
 */
export function horizontalOf(
  orbitalSpeed: number,
  verticalSpeed: number,
): number {
  return Math.sqrt(
    Math.max(0, orbitalSpeed * orbitalSpeed - verticalSpeed * verticalSpeed),
  );
}

const topics = defineTopicManifest({
  // The reference curve needs the body's radius and gravitational parameter from `system.bodies`.
  channels: ["vessel.flight", "vessel.identity", "system.bodies"],
  optionalChannels: read.optionalChannels,
  fields: [
    "vessel.flight.altitudeAsl",
    "vessel.flight.orbitalSpeed",
    "vessel.flight.verticalSpeed",
    "vessel.identity.parentBodyIndex",
    "system.bodies",
  ],
});

export interface OrbitalAscentConfig {
  /** Seconds of trace history retained. Default 600 (10 min, typical ascent). */
  windowSec?: number;
  /** Override the auto-derived altitude ceiling for the reference curve (metres). */
  altitudeCeiling?: number;
}

const REFERENCE_SAMPLES = 60;

/**
 * Reference-curve ceiling, high enough to hold a typical parking orbit:
 * 1.5x the atmosphere ceiling on an atmospheric body (Kerbin: 105 km), else
 * max(20% of radius, 30 km) (Mun: 40 km, Minmus: 30 km).
 */
function defaultCeiling(body: BodyDefinition): number {
  if (body.hasAtmosphere) return body.maxAtmosphere * 1.5;
  return Math.max(body.radius * 0.2, 30_000);
}

function buildReferenceCurve(
  body: BodyDefinition,
  ceiling: number,
): ReferenceCurve | null {
  if (body.gm === undefined) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= REFERENCE_SAMPLES; i++) {
    const altitude = (ceiling * i) / REFERENCE_SAMPLES;
    const v = circularOrbitVelocity(body, altitude);
    if (v === undefined) continue;
    xs.push(altitude);
    ys.push(v);
  }
  return {
    id: "circular-orbit",
    label: `Circular orbit (${body.name})`,
    xs,
    ys,
    color: "var(--color-go-mark)",
  };
}

function OrbitalAscentComponent({
  config,
}: Readonly<ComponentProps<OrbitalAscentConfig>>) {
  const bodyName = useBodyName(useParentBodyIndex());
  const body = useStreamBody(bodyName);

  const windowSec = config?.windowSec ?? 600;
  const horizontalData = useComputedSeries(
    { topic: "vessel.flight", field: "orbitalSpeed" },
    { topic: "vessel.flight", field: "verticalSpeed" },
    windowSec,
    horizontalOf,
  );
  const computedSeries = useMemo<ComputedSeries[]>(
    () => [
      {
        meta: {
          key: HORIZONTAL_SPEED_KEY,
          label: "Horizontal velocity",
          unit: "m/s",
        },
        data: horizontalData,
      },
    ],
    [horizontalData],
  );

  const referenceCurve = useMemo(() => {
    if (!body) return null;
    const ceiling = config?.altitudeCeiling ?? defaultCeiling(body);
    return buildReferenceCurve(body, ceiling);
  }, [body, config?.altitudeCeiling]);

  const graphConfig: GraphViewConfig = useMemo(
    () => ({
      series: [
        {
          id: "ascent-trace",
          source: { topic: HORIZONTAL_SPEED_KEY },
          label: "Horizontal velocity",
          axis: "primary",
          type: "line",
        },
      ],
      windowSec,
      x: { topic: "vessel.flight", field: "altitudeAsl" },
      xLabel: "Altitude",
      xUnit: "m",
      yLabel: "Speed",
      yUnit: "m/s",
    }),
    [windowSec],
  );

  const flightReading = topics.useTelemetry("vessel.flight");
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
      computedSeries={computedSeries}
      referenceCurves={referenceCurve ? [referenceCurve] : undefined}
      title="ORBITAL ASCENT"
      notice={notice}
      plotReadout={(room) => {
        const { present } = room;
        if (!present) return undefined;
        const needed = present.references["circular-orbit"];
        /* The figures keep the flight reading's currency; the shortfall needs both of its inputs, so it is absent where the curve has no figure at this altitude. */
        const speedOf = (metresPerSecond: number | undefined) =>
          metresPerSecond === undefined
            ? undefined
            : value("m/s", metresPerSecond);
        const figure = (metresPerSecond: number | undefined) =>
          deriveReading(
            flightReading,
            () => speedOf(metresPerSecond),
            () => speedOf(metresPerSecond),
          );
        const shortfall = deriveReading(
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
              {
                label: "Horizontal speed",
                value: figure(present.y),
                decimals: 0,
              },
              { label: "Orbit speed", value: figure(needed), decimals: 0 },
              { label: "Shortfall", value: shortfall, decimals: 0 },
            ]}
          />
        );
      }}
    />
  );
}

registerComponent<OrbitalAscentConfig>({
  id: "orbital-ascent",
  name: "Orbital Ascent",
  description:
    "Your horizontal speed, worked out from orbital and vertical speed, plotted against altitude as a trace, beside a curve of the speed of a circular orbit at each altitude. When the trace reaches the curve, you are in orbit at that altitude.",
  tags: ["telemetry", "graph"],
  defaultSize: { w: 10, h: 8 },
  minSize: { w: 5, h: 4 },
  mobileHeight: 280,
  component: OrbitalAscentComponent,
  channels: topics.channels,
  ...read,
  fields: topics.fields,
  defaultConfig: { windowSec: 600 },
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { OrbitalAscentComponent };
