import type { BodyDefinition, ComponentProps } from "@gonogo/core";
import {
  getBody,
  kelvinToCelsius,
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
    // The log axis can't show zero, and clamping the beyond-atmosphere tail
    // to a tiny positive drew a long flat line at the chart floor that read
    // as "constant residual pressure in vacuum". Once pressure reaches zero
    // the atmosphere has ended — stop the curve there rather than dragging a
    // misleading floor segment across the rest of the plot.
    if (p <= 0) break;
    xs.push(altitude);
    ys.push(p);
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
  w,
  h,
}: Readonly<ComponentProps<AtmosphereProfileConfig>>) {
  const bodyName = useDataValue<string>("data", "v.body");
  const body = bodyName ? getBody(bodyName) : undefined;
  const altitude = useDataValue<number>("data", "v.altitude");
  const liveDensity = useDataValue<number>("data", "v.atmosphericDensity");
  const liveAirTemp = useDataValue<number>("data", "v.atmosphericTemperature");
  const liveSkinTemp = useDataValue<number>("data", "v.externalTemperature");

  const cols = w ?? 8;
  const rows = h ?? 8;
  // At extreme tall-narrow aspects (portrait-5x18) the plot is only a few
  // columns wide. The shared LineChart stamps the series legend top-left and
  // right-anchors the threshold label at the plot's right edge; on a wide
  // chart they sit at opposite ends, but on a narrow plot the right-anchored
  // threshold label sweeps left across the whole plot and collides with both
  // the legend chip and the Y-axis tick labels. We can't reposition either
  // element (that's shared LineChart chrome), but both *strings* are
  // widget-owned — shortening them pulls the right-anchored label's left edge
  // back toward the right edge and shrinks the legend chip, clearing the
  // overlap. Same responsive trick already used for the panel title.
  const narrow = cols < 6;

  const referenceCurve = useMemo(() => {
    if (!body) return null;
    // Plot a bit beyond the atmosphere ceiling so the curve clearly bottoms
    // out before the chart edge; airless bodies short-circuit above.
    const ceiling = config?.altitudeCeiling ?? body.maxAtmosphere * 1.1;
    const curve = buildPressureCurve(body, ceiling);
    if (curve && narrow) {
      // Drop the "Pressure (Body)" framing to just the body name so the
      // top-left legend chip collapses to a few glyphs instead of spanning
      // the narrow plot. The panel title already says "ATMOSPHERE".
      return { ...curve, label: body.name };
    }
    return curve;
  }, [body, config?.altitudeCeiling, narrow]);

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
    // Narrow aspect: drop the " @ N km" suffix so the right-anchored label
    // stays short and its left edge can't run into the legend / Y-ticks.
    const label = narrow
      ? formatPressure(currentPressure)
      : `${formatPressure(currentPressure)} @ ${(altitude / 1000).toFixed(0)} km`;
    return [
      {
        id: "current-pressure",
        value: currentPressure,
        axis: "primary",
        label,
        color: "var(--color-status-warning-bg)",
        dashed: false,
      },
    ];
  }, [currentPressure, altitude, narrow]);

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

  const showNoModelNotice = body?.hasAtmosphere && !body.atmosphere;
  const showNoBodyNotice = bodyName !== undefined && body === undefined;

  // Live readout chip — only meaningful when we're actually in atmosphere
  // (density picks up). Outside it, density reads ~0 / NaN and the chip is
  // noise. Also suppress on very small widgets where the chip would
  // obscure most of the chart it's annotating.
  const chipFits = cols >= 7 && rows >= 6;
  // At narrow widths the full title wraps to two lines inside the panel
  // header, stealing a row from the already-short chart. Drop to a single
  // word so the header stays one line and the plot keeps its height.
  const title = narrow ? "ATMOSPHERE" : "ATMOSPHERE PROFILE";
  const showLiveChip =
    chipFits &&
    typeof liveDensity === "number" &&
    Number.isFinite(liveDensity) &&
    liveDensity > 1e-9 &&
    body?.hasAtmosphere === true;

  return (
    <Wrap>
      <GraphSlot>
        <GraphView
          config={graphConfig}
          referenceCurves={referenceCurve ? [referenceCurve] : undefined}
          title={title}
          emptyState={
            body
              ? `No atmosphere on ${body.name}.`
              : "Waiting for body telemetry…"
          }
        />
      </GraphSlot>
      {/* `showAirlessNotice` would duplicate the GraphView empty-state
          ("No atmosphere on Mun.") that already fires when buildPressureCurve
          returns null for an airless body. Suppress the Notice for that
          case — `showNoModelNotice` and `showNoBodyNotice` stay because
          they describe a missing-data state where the chart is still
          attempting to render and the operator needs the explanation. */}
      {showNoModelNotice && body && (
        <Notice role="status">
          No atmospheric model registered for {body.name}.
        </Notice>
      )}
      {showNoBodyNotice && (
        <Notice role="status">Unknown body “{bodyName}”.</Notice>
      )}
      {showLiveChip && (
        <LiveChip role="status" aria-live="polite">
          <LiveChipRow>
            <LiveChipLabel>ρ</LiveChipLabel>
            <LiveChipValue>{formatDensity(liveDensity)}</LiveChipValue>
          </LiveChipRow>
          {typeof liveAirTemp === "number" && Number.isFinite(liveAirTemp) && (
            <LiveChipRow>
              <LiveChipLabel>Air</LiveChipLabel>
              <LiveChipValue>{formatTempC(liveAirTemp)}</LiveChipValue>
            </LiveChipRow>
          )}
          {typeof liveSkinTemp === "number" &&
            Number.isFinite(liveSkinTemp) && (
              <LiveChipRow>
                <LiveChipLabel>Skin</LiveChipLabel>
                <LiveChipValue>{formatTempC(liveSkinTemp)}</LiveChipValue>
              </LiveChipRow>
            )}
        </LiveChip>
      )}
    </Wrap>
  );
}

