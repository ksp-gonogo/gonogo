import type { BodyDefinition, ComponentProps } from "@gonogo/core";
import {
  getBody,
  orbitalPeriod,
  registerComponent,
  useDataValue,
} from "@gonogo/core";
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
  const bodyName = useDataValue<string>("data", "v.body");
  const referenceBody = useDataValue<string>("data", "o.referenceBody");
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
      <GraphView
        config={graphConfig}
        referenceCurves={referenceCurve ? [referenceCurve] : undefined}
        title="KEPLER PERIOD"
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
