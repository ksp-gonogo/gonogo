import type { BodyDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  orbitalPeriod,
  registerComponent,
} from "@ksp-gonogo/core";
import { useStream } from "@ksp-gonogo/sitrep-client";
import type { VesselOrbit } from "@ksp-gonogo/sitrep-sdk";
import { Fill, GraphNotice } from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import {
  type ComputedSeries,
  type GraphConfig,
  GraphView,
  type ReferenceCurve,
} from "../Graph";
import { useBodyName, useParentBodyIndex } from "../shared/useBodyName";
import { useComputedSeries } from "../shared/useComputedSeries";
import { useStreamBody } from "../shared/useStreamBody";

const topics = defineTopicManifest({
  // The reference curve needs the body's radius and gravitational parameter from `system.bodies`.
  channels: ["vessel.orbit", "vessel.identity", "system.bodies"],
  fields: [
    "vessel.orbit.sma",
    "vessel.orbit.mu",
    "vessel.orbit.referenceBodyIndex",
    "vessel.identity.parentBodyIndex",
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

function KeplerPeriodComponent({
  config,
}: Readonly<ComponentProps<KeplerPeriodConfig>>) {
  const bodyName = useBodyName(useParentBodyIndex());
  const orbitReading = useStream<VesselOrbit>("vessel.orbit");
  const referenceBody = useBodyName(
    orbitReading.state === "observed" || orbitReading.state === "stale"
      ? orbitReading.value.referenceBodyIndex
      : undefined,
  );
  // The orbit's reference body wins over the vessel's parent body, which lags during an SOI transition.
  const body = useStreamBody(referenceBody, bodyName);

  const windowSec = config?.windowSec ?? 60;
  const periodData = useComputedSeries(
    "vessel.orbit.sma",
    "vessel.orbit.mu",
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
  const graphConfig: GraphConfig = useMemo(
    () => ({
      series: [
        {
          id: "current-orbit",
          key: CURRENT_PERIOD_KEY,
          label: "Current orbit",
          axis: "primary",
          type: "scatter",
        },
      ],
      windowSec,
      xKey: "vessel.orbit.sma",
      // SMA spans many orders of magnitude across the system, log scale makes both sides of the curve readable.
      yScalePrimary: "log",
    }),
    [windowSec],
  );

  const showNoGmNotice = body !== undefined && body.gm === undefined;
  const showNoBodyNotice = bodyName !== undefined && body === undefined;

  return (
    <Fill>
      <Fill grow>
        <GraphView
          config={graphConfig}
          computedSeries={computedSeries}
          referenceCurves={referenceCurve ? [referenceCurve] : undefined}
          title="KEPLER PERIOD"
        />
      </Fill>
      {showNoGmNotice && body && (
        <GraphNotice placement="inline">
          No reference data for {body.name}: plotting trace only.
        </GraphNotice>
      )}
      {showNoBodyNotice && (
        <GraphNotice placement="inline">
          Unknown body “{bodyName}”: plotting trace only.
        </GraphNotice>
      )}
    </Fill>
  );
}

registerComponent<KeplerPeriodConfig>({
  id: "kepler-period",
  name: "Kepler Period",
  description:
    "Orbital period as a function of semi-major axis (Kepler's third law) with the current orbit marked. Useful for resonant orbit setups (sat constellations, rescue rendezvous).",
  tags: ["telemetry", "graph", "orbit"],
  defaultSize: { w: 10, h: 8 },
  minSize: { w: 5, h: 4 },
  mobileHeight: 280,
  component: KeplerPeriodComponent,
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: { windowSec: 60 },
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { KeplerPeriodComponent };
