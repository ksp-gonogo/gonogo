import type { BodyDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  orbitalPeriod,
  registerComponent,
} from "@ksp-gonogo/core";
import { useStream } from "@ksp-gonogo/sitrep-client";
import {
  deriveReading,
  type Reading,
  type TrackingStationCatalog,
  type Value,
  type VesselIdentity,
  type VesselOrbit,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { EmptyState, Panel, Section } from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import {
  type ComputedSeries,
  GraphView,
  type GraphViewConfig,
  ReadoutRows,
  type ReferenceCurve,
} from "../Graph";
import { useBodyName, useParentBodyIndex } from "../shared/useBodyName";
import { useComputedSeries } from "../shared/useComputedSeries";
import { useStreamBody } from "../shared/useStreamBody";
import { useTrajectoryKind } from "../shared/useTrajectoryKind";
import read from "./kepler-period.declarations.g";

const topics = defineTopicManifest({
  // The reference curve needs the body's radius and gravitational parameter from `trackingStation.bodies`.
  channels: [
    "vessel.orbit",
    "vessel.identity",
    "trackingStation.bodies",
    "trackingStation.catalog",
  ],
  fields: [
    "vessel.orbit.sma",
    "vessel.orbit.mu",
    "vessel.orbit.referenceBodyIndex",
    "vessel.identity.parentBodyIndex",
    "trackingStation.bodies",
    "trackingStation.catalog",
  ],
});

/** The current orbit's period, computed here: the wire carries no `period`. */
const CURRENT_PERIOD_KEY = "kepler-period.currentPeriod";

/**
 * Kepler's third law on the orbit's own elements: `2π·√(sma³/μ)`. `null` for a
 * non-positive semi-major axis, which is an escape trajectory and has no
 * period.
 */
function periodOf(sma: number, mu: number): number | null {
  return sma > 0 && mu > 0
    ? 2 * Math.PI * Math.sqrt((sma * sma * sma) / mu)
    : null;
}

export interface KeplerPeriodConfig {
  /** Seconds of trace history retained; short, since the SMA is constant between manoeuvres. */
  windowSec?: number;
  /** Override the auto-derived upper SMA bound for the reference curve (metres). */
  smaCeiling?: number;
}

const REFERENCE_SAMPLES = 60;

// BodyDefinition carries no SOI; radius x 50 is well above any realistic resonant orbit.
function defaultCeiling(body: BodyDefinition): number {
  return Math.max(body.radius * 50, 10_000_000);
}

function buildPeriodCurve(
  body: BodyDefinition,
  ceiling: number,
): ReferenceCurve | null {
  if (body.gm === undefined) return null;
  const floor = body.radius;
  // Log-spaced X so the low-orbit region (where it's most useful) gets proper resolution despite the wide SMA range.
  const logFloor = Math.log10(floor);
  const logCeil = Math.log10(ceiling);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= REFERENCE_SAMPLES; i++) {
    const exp = logFloor + ((logCeil - logFloor) * i) / REFERENCE_SAMPLES;
    const sma = 10 ** exp;
    const T = orbitalPeriod(body, sma);
    if (T === undefined) continue;
    xs.push(sma);
    ys.push(T);
  }
  return {
    id: "kepler-period",
    label: `Period vs SMA (${body.name})`,
    xs,
    ys,
    color: "var(--color-tag-blue-fg)",
  };
}

interface CatalogOrbit {
  orbitalPeriod: Reading<Value<"s">>;
  semiMajorAxis: Reading<Value<"m">>;
}

/**
 * The active vessel's period and semi-major axis from its tracking station
 * catalog entry, for a widget opened while the wire carries no `vessel.orbit`.
 * Both are held readings, since the catalog is the last word on the orbit and
 * not a live sample. `undefined` when `enabled` is false or the catalog has no
 * orbit, or no known gravitational parameter for the body, to work from.
 */
function useCatalogOrbit(enabled: boolean): CatalogOrbit | undefined {
  const identity = useStream<VesselIdentity>("vessel.identity");
  const catalog = useStream<TrackingStationCatalog>("trackingStation.catalog");
  const vesselId =
    identity.state === "observed" || identity.state === "held"
      ? identity.value.vesselId
      : undefined;
  const entry =
    catalog.state === "observed" || catalog.state === "held"
      ? catalog.value.entries.find((e) => e.vesselId === vesselId)
      : undefined;
  const body = useStreamBody(useBodyName(entry?.bodyIndex ?? undefined));
  if (
    !enabled ||
    entry === undefined ||
    (catalog.state !== "observed" && catalog.state !== "held")
  ) {
    return undefined;
  }
  const sma = entry.orbit?.sma;
  if (sma == null || body?.gm === undefined) return undefined;
  const seconds = periodOf(sma.in("m").valueOf(), body.gm);
  if (seconds === null) return undefined;
  const asOfUt = catalog.state === "held" ? catalog.asOfUt : catalog.atUt;
  const grade = catalog.state === "held" ? catalog.grade : undefined;
  const held = <T,>(v: T): Reading<T> =>
    ({
      state: "held",
      value: v,
      asOfUt,
      grade,
      reckoning: { status: "none" },
    }) as Reading<T>;
  return {
    orbitalPeriod: held(value("s", seconds)),
    semiMajorAxis: held(sma),
  };
}

function KeplerPeriodComponent({
  config,
}: Readonly<ComponentProps<KeplerPeriodConfig>>) {
  const bodyName = useBodyName(useParentBodyIndex());
  const orbitReading = useStream<VesselOrbit>("vessel.orbit");
  const referenceBody = useBodyName(
    orbitReading.state === "observed" || orbitReading.state === "held"
      ? orbitReading.value.referenceBodyIndex
      : undefined,
  );
  // The orbit's reference body wins over the vessel's parent body, which lags during an SOI transition.
  const body = useStreamBody(referenceBody, bodyName);

  const windowSec = config?.windowSec ?? 60;
  const periodData = useComputedSeries(
    { topic: "vessel.orbit", field: "sma" },
    { topic: "vessel.orbit", field: "mu" },
    windowSec,
    periodOf,
  );
  const computedSeries = useMemo<ComputedSeries[]>(
    () => [
      {
        meta: { key: CURRENT_PERIOD_KEY, label: "Current orbit", unit: "s" },
        data: periodData,
      },
    ],
    [periodData],
  );

  const referenceCurve = useMemo(() => {
    if (!body) return null;
    const ceiling = config?.smaCeiling ?? defaultCeiling(body);
    return buildPeriodCurve(body, ceiling);
  }, [body, config?.smaCeiling]);

  // Scatter, never a line: consecutive samples share an SMA and a line would join them misleadingly.
  const graphConfig: GraphViewConfig = useMemo(
    () => ({
      series: [
        {
          id: "current-orbit",
          source: { topic: CURRENT_PERIOD_KEY },
          label: "Current orbit",
          axis: "primary",
          type: "scatter",
        },
      ],
      windowSec,
      x: { topic: "vessel.orbit", field: "sma" },
      // SMA spans many orders of magnitude across the system, log scale makes both sides of the curve readable.
      yScalePrimary: "log",
      xLabel: "Semi-major axis",
      xUnit: "m",
      yLabel: "Orbital period",
      yUnit: "s",
    }),
    [windowSec],
  );

  const orbitTelemetry = topics.useTelemetry("vessel.orbit");

  const showNoGmNotice = body !== undefined && body.gm === undefined;
  const showNoBodyNotice = bodyName !== undefined && body === undefined;

  const orbitKnown =
    orbitReading.state === "observed" || orbitReading.state === "held";
  const escaping = orbitKnown && orbitReading.value.sma.isNegative();

  const kind = useTrajectoryKind();
  const offOrbit = kind === "landed" || kind === "suborbital";

  /*
   * With no sample of the orbit in the plot's window (the widget opened
   * after the last frame, or the orbit aged out) the plot would only wait, so
   * the figures stand alone: from the held orbit when there is one, else from
   * the craft's tracking station catalog entry.
   */
  const noSamples = periodData.t.length === 0;
  const catalogOrbit = useCatalogOrbit(!orbitKnown && noSamples);
  let heldOrbit = catalogOrbit;
  if (orbitReading.state === "held" && noSamples) {
    const seconds = periodOf(
      orbitReading.value.sma.valueOf(),
      orbitReading.value.mu.valueOf(),
    );
    if (seconds !== null) {
      heldOrbit = {
        orbitalPeriod: deriveReading(
          orbitTelemetry,
          () => value("s", seconds),
          () => value("s", seconds),
        ),
        semiMajorAxis: deriveReading(
          orbitTelemetry,
          () => orbitReading.value.sma,
          () => orbitReading.value.sma,
        ),
      };
    }
  }
  if (!offOrbit && heldOrbit !== undefined) {
    return (
      <Panel
        panelTitle="KEPLER PERIOD"
        sections={
          <Section full>
            <ReadoutRows
              stacked
              rows={[
                { label: "Orbital period", value: heldOrbit.orbitalPeriod },
                { label: "Semi-major axis", value: heldOrbit.semiMajorAxis },
              ]}
            />
          </Section>
        }
      />
    );
  }

  const notice =
    (!orbitKnown && "No orbit reported: nothing to plot yet.") ||
    (kind === "landed" && "Landed: no orbit.") ||
    (kind === "suborbital" && "Suborbital: periapsis below the surface.") ||
    (escaping && "On an escape trajectory: no orbital period.") ||
    (showNoGmNotice &&
      body &&
      `No reference data for ${body.name}: plotting trace only.`) ||
    (showNoBodyNotice && `Unknown body “${bodyName}”: plotting trace only.`) ||
    undefined;

  // A craft with no orbit has no period to plot against, so the message stands alone rather than beside empty axes and a legend.
  if (offOrbit && notice !== undefined) {
    return (
      <Panel
        panelTitle="KEPLER PERIOD"
        sections={
          <Section full>
            <EmptyState>{notice}</EmptyState>
          </Section>
        }
      />
    );
  }

  return (
    // gonogo:reads vessel.orbit
    <GraphView
      config={graphConfig}
      computedSeries={computedSeries}
      referenceCurves={referenceCurve ? [referenceCurve] : undefined}
      title="KEPLER PERIOD"
      notice={notice}
      plotReadout={(room) => {
        const { present } = room;
        // A period is the orbit's, and a craft that rests on a body or meets its surface has none to read.
        if (offOrbit) return undefined;
        /* The figures keep the orbit reading's currency and are the plot's own newest sample, so a period is never shown for an orbit the plot has no sample of. */
        let period = present
          ? deriveReading(
              orbitTelemetry,
              () => value("s", present.y),
              () => value("s", present.y),
            )
          : undefined;
        let semiMajorAxis = present
          ? deriveReading(
              orbitTelemetry,
              () => value("m", present.x),
              () => value("m", present.x),
            )
          : undefined;
        if (!present) {
          /* A coasting craft's orbit carried through a blackout has aged out of the plot's window but is still the orbit, so its figures are solved from the elements the model carries. */
          const carried =
            orbitReading.state === "held" &&
            orbitReading.reckoning.status === "available";
          if (!carried) return undefined;
          const elements = orbitReading.value;
          const seconds = periodOf(
            elements.sma.valueOf(),
            elements.mu.valueOf(),
          );
          if (seconds === null) return undefined;
          period = deriveReading(
            orbitTelemetry,
            () => value("s", seconds),
            () => value("s", seconds),
          );
          semiMajorAxis = deriveReading(
            orbitTelemetry,
            () => value("m", elements.sma.valueOf()),
            () => value("m", elements.sma.valueOf()),
          );
        }
        if (period === undefined || semiMajorAxis === undefined) {
          return undefined;
        }
        return (
          <ReadoutRows
            stacked={room.compact}
            rows={[
              { label: "Orbital period", value: period },
              { label: "Semi-major axis", value: semiMajorAxis },
            ]}
          />
        );
      }}
    />
  );
}

registerComponent<KeplerPeriodConfig>({
  id: "kepler-period",
  name: "Kepler Period",
  description:
    "Orbital period against semi-major axis, with your orbit marked.",
  tags: ["telemetry", "graph", "orbit"],
  defaultSize: { w: 10, h: 8 },
  minSize: { w: 5, h: 4 },
  mobileHeight: 280,
  component: KeplerPeriodComponent,
  channels: topics.channels,
  ...read,
  fields: topics.fields,
  defaultConfig: { windowSec: 60 },
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { KeplerPeriodComponent };
