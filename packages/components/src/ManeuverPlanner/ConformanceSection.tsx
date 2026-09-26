import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import { SectionTitle, Stack } from "@ksp-gonogo/ui-kit";
import { BurnConformanceRow } from "./BurnConformanceRow";
import { ConformancePlot } from "./ConformancePlot";
import { burnConformance } from "./conformance";
import { conformanceRegime, finiteBurnResidual } from "./conformanceRegime";
import { PaddedSection } from "./styles";
import type { PlannerTelemetry } from "./usePlannerTelemetry";

interface ConformanceSectionProps {
  nodes: readonly ParsedManeuverNode[];
  maxDvByUt: ReadonlyMap<number, number>;
  telemetry: PlannerTelemetry;
}

/**
 * What each burn was planned with against what it has delivered, whoever
 * planned it. The planned figure is the tracker's `maxDvByUt`, since one sample
 * cannot tell a 300 m/s burn with 300 to go from a 1000 m/s one.
 */
export function ConformanceSection({
  nodes,
  maxDvByUt,
  telemetry,
}: ConformanceSectionProps) {
  const {
    sma,
    ecc,
    ApR,
    PeR,
    trueAnomaly,
    argPe,
    thrustLatch,
    currentTrajectory,
    currentUT,
    period,
    elementsNeedDating,
  } = telemetry;
  if (nodes.length === 0) return null;
  const current =
    sma !== undefined &&
    ecc !== undefined &&
    ApR !== undefined &&
    PeR !== undefined &&
    trueAnomaly !== undefined
      ? {
          sma,
          ecc,
          apoapsis: ApR,
          periapsis: PeR,
          trueAnomaly,
          argPe: argPe ?? 0,
        }
      : null;
  return (
    <PaddedSection>
      <SectionTitle as="h4">Conformance</SectionTitle>
      <Stack>
        {nodes.map((node) => {
          const first = node.orbitPatches[0];
          // One conformance reading feeds both the row and the plot's regime, so they cannot contradict.
          const conformance = burnConformance(
            node.deltaVMagnitude,
            maxDvByUt.get(node.UT) ?? null,
            thrustLatch,
          );
          return (
            <Stack key={node.UT}>
              <BurnConformanceRow conformance={conformance} />
              <ConformancePlot
                current={current}
                currentTrajectory={currentTrajectory}
                // Patches[0] only: a downstream patch cannot be compared (see ConformancePlot).
                planned={
                  first
                    ? {
                        sma: first.sma,
                        ecc: first.eccentricity,
                        apoapsis: first.ApA,
                        periapsis: first.PeA,
                        argPe: first.argumentOfPeriapsis,
                      }
                    : null
                }
                regime={conformanceRegime(
                  {
                    ut: node.UT,
                    ignitionUt: node.ignitionUt,
                    cutoffUt: node.cutoffUt,
                  },
                  currentUT,
                  conformance.deliveredDv,
                  node.deltaVMagnitude,
                )}
                residual={finiteBurnResidual(
                  node.ignitionUt != null && node.cutoffUt != null
                    ? node.cutoffUt - node.ignitionUt
                    : null,
                  period,
                )}
                // The planned conic is authored and never dims; only the current orbit follows the observation rules.
                currentIsObserved={!elementsNeedDating}
              />
            </Stack>
          );
        })}
      </Stack>
    </PaddedSection>
  );
}
