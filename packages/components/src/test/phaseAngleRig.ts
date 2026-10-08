import type { PropagationHorizonLike } from "@ksp-gonogo/sitrep-client";
import { useSystemInstant } from "@ksp-gonogo/sitrep-client";
import { renderHook } from "@ksp-gonogo/test-utils";
import { useMemo } from "react";
import { useCelestialBodies } from "../SystemView/useCelestialBodies";
import { usePhaseAngles } from "../SystemView/usePhaseAngles";
import { ANALYTIC_UNBOUNDED_HORIZON } from "./orbitHorizon";
import { type StreamFixture, setupStreamFixture } from "./setupStreamFixture";

export const KERBIN_MU = 3.5316e12;
export const MUN_SMA = 12_000_000;

const RAD = Math.PI / 180;

export interface MoonSpec {
  index: number;
  name: string;
  /** Longitude of the node, degrees. */
  lan?: number;
  /** Argument of periapsis, degrees. */
  argPe?: number;
  /** Inclination, degrees. */
  inc?: number;
  /** Mean anomaly at epoch 0, degrees. */
  anomalyDeg?: number;
  sma?: number;
  /** An integrating provider's bound on these elements; absent for a fixed orbit. */
  untilUt?: number;
  /** Leave the orbit off, as a body does while it resyncs. */
  noElements?: boolean;
}

/** A `system.bodies` payload: Kerbin as the root, and these bodies orbiting it. */
export function systemBodies(moons: readonly MoonSpec[]) {
  return {
    bodies: [
      {
        index: 0,
        name: "Kerbin",
        parentIndex: null,
        radius: 600_000,
        gravParameter: KERBIN_MU,
        orbit: null,
      },
      ...moons.map((m) => ({
        index: m.index,
        name: m.name,
        parentIndex: 0,
        radius: 200_000,
        gravParameter: 6.5e10,
        orbit: m.noElements
          ? null
          : {
              sma: m.sma ?? MUN_SMA,
              ecc: 0,
              inc: m.inc ?? 0,
              lan: m.lan ?? 0,
              argPe: m.argPe ?? 0,
              meanAnomalyAtEpoch: (m.anomalyDeg ?? 0) * RAD,
              epoch: 0,
            },
        horizon:
          m.untilUt === undefined
            ? undefined
            : { kind: 2, trajectoryKind: 2, untilUt: m.untilUt },
      })),
    ],
  };
}

/** A circular vessel orbit of Kerbin at true longitude `lonDeg` at UT 0, carrying the stock analytic horizon; a sample with no horizon is not a licence to extrapolate. */
export function vesselAtLongitude(
  lonDeg: number,
  horizon: PropagationHorizonLike = ANALYTIC_UNBOUNDED_HORIZON,
): Record<string, unknown> {
  return {
    referenceBodyIndex: 0,
    sma: 700_000,
    ecc: 0,
    inc: 0,
    lan: lonDeg,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
    mu: KERBIN_MU,
    horizon,
  };
}

/** `usePhaseAngles` over the named bodies, through a real `TelemetryProvider`. */
export function renderPhaseAngles(
  names: readonly string[],
  fixture: StreamFixture = setupStreamFixture({
    pinnedUt: 0,
    suspendFrames: true,
  }),
) {
  const { result, rerender } = renderHook(
    ({ n }: { n: readonly string[] }) => {
      const poses = useSystemInstant();
      const all = useCelestialBodies();
      const drawn = useMemo(
        () => all.filter((b) => b.name !== null && n.includes(b.name)),
        [all, n],
      );
      return usePhaseAngles(drawn, poses);
    },
    { wrapper: fixture.Provider, initialProps: { n: names } },
  );
  return { fixture, result, rerender };
}
