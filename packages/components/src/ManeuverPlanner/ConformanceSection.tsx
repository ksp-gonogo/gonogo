import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import type { OrbitPatch } from "@ksp-gonogo/sitrep-sdk";
import { EmptyState, Section, Stack } from "@ksp-gonogo/ui-kit";
import type { ProjectedOrbit } from "../shared/OrbitDiagram";
import { BurnConformanceRow } from "./BurnConformanceRow";
import {
  type BurnWatch,
  burnNeverLit,
  burnPhase,
  watchBurn,
} from "./burnFlown";
import { ConformancePlot } from "./ConformancePlot";
import type { BurnConformance } from "./conformance";
import { conformanceRegime, finiteBurnResidual } from "./conformanceRegime";
import type { PlannerTelemetry } from "./usePlannerTelemetry";

interface ConformanceSectionProps {
  nodes: readonly ParsedManeuverNode[];
  /** True until the plan has arrived, so an empty list is not read as an empty plan. */
  awaiting: boolean;
  /** Each burn's watch from the completion tracker, so this section and the tracker cannot disagree about whether a burn was flown. */
  watches: ReadonlyMap<number, BurnWatch>;
  telemetry: PlannerTelemetry;
}

/**
 * A patch's conic in the diagram's terms, whose apsides are radii from the
 * body's centre like the current orbit's. The patch carries its apsides only as
 * altitudes over its own reference body, so the radii come from the shape.
 * Null when the patch's argument of periapsis is undefined, since the ellipse
 * cannot then be oriented, and the plot draws no planned orbit.
 */
export function plannedConic(
  patch: Pick<OrbitPatch, "sma" | "ecc" | "argPe">,
): ProjectedOrbit | null {
  if (patch.argPe == null) return null;
  const sma = patch.sma.magnitude;
  const ecc = patch.ecc.magnitude;
  return {
    sma,
    ecc,
    apoapsis: sma * (1 + ecc),
    periapsis: sma * (1 - ecc),
    argPe: patch.argPe.magnitude,
  };
}

/**
 * Each burn's plan and how far the craft has got with it, whoever planned it.
 * The delta-v delivered is not on the stream, so the row carries the ask and
 * a phase read from the clock, the thrust latch and the orbit reached.
 */
export function ConformanceSection({
  nodes,
  awaiting,
  watches,
  telemetry,
}: ConformanceSectionProps) {
  const {
    sma,
    ecc,
    ApR,
    PeR,
    trueAnomaly,
    argPe,
    burnContext,
    currentTrajectory,
    nowUtSeconds,
    period,
    elementsNeedDating,
    orbitMarking,
    body,
  } = telemetry;
  if (nodes.length === 0) {
    return (
      <Section title="Conformance">
        <EmptyState>
          {awaiting ? "Awaiting maneuver plan" : "No planned burns to compare"}
        </EmptyState>
      </Section>
    );
  }
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
    <Section title="Conformance">
      <Stack>
        {nodes.map((node) => {
          const first = node.orbitPatches[0];
          // One reading feeds both the row and the plot's regime, so they cannot contradict.
          const watch =
            watches.get(node.UT) ?? watchBurn(undefined, node, burnContext);
          const conformance: BurnConformance = {
            plannedDv: Number.isFinite(node.deltaVMagnitude)
              ? node.deltaVMagnitude
              : null,
            phase: burnPhase(watch, node, burnContext),
          };
          return (
            <Stack key={node.UT}>
              <Stack
                as="ul"
                style={{ listStyle: "none", margin: 0, padding: 0 }}
              >
                <BurnConformanceRow conformance={conformance} />
              </Stack>
              <ConformancePlot
                current={current}
                currentTrajectory={currentTrajectory}
                // Patches[0] only: a downstream patch cannot be compared (see ConformancePlot).
                planned={first ? plannedConic(first) : null}
                regime={conformanceRegime(
                  {
                    ut: node.UT,
                    ignitionUt: node.ignitionUt,
                    cutoffUt: node.cutoffUt,
                  },
                  nowUtSeconds,
                  burnNeverLit(node, burnContext) ? 0 : null,
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
                marking={orbitMarking}
                bodyRadius={body?.radius}
              />
            </Stack>
          );
        })}
      </Stack>
    </Section>
  );
}
