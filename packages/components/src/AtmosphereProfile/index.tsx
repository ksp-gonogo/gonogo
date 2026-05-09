import type { BodyDefinition, ComponentProps } from "@gonogo/core";
import {
  getBody,
  pressureAtAltitude,
  registerComponent,
  useDataValue,
} from "@gonogo/core";
import { useMemo } from "react";
import styled from "styled-components";
import {
  type GraphConfig,
  type GraphThresholdConfig,
  GraphView,
  type ReferenceCurve,
} from "../Graph";

export interface AtmosphereProfileConfig {
  /** Override the auto-derived altitude ceiling for the curve (metres). */
  altitudeCeiling?: number;
}

const REFERENCE_SAMPLES = 80;

function buildPressureCurve(
  body: BodyDefinition,
  ceiling: number,
): ReferenceCurve | null {
  if (!body.hasAtmosphere || !body.atmosphere) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= REFERENCE_SAMPLES; i++) {
    const altitude = (ceiling * i) / REFERENCE_SAMPLES;
    const p = pressureAtAltitude(body, altitude);
    if (p === undefined) continue;
    // Log axis can't show zero — clamp to a tiny positive for the
    // beyond-atmosphere tail so the curve still draws a finishing tick.
    xs.push(altitude);
    ys.push(p > 0 ? p : 1e-6);
  }
  return {
    id: "pressure",
    label: `Pressure (${body.name})`,
    xs,
    ys,
    color: "var(--color-tag-blue-fg)",
  };
}

function AtmosphereProfileComponent({
  config,
}: Readonly<ComponentProps<AtmosphereProfileConfig>>) {
  const bodyName = useDataValue<string>("data", "v.body");
  const body = bodyName ? getBody(bodyName) : undefined;
  const altitude = useDataValue<number>("data", "v.altitude");

  const referenceCurve = useMemo(() => {
    if (!body) return null;
    // Plot a bit beyond the atmosphere ceiling so the curve clearly bottoms
    // out before the chart edge; airless bodies short-circuit above.
    const ceiling = config?.altitudeCeiling ?? body.maxAtmosphere * 1.1;
    return buildPressureCurve(body, ceiling);
  }, [body, config?.altitudeCeiling]);

  // Vertical "current altitude" markers don't exist in the engine; fake the
  // marker by sampling the curve at the live altitude and dropping a
  // horizontal threshold at that pressure value. The horizontal line picks
  // out exactly the pressure you're flying through.
  const currentPressure = useMemo(() => {
    if (!body || altitude === undefined) return undefined;
    return pressureAtAltitude(body, altitude);
  }, [body, altitude]);

  const thresholds: GraphThresholdConfig[] | undefined = useMemo(() => {
    if (currentPressure === undefined || currentPressure <= 0) return undefined;
    if (altitude === undefined) return undefined;
    return [
      {
        id: "current-pressure",
        value: currentPressure,
        axis: "primary",
        label: `${formatPressure(currentPressure)} @ ${(altitude / 1000).toFixed(0)} km`,
        color: "var(--color-status-warning-bg)",
        dashed: false,
      },
    ];
  }, [currentPressure, altitude]);

  const graphConfig: GraphConfig = useMemo(
    () => ({
      // No live series — the widget is a static body-aware reference plot
      // with the threshold pulling out the current altitude's pressure.
      series: [],
      windowSec: 60,
      xKey: "v.altitude",
      yScalePrimary: "log",
      thresholds,
    }),
    [thresholds],
  );

  const showAirlessNotice = body !== undefined && !body.hasAtmosphere;
  const showNoModelNotice = body?.hasAtmosphere && !body.atmosphere;
  const showNoBodyNotice = bodyName !== undefined && body === undefined;

  return (
    <Wrap>
      <GraphView
        config={graphConfig}
        referenceCurves={referenceCurve ? [referenceCurve] : undefined}
        title="ATMOSPHERE PROFILE"
        emptyState={
          body
            ? `No atmosphere on ${body.name}.`
            : "Waiting for body telemetry…"
        }
      />
      {showAirlessNotice && body && (
        <Notice role="status">{body.name} has no atmosphere.</Notice>
      )}
      {showNoModelNotice && body && (
        <Notice role="status">
          No atmospheric model registered for {body.name}.
        </Notice>
      )}
      {showNoBodyNotice && (
        <Notice role="status">Unknown body “{bodyName}”.</Notice>
      )}
    </Wrap>
  );
}

function formatPressure(p: number): string {
  if (p >= 1000) return `${(p / 1000).toFixed(1)} kPa`;
  if (p >= 1) return `${p.toFixed(1)} Pa`;
  return `${(p * 1000).toFixed(2)} mPa`;
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

registerComponent<AtmosphereProfileConfig>({
  id: "atmosphere-profile",
  name: "Atmosphere Profile",
  description:
    "Atmospheric pressure as a function of altitude (log Y) for the current body. A live horizontal threshold marks the pressure at the vessel's current altitude.",
  tags: ["telemetry", "graph", "atmosphere"],
  defaultSize: { w: 8, h: 8 },
  minSize: { w: 5, h: 4 },
  mobileHeight: 280,
  component: AtmosphereProfileComponent,
  dataRequirements: ["v.altitude", "v.body"],
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { AtmosphereProfileComponent };
