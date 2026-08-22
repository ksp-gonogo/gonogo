import type { BodyDefinition, ComponentProps } from "@ksp-gonogo/core";
import { escapeVelocity, getBody, registerComponent } from "@ksp-gonogo/core";
import { useStream, type VesselState } from "@ksp-gonogo/sitrep-client";
import { Box, Stack } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { useMemo } from "react";
import { type GraphConfig, GraphView, type ReferenceCurve } from "../Graph";

export interface EscapeProfileConfig {
  /** Seconds of trace history retained. Default 600. */
  windowSec?: number;
  /** Override the auto-derived altitude ceiling for the reference curve (metres). */
  altitudeCeiling?: number;
}

const REFERENCE_SAMPLES = 60;

// Escape from low orbit happens at much higher altitudes than ascent, give
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
    // grid columns so the label fits: the body name is still implied by the
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
  // Native read: the `vessel.state` DERIVED channel's `parentBodyName`
  // display map (`vessel.identity.parentBodyIndex` resolved against
  // `system.bodies`): the same channel `Targeting`/`TargetPicker`/
  // `ManeuverPlanner`/`CurrentOrbit` read for their own `vessel.state.*`
  // fields, off the legacy two-arg `data`-source shim.
  const bodyName =
    useStream<VesselState>("vessel.state")?.parentBodyName ?? undefined;
  const body = bodyName ? getBody(bodyName) : undefined;

  const windowSec = config?.windowSec ?? 600;

  // At ~6 grid columns or fewer the plot is too narrow for the full
  // "Escape velocity (Body)" legend to fit: shorten it (see buildEscapeCurve).
  const narrow = w !== undefined && w <= 6;

  const referenceCurve = useMemo(() => {
    if (!body) return null;
    const ceiling = config?.altitudeCeiling ?? defaultCeiling(body);
    return buildEscapeCurve(body, ceiling, narrow);
  }, [body, config?.altitudeCeiling, narrow]);

  // Plot orbital speed (a strict upper bound on horizontal-only) against
  // altitude. When the trace touches the curve the trajectory is at escape.
  // Scatter, not line: mirrors KeplerPeriod's "one fresh dot per sample"
  // choice (see its own doc comment). A "line" series renders NOTHING for
  // a single sample (an SVG path with just one `M` command has no
  // strokeable length, even with a round linecap), so the widget's core
  // signal, where the live point sits relative to the escape-velocity
  // curve, was invisible until a second sample landed. Scatter draws a
  // marker per point regardless of count, matching every fixture's own
  // "trace dot" framing.
  const graphConfig: GraphConfig = useMemo(
    () => ({
      series: [
        {
          id: "speed-trace",
          key: "v.orbitalVelocity",
          label: "Orbital speed",
          axis: "primary",
          type: "scatter",
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
    <Stack gap="sm" style={WRAP_STYLE}>
      {/* GraphView's Panel is height:100%, so without an explicit shrinkable
          flex slot it doesn't yield room to the Notice sibling below (the two
          overlap instead of the chart shrinking by the Notice's height).
          Mirrors KeplerPeriod's / AtmosphereProfile's own GraphSlot wrapper. */}
      <Stack gap="xs" style={GRAPH_SLOT_STYLE}>
        <GraphView
          config={graphConfig}
          referenceCurves={referenceCurve ? [referenceCurve] : undefined}
          title="ESCAPE PROFILE"
        />
      </Stack>
      {/* Normal-flow row rather than an absolute overlay: the absolute version
          covered the x-axis tick labels at narrow heights (they physically
          overlap regardless of the chart's own height, since an
          absolutely-positioned element never yields flex space to a sibling).
          Matches KeplerPeriod's and AtmosphereProfile's own Notice, which
          already made this switch. */}
      {showNoGmNotice && body && (
        <Box role="status" radius="xs" style={NOTICE_STYLE}>
          No reference data for {body.name}: plotting trace only.
        </Box>
      )}
      {showNoBodyNotice && (
        <Box role="status" radius="xs" style={NOTICE_STYLE}>
          Unknown body “{bodyName}”: plotting trace only.
        </Box>
      )}
    </Stack>
  );
}

const WRAP_STYLE: CSSProperties = {
  height: "100%",
  width: "100%",
  minHeight: 0,
};

const GRAPH_SLOT_STYLE: CSSProperties = {
  flex: "1 1 auto",
  minHeight: 0,
};

const NOTICE_STYLE: CSSProperties = {
  flex: "0 0 auto",
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-faint)",
  background: "rgba(0, 0, 0, 0.7)",
  padding: "var(--space-2) var(--space-6)",
  pointerEvents: "none",
  alignSelf: "flex-start",
  maxWidth: "100%",
};

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
  dataRequirements: ["v.altitude", "v.orbitalVelocity"],
  defaultConfig: { windowSec: 600 },
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { EscapeProfileComponent };
