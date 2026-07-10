import type { BodyDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  circularOrbitVelocity,
  getBody,
  registerComponent,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useMemo } from "react";
import styled from "styled-components";
import { type GraphConfig, GraphView, type ReferenceCurve } from "../Graph";

export interface OrbitalAscentConfig {
  /** Seconds of trace history retained. Default 600 (10 min — typical ascent). */
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
 * Atmospheric bodies — 1.5× the atmosphere ceiling (Kerbin: 105 km).
 * Airless bodies   — max(20% of radius, 30 km) (Mun: 40 km, Minmus: 30 km).
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
  // R6 read-migration: `v.body` reads through the canonical `useTelemetry`
  // hook. The shim resolves it to the derived `vessel.state.parentBodyName`
  // Topic (index→name display map, see `map-topic.ts`) and streams it once a
  // `TelemetryProvider` carries `vessel.state`'s inputs — no Telemachus
  // read-fallback is relied on for this read. The two plotted series
  // (`v.altitude` / `v.horizontalVelocity`) are consumed only via the shared
  // `GraphView` → `useDataSeries` path; both map to DERIVED `vessel.state.*`
  // channels, which have a live value but NO buffered history, so
  // `useDataSeries` structurally serves their windowed series off the legacy
  // path (`TimelineStore.sampleRange` returns `undefined` for a derived
  // topic — see that hook's doc). That is a shared-infra property, not a
  // gap in this widget.
  const bodyName = useTelemetry<string>("data", "v.body");
  const body = bodyName ? getBody(bodyName) : undefined;

  const windowSec = config?.windowSec ?? 600;

  const referenceCurve = useMemo(() => {
    if (!body) return null;
    const ceiling = config?.altitudeCeiling ?? defaultCeiling(body);
    return buildReferenceCurve(body, ceiling);
  }, [body, config?.altitudeCeiling]);

  // Locked Graph config — phase-space plot of horizontal velocity vs altitude.
  // The user can't reconfigure axes here; that's the point of a preset widget.
  const graphConfig: GraphConfig = useMemo(
    () => ({
      series: [
        {
          id: "ascent-trace",
          key: "v.horizontalVelocity",
          label: "Horizontal velocity",
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
        title="ORBITAL ASCENT"
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
  color: var(--color-text-faint);
  background: rgba(0, 0, 0, 0.7);
  padding: 2px 6px;
  border-radius: 2px;
  pointer-events: none;
`;

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
  dataRequirements: ["v.altitude", "v.horizontalVelocity", "v.body"],
  defaultConfig: { windowSec: 600 },
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { OrbitalAscentComponent };
