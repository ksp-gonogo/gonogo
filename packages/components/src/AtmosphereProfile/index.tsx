import type { ComponentProps } from "@ksp-gonogo/core";
import { defineTopicManifest, registerComponent } from "@ksp-gonogo/core";
import { deriveReading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { Fill, writeQuantity } from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import { type GraphThreshold, GraphView, type GraphViewConfig } from "../Graph";
import { magnitudeOf } from "../shared/magnitude";
import type { StreamBody } from "../shared/streamBody";
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
   * density decides whether it is in atmosphere at all, so a held record
   * withholds the chip; the marked altitude line says the record went quiet.
   */
  const flightReading = topics.useTelemetry("vessel.flight");
  /* The conic moves only altitude and orbital speed, not the three atmospheric numbers; the spread overlays the modelled fields on the observation. */
  const flightObserved =
    flightReading.state === "observed" || flightReading.state === "held"
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
  const altitude = (flight ?? flightObserved)?.altitudeAsl;
  const liveDensity = flight?.atmDensity;

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

  /**
   * No vertical marker in the chart engine, so a horizontal line at the
   * pressure of the craft's altitude stands in. It is a reading of its own: the
   * pressure at the altitude observed, and at the altitude the conic carries
   * the craft to, so the chart draws whichever the flight reading supports and
   * marks a held or modelled one.
   */
  const pressureReading = useMemo(
    () =>
      body
        ? deriveReading(
            flightReading,
            (observed) => pressureAt(body, observed.altitudeAsl),
            (modelled) => pressureAt(body, modelled.altitudeAsl),
          )
        : undefined,
    [body, flightReading],
  );

  const thresholds: GraphThreshold[] | undefined = useMemo(() => {
    if (pressureReading === undefined || altitude == null) return undefined;
    return [
      {
        id: "current-pressure",
        value: pressureReading,
        kind: "marker",
        // Narrow: the pressure alone, so the right-anchored label stays short.
        label: narrow
          ? undefined
          : `At ${writeQuantity(altitude, { decimals: 0 })}`,
      },
    ];
  }, [pressureReading, altitude, narrow]);

  const graphConfig: GraphViewConfig = useMemo(
    () => ({
      // No live series: a body-aware reference plot, with the marker at the current altitude's pressure.
      series: [],
      windowSec: 60,
      x: { topic: "vessel.flight", field: "altitudeAsl" },
      yScalePrimary: "log",
    }),
    [],
  );

  const showNoModelNotice =
    body?.hasAtmosphere === true && !body.pressureProfile && !body.atmosphere;
  const showNoBodyNotice = bodyName !== undefined && body === undefined;
  // No airless notice: the empty state already says so. The other two describe missing data while the chart still renders.
  const notice =
    (showNoModelNotice &&
      body &&
      `No atmospheric model registered for ${body.name}.`) ||
    (showNoBodyNotice && `Unknown body “${bodyName}”.`) ||
    undefined;

  // The chip only means something in atmosphere, and would obscure a small chart.
  const chipFits = cols >= 7 && rows >= 6;
  // Narrow: the full title would wrap and steal a chart row.
  const title = narrow ? "ATMOSPHERE" : "ATMOSPHERE PROFILE";
  const showLiveChip =
    chipFits &&
    liveDensity?.greaterThan(value(liveDensity.unit, 1e-9)) === true &&
    body?.hasAtmosphere === true;
  return (
    <Fill>
      <Fill grow>
        <GraphView
          config={graphConfig}
          thresholds={thresholds}
          referenceCurves={referenceCurve ? [referenceCurve] : undefined}
          title={title}
          notice={notice}
          plotAside={
            showLiveChip ? (
              <LiveAirChip
                density={flightReading.atmDensity}
                airTemp={flightReading.atmosphericTemperature}
                skinTemp={flightReading.externalTemperature}
              />
            ) : undefined
          }
          emptyState={
            body
              ? `No atmosphere on ${body.name}`
              : "Waiting for body telemetry..."
          }
        />
      </Fill>
    </Fill>
  );
}

/** The pressure at an altitude, or nothing where the body has none there: a log axis cannot place zero. */
function pressureAt(
  body: StreamBody,
  altitude: Value<"m"> | null | undefined,
): Value<"Pa"> | undefined {
  const metres = magnitudeOf(altitude);
  if (metres === null) return undefined;
  const pascals = pressureFor(body, metres);
  return pascals !== undefined && pascals > 0
    ? value("Pa", pascals)
    : undefined;
}

registerComponent<AtmosphereProfileConfig>({
  id: "atmosphere-profile",
  name: "Atmosphere Profile",
  description:
    "Atmospheric pressure as a function of altitude (log Y) for the current body. A horizontal marker stands at the pressure of the vessel's current altitude.",
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
