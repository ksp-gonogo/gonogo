import type { BodyDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  escapeVelocity,
  registerComponent,
} from "@ksp-gonogo/core";
import { useMemo } from "react";
import { type GraphConfig, GraphView, type ReferenceCurve } from "../Graph";
import { useBodyName, useParentBodyIndex } from "../shared/useBodyName";
import { useStreamBody } from "../shared/useStreamBody";

const topics = defineTopicManifest({
  // The escape-velocity curve needs the body's own radius and gravitational parameter, both on `system.bodies`.
  channels: ["vessel.flight", "vessel.identity", "system.bodies"],
  fields: ["vessel.flight.altitudeAsl", "vessel.flight.orbitalSpeed"],
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
    color: "var(--color-status-warning-bg)",
  };
}

function EscapeProfileComponent({
  config,
  w,
}: Readonly<ComponentProps<EscapeProfileConfig>>) {
  const bodyName = useBodyName(useParentBodyIndex());
  // Matched by name against the same `system.bodies` roster the name came from, so planet-pack bodies resolve.
  const body = useStreamBody(bodyName);

  const windowSec = config?.windowSec ?? 600;

  // At about 6 columns or fewer the full legend does not fit, so it is shortened.
  const narrow = w !== undefined && w <= 6;

  const referenceCurve = useMemo(() => {
    if (!body) return null;
    const ceiling = config?.altitudeCeiling ?? defaultCeiling(body);
    return buildEscapeCurve(body, ceiling, narrow);
  }, [body, config?.altitudeCeiling, narrow]);

  // Orbital speed against altitude: touching the curve means escape. Scatter, because a line series draws nothing for a single sample.
  const graphConfig: GraphConfig = useMemo(
    () => ({
      series: [
        {
          id: "speed-trace",
          key: "vessel.flight.orbitalSpeed",
          label: "Orbital speed",
          axis: "primary",
          type: "scatter",
        },
      ],
      windowSec,
      xKey: "vessel.flight.altitudeAsl",
    }),
    [windowSec],
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
    <GraphView
      config={graphConfig}
      referenceCurves={referenceCurve ? [referenceCurve] : undefined}
      title="ESCAPE PROFILE"
      notice={notice}
    />
  );
}

registerComponent<EscapeProfileConfig>({
  id: "escape-profile",
  name: "Escape Profile",
  description:
    "Phase-space plot: orbital speed vs altitude with an escape-velocity reference curve. When the trace touches the curve, the trajectory is at parabolic escape.",
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
