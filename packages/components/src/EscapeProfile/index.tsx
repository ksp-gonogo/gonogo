import type { BodyDefinition, ComponentProps } from "@gonogo/core";
import {
  escapeVelocity,
  getBody,
  registerComponent,
  useTelemetry,
} from "@gonogo/core";
import { useMemo } from "react";
import styled from "styled-components";
import { type GraphConfig, GraphView, type ReferenceCurve } from "../Graph";

export interface EscapeProfileConfig {
  /** Seconds of trace history retained. Default 600. */
  windowSec?: number;
  /** Override the auto-derived altitude ceiling for the reference curve (metres). */
  altitudeCeiling?: number;
}

const REFERENCE_SAMPLES = 60;

// Escape from low orbit happens at much higher altitudes than ascent — give
// the curve more headroom. For atmospheric bodies extend to 10× the
// atmosphere ceiling; for airless bodies use a few body radii. Either way
// the live trace's X domain auto-extends if needed.
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
    // The shared LineChart legend stamps the label as a single un-truncated
    // line of SVG <text>; on a narrow plot the body-name parenthetical runs
    // past the right edge and is clipped by the viewport. Drop it below ~6
    // grid columns so the label fits — the body name is still implied by the
    // widget context / title. Wider cells keep the explicit body name.
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
  // `v.body` is a clean home (`map-topic.ts`) — the derived
  // `vessel.state.parentBodyName` display map (`vessel.identity.parentBodyIndex`
  // resolved against `system.bodies`). Read via the canonical telemetry hook;
  // with a `TelemetryProvider` carrying `vessel.state`'s inputs this rides the
  // stream, and there is no Telemachus read-fallback for this widget.
  const bodyName = useTelemetry<string>("data", "v.body");
  const body = bodyName ? getBody(bodyName) : undefined;

  const windowSec = config?.windowSec ?? 600;

  // At ~6 grid columns or fewer the plot is too narrow for the full
  // "Escape velocity (Body)" legend to fit — shorten it (see buildEscapeCurve).
  const narrow = w !== undefined && w <= 6;

  const referenceCurve = useMemo(() => {
    if (!body) return null;
    const ceiling = config?.altitudeCeiling ?? defaultCeiling(body);
    return buildEscapeCurve(body, ceiling, narrow);
  }, [body, config?.altitudeCeiling, narrow]);

  // Plot orbital speed (a strict upper bound on horizontal-only) against
  // altitude. When the trace touches the curve the trajectory is at escape.
  const graphConfig: GraphConfig = useMemo(
    () => ({
      series: [
        {
          id: "speed-trace",
          key: "v.orbitalVelocity",
          label: "Orbital speed",
          axis: "primary",
          type: "line",
        },
      ],
      windowSec,
      xKey: "v.altitude",
    }),
    [windowSec],
  );

  const showNoGmNotice = body !== undefined && body.gm === undefined;
  const showNoBodyNotice = bodyName !== undefined && body === undefined;

  return (
    <Wrap>
      <GraphView
        config={graphConfig}
        referenceCurves={referenceCurve ? [referenceCurve] : undefined}
        title="ESCAPE PROFILE"
      />
      {showNoGmNotice && body && (
        <Notice role="status">
          No reference data for {body.name} — plotting trace only.
        </Notice>
      )}
      {showNoBodyNotice && (
        <Notice role="status">
          Unknown body “{bodyName}” — plotting trace only.
        </Notice>
      )}
    </Wrap>
  );
}

const Wrap = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  min-height: 0;
`;

const Notice = styled.div`
  position: absolute;
  bottom: 4px;
  left: 8px;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  background: rgba(0, 0, 0, 0.85);
  padding: 2px 6px;
  border-radius: 2px;
  pointer-events: none;
`;

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
  dataRequirements: ["v.altitude", "v.orbitalVelocity", "v.body"],
  defaultConfig: { windowSec: 600 },
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { EscapeProfileComponent };
