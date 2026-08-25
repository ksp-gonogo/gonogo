import type { BodyDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  getBody,
  pressureAtAltitude,
  registerComponent,
} from "@ksp-gonogo/core";
import {
  type Reading,
  useStream,
  type VesselState,
} from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { Fill, speakQuantity, Unit, writeQuantity } from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import {
  type GraphConfig,
  type GraphThresholdConfig,
  GraphView,
  type ReferenceCurve,
} from "../Graph";
import { formatDensity } from "../shared/formatDensity";
import { magnitudeOf } from "../shared/magnitude";

export interface AtmosphereProfileConfig {
  /** Override the auto-derived altitude ceiling for the curve (metres). */
  altitudeCeiling?: number;
}

const topics = defineTopicManifest({ channels: ["vessel.flight"] });

const REFERENCE_SAMPLES = 80;

/**
 * The value a VERDICT may be drawn from: current, or modelled forward to the frame.
 * A stale reading gives nothing, because a judgement cannot be dated: the operator
 * reads a band or a pill as the situation NOW.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

/** Whether a reading went stale, as opposed to never having arrived. */
function notCurrent<T>(reading: Reading<T>): boolean {
  return reading.state === "stale";
}

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
    // the atmosphere has ended, stop the curve there rather than dragging a
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
  // Canonical native reads: `v.body`/`v.altitude` off the `vessel.state`
  // derived channel (SDK-side `deriveVesselState`: `parentBodyName`/
  // `altitudeAsl`), `v.atmosphericDensity`/`v.atmosphericTemperature`/
  // `v.externalTemperature` off the raw `vessel.flight` Topic: replacing
  // every legacy two-arg `data`-source shim read this widget used to make.
  const vesselState = useStream<VesselState>("vessel.state");
  /**
   * All three atmospheric numbers are quantities that drift on their own as the
   * craft climbs or dives, and the HUD chip states them as the air the craft is
   * flying through: an undated three-row overlay pinned to the plot, with no
   * room for an "as of" and no reading of it other than "now". Density is the
   * stronger case still, because it also decides whether the craft counts as
   * being in atmosphere at all. So a stale record is withheld and the notice
   * names the reason, rather than the chip holding a sea-level density over a
   * craft that has since left the air.
   */
  const flightReading = topics.useTelemetry("vessel.flight");
  const flight = judgeable(flightReading);
  const flightNotCurrent = notCurrent(flightReading);
  const bodyName = vesselState?.parentBodyName ?? undefined;
  const body = bodyName ? getBody(bodyName) : undefined;
  const altitude = vesselState?.altitudeAsl ?? undefined;
  // Magnitudes: all three feed threshold checks and the chart's own
  // number-taking readouts.
  const liveDensity = magnitudeOf(flight?.atmDensity);
  const liveAirTemp = magnitudeOf(flight?.atmosphericTemperature);
  const liveSkinTemp = magnitudeOf(flight?.externalTemperature);

  const cols = w ?? 8;
  const rows = h ?? 8;
  // At extreme tall-narrow aspects (portrait-5x18) the plot is only a few
  // columns wide. The shared LineChart stamps the series legend top-left and
  // right-anchors the threshold label at the plot's right edge; on a wide
  // chart they sit at opposite ends, but on a narrow plot the right-anchored
  // threshold label sweeps left across the whole plot and collides with both
  // the legend chip and the Y-axis tick labels. We can't reposition either
  // element (that's shared LineChart chrome), but both *strings* are
  // widget-owned: shortening them pulls the right-anchored label's left edge
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
      : `${formatPressure(currentPressure)} @ ${writeQuantity(value("m", altitude), { decimals: 0 })}`;
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
      // No live series: the widget is a static body-aware reference plot
      // with the threshold pulling out the current altitude's pressure.
      series: [],
      windowSec: 60,
      xKey: "vessel.state.altitudeAsl",
      yScalePrimary: "log",
      thresholds,
    }),
    [thresholds],
  );

  const showNoModelNotice = body?.hasAtmosphere && !body.atmosphere;
  const showNoBodyNotice = bodyName !== undefined && body === undefined;

  // Live readout chip: only meaningful when we're actually in atmosphere
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
    liveDensity !== null &&
    liveDensity > 1e-9 &&
    body?.hasAtmosphere === true;
  /* The chip vanishes for three unrelated reasons (nothing has arrived, a
     confirmed vacuum, a stale record) and only the third is worth explaining,
     so the notice fires on staleness alone. Gated on `chipFits` because a
     widget too small to have drawn the chip has withheld nothing. */
  const showNotCurrentNotice = chipFits && flightNotCurrent;

  return (
    <Fill>
      <Fill grow>
        <GraphView
          config={graphConfig}
          referenceCurves={referenceCurve ? [referenceCurve] : undefined}
          title={title}
          emptyState={
            body
              ? `No atmosphere on ${body.name}.`
              : "Waiting for body telemetry..."
          }
        />
      </Fill>
      {/* `showAirlessNotice` would duplicate the GraphView empty-state
          ("No atmosphere on Mun.") that already fires when buildPressureCurve
          returns null for an airless body. Suppress the Notice for that
          case: `showNoModelNotice` and `showNoBodyNotice` stay because
          they describe a missing-data state where the chart is still
          attempting to render and the operator needs the explanation. */}
      {showNoModelNotice && body && (
        <div role="status" style={NOTICE_STYLE}>
          No atmospheric model registered for {body.name}.
        </div>
      )}
      {showNoBodyNotice && (
        <div role="status" style={NOTICE_STYLE}>
          Unknown body “{bodyName}”.
        </div>
      )}
      {showNotCurrentNotice && (
        <div role="status" style={NOTICE_STYLE}>
          Atmospheric readings no longer current.
        </div>
      )}
      {showLiveChip && (
        <div role="status" aria-live="polite" style={LIVE_CHIP_STYLE}>
          <div style={CHIP_ROW_STYLE}>
            <span style={CHIP_LABEL_STYLE}>ρ</span>
            <span style={CHIP_VALUE_STYLE}>{formatDensity(liveDensity)}</span>
          </div>
          {liveAirTemp !== null && (
            <div style={CHIP_ROW_STYLE}>
              <span style={CHIP_LABEL_STYLE}>Air</span>
              <span style={CHIP_VALUE_STYLE}>
                <TempC k={liveAirTemp} />
              </span>
            </div>
          )}
          {liveSkinTemp !== null && (
            <div style={CHIP_ROW_STYLE}>
              <span style={CHIP_LABEL_STYLE}>Skin</span>
              <span style={CHIP_VALUE_STYLE}>
                <TempC k={liveSkinTemp} />
              </span>
            </div>
          )}
        </div>
      )}
    </Fill>
  );
}