function formatDensity(d: number): string {
  const abs = Math.abs(d);
  if (abs >= 1) return `${d.toFixed(3)} kg/m³`;
  if (abs >= 1e-3) return `${(d * 1000).toFixed(2)} g/m³`;
  return `${d.toExponential(2)} kg/m³`;
}

function formatTempC(k: number): string {
  return `${kelvinToCelsius(k).toFixed(0)} °C`;
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

/* Notice sits below the chart as a normal flow row rather than an
   absolute overlay — the absolute version covered the x-axis tick
   labels at narrow heights. The LiveChip remains a HUD-style overlay
   (sized down via showLiveChip on small widgets). */
const Notice = styled.div`
  flex: 0 0 auto;
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
  background: rgba(0, 0, 0, 0.7);
  padding: 2px 6px;
  border-radius: 2px;
  pointer-events: none;
  align-self: flex-start;
  max-width: 100%;
  margin-top: 4px;
`;

const GraphSlot = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
`;

const LiveChip = styled.div`
  position: absolute;
  /* Bottom-right keeps the chip clear of the threshold label (which
     renders near the threshold line, usually high up in the chart for
     high-pressure altitudes) and the chart legend (top-left). */
  bottom: 32px;
  right: 8px;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.75);
  border: 1px solid var(--color-surface-raised);
  border-radius: 2px;
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
`;

const LiveChipRow = styled.div`
  display: grid;
  grid-template-columns: 28px auto;
  gap: 6px;
  align-items: baseline;
`;

const LiveChipLabel = styled.span`
  color: var(--color-text-faint);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: 9px;
`;

const LiveChipValue = styled.span`
  color: var(--color-text-primary);
  font-size: 11px;
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
  dataRequirements: [
    "v.altitude",
    "v.body",
    "v.atmosphericDensity",
    "v.atmosphericTemperature",
    "v.externalTemperature",
  ],
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { AtmosphereProfileComponent };
