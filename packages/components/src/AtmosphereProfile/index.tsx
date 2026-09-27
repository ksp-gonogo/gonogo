import type { ComponentProps } from "@ksp-gonogo/core";
import { defineTopicManifest, registerComponent } from "@ksp-gonogo/core";
import { readingOf, value } from "@ksp-gonogo/sitrep-sdk";
import { Fill, speakQuantity, writeQuantity } from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import {
  type GraphConfig,
  type GraphThresholdConfig,
  GraphView,
} from "../Graph";
import { magnitudeOf } from "../shared/magnitude";
import { useBodyName, useParentBodyIndex } from "../shared/useBodyName";
import { useStreamBody } from "../shared/useStreamBody";
import { LiveAirChip } from "./LiveAirChip";
import { buildPressureCurve, pressureFor } from "./pressureCurve";

export interface AtmosphereProfileConfig {
  /** Override the auto-derived altitude ceiling for the curve (metres). */
  altitudeCeiling?: number;
}

const topics = defineTopicManifest({
  channels: ["vessel.flight", "vessel.identity", "system.bodies"],
});

function AtmosphereProfileComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<AtmosphereProfileConfig>>) {
  /**
   * The chip states the air the craft is flying through now, undated, and
   * density decides whether it is in atmosphere at all, so a stale record
   * withholds the chip; the marked altitude line says the record went quiet.
   */
  const flightReading = topics.useTelemetry("vessel.flight");
  /* The conic moves only altitude and orbital speed, not the three atmospheric numbers; the spread overlays the modelled fields on the observation. */
  const flightObserved =
    flightReading.state === "observed" || flightReading.state === "stale"
      ? flightReading.value
      : undefined;
  const flight = (() => {
    if (flightObserved && flightReading.reckoning.status === "available") {
      return { ...flightObserved, ...flightReading.reckoning.value };
    }
    if (flightReading.state === "observed") return flightReading.value;
    return undefined;
  })();
  const bodyName = useBodyName(useParentBodyIndex());
  /* Resolved against the `system.bodies` roster the name came from, so a planet-pack rename resolves. */
  const body = useStreamBody(bodyName);
  /* Off the same reading as the atmospheric numbers, modelled fields overlaid. A held record with no model still places the line, which wears the held mark. */
  const altitude =
    magnitudeOf((flight ?? flightObserved)?.altitudeAsl) ?? undefined;
  // Magnitudes: all three feed threshold checks and the chart's own number-taking readouts.
  const liveDensity = magnitudeOf(flight?.atmDensity);
  const liveAirTemp = magnitudeOf(flight?.atmosphericTemperature);
  const liveSkinTemp = magnitudeOf(flight?.externalTemperature);

  const cols = w ?? 8;
  const rows = h ?? 8;
  // Shared chart chrome collides at narrow widths; shorten widget-owned labels.
  const narrow = cols < 6;

  const referenceCurve = useMemo(() => {
    if (!body) return null;
    /* Plot a bit beyond the ceiling so the curve bottoms out before the edge. A reported profile stops at its own end. */
    const ceiling = config?.altitudeCeiling ?? body.maxAtmosphere * 1.1;
    const curve = buildPressureCurve(body, ceiling);
    if (curve && narrow) {
      // Narrow: the legend chip collapses to the body name.
      return { ...curve, label: body.name };
    }
    return curve;
  }, [body, config?.altitudeCeiling, narrow]);

  // No vertical marker in the chart engine: a horizontal threshold at the live altitude's pressure stands in.
  const currentPressure = useMemo(() => {
    if (!body || altitude === undefined) return undefined;
    return pressureFor(body, altitude);
  }, [body, altitude]);

  const thresholds: GraphThresholdConfig[] | undefined = useMemo(() => {
    if (currentPressure === undefined || currentPressure <= 0) return undefined;
    if (altitude === undefined) return undefined;
    // Narrow: drop the " @ N km" suffix so the right-anchored label stays short.
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
        /* The altitude is the craft's own, so a held record marks the label. */
        reading: readingOf(flightReading, (f) => f.altitudeAsl),
        drawsReckoning: true,
      },
    ];
  }, [currentPressure, altitude, narrow, flightReading]);

  const graphConfig: GraphConfig = useMemo(
    () => ({
      // No live series: a body-aware reference plot, with the threshold marking the current altitude's pressure.
      series: [],
      windowSec: 60,
      xKey: "vessel.flight.altitudeAsl",
      yScalePrimary: "log",
      thresholds,
    }),
    [thresholds],
  );

  const showNoModelNotice =
    body?.hasAtmosphere === true && !body.pressureProfile && !body.atmosphere;
  const showNoBodyNotice = bodyName !== undefined && body === undefined;

  // The chip only means something in atmosphere, and would obscure a small chart.
  const chipFits = cols >= 7 && rows >= 6;
  // Narrow: the full title would wrap and steal a chart row.
  const title = narrow ? "ATMOSPHERE" : "ATMOSPHERE PROFILE";
  const showLiveChip =
    chipFits &&
    liveDensity !== null &&
    liveDensity > 1e-9 &&
    body?.hasAtmosphere === true;
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
      {/* No airless notice: the GraphView empty state already says so. The other two describe missing data while the chart still renders. */}
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
      {showLiveChip && (
        <LiveAirChip
          density={flightReading.atmDensity}
          airTemp={liveAirTemp}
          skinTemp={liveSkinTemp}
        />
      )}
    </Fill>
  );
}

// A string, not a node: a chart annotation label is measured as text. `speakQuantity` gives the word rather than the symbol.
function formatPressure(p: number): string {
  return speakQuantity(value("Pa", p));
}

/* A flow row below the chart, not an overlay over the x-axis ticks. The translucent pointer-through scrim has no ui-kit primitive. */
const NOTICE_STYLE = {
  flex: "0 0 auto",
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-faint)",
  background: "rgba(0, 0, 0, 0.7)",
  padding: "var(--inset-chip)",
  borderRadius: "var(--radius-regular)",
  pointerEvents: "none",
  alignSelf: "flex-start",
  maxWidth: "100%",
  marginTop: "var(--gap-sub-readout)",
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
