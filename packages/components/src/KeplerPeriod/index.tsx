import type { BodyDefinition, ComponentProps } from "@ksp-gonogo/core";
import { getBody, orbitalPeriod, registerComponent } from "@ksp-gonogo/core";
import { useStream, type VesselState } from "@ksp-gonogo/sitrep-client";
import { useMemo } from "react";
import styled from "styled-components";
import { type GraphConfig, GraphView, type ReferenceCurve } from "../Graph";

export interface KeplerPeriodConfig {
  /**
   * Seconds of trace history retained. Kept short by default — the SMA
   * doesn't change between manoeuvres, so a long buffer just stacks
   * thousands of redundant dots on top of each other.
   */
  windowSec?: number;
  /** Override the auto-derived upper SMA bound for the reference curve (metres). */
  smaCeiling?: number;
}

const REFERENCE_SAMPLES = 60;

// Sample log-spaced SMAs from just above the surface up to a few-tens-of-radii
// ceiling. The body's actual SOI isn't in BodyDefinition, but radius × 50 is
// well above any realistic resonant-constellation orbit.
function defaultCeiling(body: BodyDefinition): number {
  return Math.max(body.radius * 50, 10_000_000);
}

function buildPeriodCurve(
  body: BodyDefinition,
  ceiling: number,
): ReferenceCurve | null {
  if (body.gm === undefined) return null;
  const floor = body.radius;
  // Log-spaced X so the low-orbit region (where it's most useful) gets
  // proper resolution despite the wide SMA range.
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
  // Both reads are clean stream homes: `v.body` streams from the
  // SDK-derived `vessel.state.parentBodyName` display map, `o.referenceBody`
  // from `vessel.state.referenceBodyName` (index→name resolution against
  // `system.bodies`, see `vessel-state.ts`). `useTelemetry`'s legacy two-arg
  // form routes them through `mapTopic` onto those derived topics.
  const bodyName = useStream<VesselState>("vessel.state")?.parentBodyName;
  const referenceBody =
    useStream<VesselState>("vessel.state")?.referenceBodyName;
  // o.referenceBody is the authoritative answer for the body the orbit is
  // around (matters during SOI transitions); fall back to v.body for cases
  // where the orbital reference hasn't been published yet.
  const body = useMemo(() => {
    return (
      (referenceBody && getBody(referenceBody)) ||
      (bodyName && getBody(bodyName)) ||
      undefined
    );
  }, [bodyName, referenceBody]);

  const windowSec = config?.windowSec ?? 60;

  const referenceCurve = useMemo(() => {
    if (!body) return null;
    const ceiling = config?.smaCeiling ?? defaultCeiling(body);
    return buildPeriodCurve(body, ceiling);
  }, [body, config?.smaCeiling]);

  // Plot current period vs current SMA as scatter dots — one fresh dot per
  // sample, all stacked at the live position. Anything other than scatter
  // would draw misleading lines connecting consecutive samples that share
  // the same SMA.
  const graphConfig: GraphConfig = useMemo(
    () => ({
      series: [
        {
          id: "current-orbit",
          key: "o.period",
          label: "Current orbit",
          axis: "primary",
          type: "scatter",
        },
      ],
      windowSec,
      xKey: "o.sma",
      // SMA spans many orders of magnitude across the system — log scale
      // makes both sides of the curve readable.
      yScalePrimary: "log",
    }),
    [windowSec],
  );

  const showNoGmNotice = body !== undefined && body.gm === undefined;
  const showNoBodyNotice = bodyName !== undefined && body === undefined;

  return (
    <Wrap>
      <GraphSlot>
        <GraphView
          config={graphConfig}
          referenceCurves={referenceCurve ? [referenceCurve] : undefined}
          title="KEPLER PERIOD"
        />
      </GraphSlot>
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

const GraphSlot = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
`;

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
   labels at narrow heights. Shrinking the chart by ~24px is a fair
   trade for keeping the axis legible while the degraded-state message
   is visible. */
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
  dataRequirements: ["o.sma", "o.period", "o.referenceBody", "v.body"],
  defaultConfig: { windowSec: 60 },
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { KeplerPeriodComponent };