// Kelvin on the wire, Celsius on screen: the conversion is a presentation
// choice made through the shared unit layer, not something the wire pre-applies.
function TempC({ k }: { k: number }) {
  return <Unit value={value("K", k)} as="°C" />;
}

// A string rather than a node: this feeds a chart annotation's `label`, which
// is measured and positioned as text. `speakQuantity` gives the word instead
// of the symbol, which is the right trade for a label a reader hears.
function formatPressure(p: number): string {
  return speakQuantity(value("Pa", p));
}

/* Notice sits below the chart as a normal flow row rather than an absolute
   overlay (the absolute version covered the x-axis tick labels at narrow
   heights). Off-token rgba scrim + clearances stay as inline style: no ui-kit
   surface primitive expresses a translucent pointer-through notice. */
const NOTICE_STYLE = {
  flex: "0 0 auto",
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-faint)",
  background: "rgba(0, 0, 0, 0.7)",
  padding: "var(--space-2) var(--space-6)",
  borderRadius: "var(--radius-xs)",
  pointerEvents: "none",
  alignSelf: "flex-start",
  maxWidth: "100%",
  marginTop: "var(--space-4)",
} as const;

/* HUD-style overlay chip: absolute-positioned, off-token bottom/right measured
   clearance over the chart's tick band, local z-index 1. A bespoke positioned
   overlay has no ui-kit primitive, so it carries inline style (same treatment
   as Targeting's docking HUD). */
const LIVE_CHIP_STYLE = {
  position: "absolute",
  bottom: 32,
  right: 8,
  zIndex: 1,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-hair)",
  padding: "var(--space-4) var(--space-8)",
  background: "rgba(0, 0, 0, 0.75)",
  border: "1px solid var(--color-surface-raised)",
  borderRadius: "var(--radius-xs)",
  fontSize: "var(--font-size-xs)",
  fontVariantNumeric: "tabular-nums",
  pointerEvents: "none",
} as const;

const CHIP_ROW_STYLE = {
  display: "grid",
  gridTemplateColumns: "28px auto",
  gap: "var(--space-6)",
  alignItems: "baseline",
} as const;

const CHIP_LABEL_STYLE = {
  color: "var(--color-text-faint)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontSize: "var(--font-size-2xs)",
} as const;

const CHIP_VALUE_STYLE = {
  color: "var(--color-text-primary)",
  fontSize: "var(--font-size-xs)",
} as const;

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
  channels: topics.channels,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { AtmosphereProfileComponent };
