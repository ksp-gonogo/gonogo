import type { BodyDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  circularOrbitVelocity,
  defineTopicManifest,
  registerComponent,
} from "@ksp-gonogo/core";
import { Fill, GraphNotice } from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import {
  type ComputedSeries,
  type GraphConfig,
  GraphView,
  type ReferenceCurve,
} from "../Graph";
import { useBodyName, useParentBodyIndex } from "../shared/useBodyName";
import { useComputedSeries } from "../shared/useComputedSeries";
import { useStreamBody } from "../shared/useStreamBody";

/** Horizontal speed, computed here: the wire carries its two components, not it. */
const HORIZONTAL_SPEED_KEY = "orbital-ascent.horizontalSpeed";

/**
 * The surface-speed split: what is left of the surface speed once the vertical
 * part is taken out. Clamped before the root, so rounding in two independently
 * reported speeds never yields NaN.
 */
export function horizontalOf(
  surfaceSpeed: number,
  verticalSpeed: number,
): number {
  return Math.sqrt(
    Math.max(0, surfaceSpeed * surfaceSpeed - verticalSpeed * verticalSpeed),
  );
}

const topics = defineTopicManifest({
  // `system.bodies` is read directly: the reference curve needs the body's own
  // radius and gravitational parameter, and both are reported there.
  channels: ["vessel.flight", "vessel.identity", "system.bodies"],
  fields: [
    "vessel.flight.altitudeAsl",
    "vessel.flight.surfaceSpeed",
    "vessel.flight.verticalSpeed",
    "vessel.identity.parentBodyIndex",
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
 * Pick a sensible upper bound for the reference curve. We want the curve to
 * extend at least as high as a typical parking orbit so the live trace stays
 * within the plot, with a small headroom margin.
 *
 * Atmospheric bodies: 1.5× the atmosphere ceiling (Kerbin: 105 km).
 * Airless bodies  : max(20% of radius, 30 km) (Mun: 40 km, Minmus: 30 km).
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
    color: "var(--color-status-go-bg)",
  };
}

function OrbitalAscentComponent({
  config,
}: Readonly<ComponentProps<OrbitalAscentConfig>>) {
  /*
   * Both axes come off `vessel.flight`'s own buffered history: the altitude as
   * a fetched series, and the horizontal speed computed here from the surface
   * and vertical speeds on the same samples, because the wire carries no
   * horizontal speed of its own.
   */
  const bodyName = useBodyName(useParentBodyIndex());
  const body = useStreamBody(bodyName);

  const windowSec = config?.windowSec ?? 600;
  const horizontalData = useComputedSeries(
    "vessel.flight.surfaceSpeed",
    "vessel.flight.verticalSpeed",
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

  // Locked Graph config: phase-space plot of horizontal velocity vs altitude.
  // The user can't reconfigure axes here; that's the point of a preset widget.
  const graphConfig: GraphConfig = useMemo(
    () => ({
      series: [
        {
          id: "ascent-trace",
          key: HORIZONTAL_SPEED_KEY,
          label: "Horizontal velocity",
          axis: "primary",
          type: "line",
        },
      ],
      windowSec,
      xKey: "vessel.flight.altitudeAsl",
    }),
    [windowSec],
  );

  const showNoGmNotice = body !== undefined && body.gm === undefined;
  const showNoBodyNotice = bodyName !== undefined && body === undefined;

  return (
    <Fill>
      <GraphView
        config={graphConfig}
        computedSeries={computedSeries}
        referenceCurves={referenceCurve ? [referenceCurve] : undefined}
        title="ORBITAL ASCENT"
      />
      {showNoGmNotice && body && (
        <GraphNotice placement="overlay">
          No reference data for {body.name}: plotting trace only.
        </GraphNotice>
      )}
      {showNoBodyNotice && (
        <GraphNotice placement="overlay">
          Unknown body “{bodyName}”: plotting trace only.
        </GraphNotice>
      )}
    </Fill>
  );
}

registerComponent<OrbitalAscentConfig>({
  id: "orbital-ascent",
  name: "Orbital Ascent",
  description:
    "Phase-space plot: horizontal velocity vs altitude with a circular-orbit reference curve. When the live trace touches the curve, the ship is in orbit at that altitude.",
  tags: ["telemetry", "graph"],
  defaultSize: { w: 10, h: 8 },
  minSize: { w: 5, h: 4 },
  mobileHeight: 280,
  component: OrbitalAscentComponent,
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: { windowSec: 600 },
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { OrbitalAscentComponent };
