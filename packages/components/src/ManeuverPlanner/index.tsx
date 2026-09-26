import {
  type ActionDefinition,
  type ComponentProps,
  type CurrentOrbit,
  registerComponent,
  useOrbitSolve,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useManeuverNodes, useValueKeys } from "@ksp-gonogo/data";
import {
  type BodyRadiusTable,
  bodyRadiusOf,
  DELTA_V_BUDGET,
  type OrbitTrajectory,
  type ReckonableReading,
  solveOrbit,
  useCommand,
  useOrbitTrajectory,
  useProcessor,
  useStream,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import { stillTrue } from "@ksp-gonogo/sitrep-sdk";
import {
  EmptyState,
  Panel,
  ReadoutCaption,
  Section,
  SectionTitle,
  Stack,
  Tabs,
  usePanelDelay,
  WidgetSections,
} from "@ksp-gonogo/ui-kit";
import { useCallback, useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { magnitudeOf } from "../shared/magnitude";
import { bodyFromStream } from "../shared/streamBody";
import { TrajectoryWithheldNote } from "../shared/trajectoryWithheld";
import { useBodyName, useParentBodyIndex } from "../shared/useBodyName";
import { ArmedTriggersList } from "./ArmedTriggersList";
import { useBurnCompletionTracker } from "./BurnCompletionTracker";
import { BurnConformanceRow } from "./BurnConformanceRow";
import { BurnWindowRows } from "./BurnWindowRows";
import { ConformancePlot } from "./ConformancePlot";
import { burnConformance } from "./conformance";
import { conformanceRegime, finiteBurnResidual } from "./conformanceRegime";
import { LocalManeuverTriggerService } from "./LocalManeuverTriggerService";
import { ManeuverNodeList } from "./ManeuverNodeList";
import { ManeuverPreview } from "./ManeuverPreview";
import type { NodeEditPatch } from "./NodeRow";
import { PresetInput } from "./PresetInput";
import { describePartialDispatch } from "./partialDispatch";
import {
  buildCurrentOrbit,
  computeBurnTrueAnomaly,
  computeMu,
  computePlan,
  isSequence,
  type PlanResult,
} from "./planning";
import { isFiniteNumber, type ManeuverPlannerConfig } from "./presets";
import {
  type ManeuverTriggerService,
  useManeuverTriggerService,
  useTriggerSnapshot,
} from "./triggerService";
import type { FrozenPlanInputs, ThresholdOp } from "./triggerTypes";
import { usePlannerInputs } from "./usePlannerInputs";

const maneuverActions = [] as const satisfies readonly ActionDefinition[];

/**
 * The whole-widget append slot below the preview and feasibility check, for
 * alternate transfer strategies such as a porkchop or an optimal-transfer
 * Uplink. Declaration-merged into `SlotRegistry` so the slot carries its exact
 * empty prop shape.
 */
export type ManeuverPlannerSectionsSlotProps = Record<string, never>;

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "maneuver-planner.sections": ManeuverPlannerSectionsSlotProps;
  }
}

/**
 * A reckonable reading's value, and whether it needs an age label. The model
 * moves only its named fields, so they are overlaid on the observation:
 * `reckoned.value` alone would be a target with no name and no orbit.
 */
function dateableReckonable<T, K extends keyof T>(
  reading: ReckonableReading<T, K>,
): {
  value: T | undefined;
  needsDating: boolean;
} {
  // The state is asked first: `reckoning.status` narrows the reckoning, not the arm carrying it.
  if (
    (reading.state === "observed" || reading.state === "stale") &&
    reading.reckoning.status === "available"
  )
    return {
      value: { ...reading.value, ...reading.reckoning.value },
      needsDating: false,
    };
  if (reading.state === "observed")
    return { value: reading.value, needsDating: false };
  if (reading.state === "stale")
    return { value: reading.value, needsDating: true };
  return { value: undefined, needsDating: false };
}

function ManeuverPlannerComponent({
  config,
}: Readonly<ComponentProps<ManeuverPlannerConfig>>) {
  const inputsApi = usePlannerInputs(config);
  const {
    inputs: {
      preset,
      prograde,
      normal,
      radial,
      burnInSeconds,
      utMode,
      burnAtUT,
      targetInclination,
      targetAltitudeKm,
      standoffMeters,
    },
    setPrograde,
    setRadial,
  } = inputsApi;
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * A plan is reviewed before it is committed, so elements a few seconds old
   * still make a good plan: inputs are dated, never withheld. Never take the age
   * as `viewUt - orbit.epoch`, since `epoch` is the mean-anomaly reference
   * epoch, not an observation time; the age comes off the reading's `asOfUt`.
   */
  const orbitReading = useTelemetry("vessel.orbit");
  const targetReading = useTelemetry("vessel.target");
  const { value: orbit, needsDating: orbitNeedsDating } =
    dateableReckonable(orbitReading);
  const { value: target, needsDating: targetNeedsDating } =
    dateableReckonable(targetReading);
  const elementsNeedDating = orbitNeedsDating || targetNeedsDating;
  // The thrust latch is held on stale: it is built to survive a dropped frame, and undefined is not "engines off".
  const propulsion = stillTrue(useTelemetry("vessel.propulsion"), undefined);
  const thrustLatch = propulsion
    ? {
        // Latched, not `currentThrust > 0`, so it survives a dropped frame.
        thrusting: magnitudeOf(propulsion.thrustStartedUt) != null,
        lastThrustEndUt: magnitudeOf(propulsion.lastThrustEndUt),
      }
    : undefined;
  // The current orbit's curve is the propagation seam's answer, never a diagram's own choice.
  const currentTrajectory: OrbitTrajectory | null = useOrbitTrajectory(orbit);
  const sma = magnitudeOf(orbit?.sma) ?? undefined;
  const ecc = magnitudeOf(orbit?.ecc) ?? undefined;
  // Answers nothing wherever a conic through these elements would be wrong, which is what withholds the plan.
  const solve = useOrbitSolve();
  const ApR = solve?.apoapsisRadius ?? undefined;
  const PeR = solve?.periapsisRadius ?? undefined;
  const timeToAp = solve?.timeToAp ?? undefined;
  const timeToPe = solve?.timeToPe ?? undefined;
  const argPe = magnitudeOf(orbit?.argPe) ?? undefined;
  const trueAnomaly = solve?.trueAnomaly ?? undefined;
  const currentUT = useViewUt()?.magnitude;
  // computeMu wants a number true of the craft now: modelled where on offer, else observed.
  const orbitalSpeedReading = useTelemetry("vessel.flight").orbitalSpeed;
  const orbitalSpeed =
    magnitudeOf(
      orbitalSpeedReading.reckoning.status === "available"
        ? orbitalSpeedReading.reckoning.modelled
        : orbitalSpeedReading.state === "observed"
          ? orbitalSpeedReading.value
          : undefined,
    ) ?? undefined;
  const radius = solve?.orbitalRadius ?? undefined;
  const parentBodyIndex = useParentBodyIndex();
  const bodiesReading = useStream<BodyRadiusTable>("system.bodies");
  // The roster does not decay, and a tombstone is the one null it answers.
  const bodies =
    bodiesReading.state === "observed" || bodiesReading.state === "stale"
      ? bodiesReading.value
      : bodiesReading.state === "absent"
        ? null
        : undefined;
  const refBody = useBodyName(orbit?.referenceBodyIndex);
  const bodyName = useBodyName(parentBodyIndex);
  const parentBodyRadius = bodyRadiusOf(bodies, parentBodyIndex);
  const referenceBodyRadius = bodyRadiusOf(bodies, orbit?.referenceBodyIndex);
  const inclination = magnitudeOf(orbit?.inc) ?? undefined;
  const targetName = target?.name;
  const targetInclinationLive = magnitudeOf(target?.orbit?.inc) ?? undefined;
  const targetLanLive = magnitudeOf(target?.orbit?.lan) ?? undefined;
  const targetSma = target?.orbit?.sma;
  const targetArgPe = target?.orbit?.argPe;
  // The target's altitude needs the target's own reference body, not the craft's.
  const targetSolved =
    target?.orbit == null || currentUT === undefined
      ? undefined
      : solveOrbit(
          target.orbit,
          currentUT,
          bodyRadiusOf(bodies, target.orbit.referenceBodyIndex),
        );
  const targetPeA = targetSolved?.periapsisAlt ?? undefined;
  const targetTrueAnomaly = targetSolved?.trueAnomaly ?? undefined;
  const targetPeriod = targetSolved?.period ?? undefined;
  const lan = orbit?.lan;

  const period = solve?.period ?? undefined;

  const nodes = useManeuverNodes();
  /*
   * The game's own vessel ΔV total, never a sum of the stage rows, which come
   * from a different stage list and would disagree with the fuel panel. Held on
   * stale: `feasible === false` is the only thing that disables the commit, so a
   * budget vanishing mid-blackout would re-enable it for a craft known to be short.
   */
  const budgetReading = useProcessor(DELTA_V_BUDGET);
  const availableDeltaV = magnitudeOf(
    budgetReading?.state === "observed" || budgetReading?.state === "stale"
      ? budgetReading.value?.totalVac
      : undefined,
  );

  // Node commands actuate the flight plan, so each is subject to signal delay.
  const addNodeCmd = useCommand("vessel.maneuver.add");
  const updateNodeCmd = useCommand("vessel.maneuver.update");
  const removeNodeCmd = useCommand("vessel.maneuver.remove");
  usePanelDelay(addNodeCmd);
  usePanelDelay(updateNodeCmd);
  usePanelDelay(removeNodeCmd);

  // Must stay referentially stable: the tracker's hold timers depend on it and would reset every sample.
  const removeNode = useCallback(
    (nodeId: string) => {
      void removeNodeCmd.send(
        { nodeId },
        { label: "Auto-remove completed node" },
      );
    },
    [removeNodeCmd.send],
  );
  const { completedNodes, maxDvByUt } = useBurnCompletionTracker(
    nodes,
    removeNode,
  );

  // A host service on the main screen, a client service on stations, an in-process one without a provider.
  const providedTriggerService = useManeuverTriggerService();
  const [fallbackTriggerService] = useState<ManeuverTriggerService | null>(
    () => (providedTriggerService ? null : new LocalManeuverTriggerService()),
  );
  useEffect(() => {
    return () => {
      if (fallbackTriggerService instanceof LocalManeuverTriggerService) {
        fallbackTriggerService.dispose();
      }
    };
  }, [fallbackTriggerService]);
  const triggerService =
    providedTriggerService ??
    (fallbackTriggerService as ManeuverTriggerService);
  const triggerSnapshot = useTriggerSnapshot(triggerService);
  const armedTriggers = triggerSnapshot.triggers;

  const [triggerEditorOpen, setTriggerEditorOpen] = useState(false);

  // Value keys only, since a trigger's dataKey is read off the stream.
  const numericKeys = useValueKeys("data");

  // Radius by index off the wire; only the body colour comes from the static table, since nothing reports one.
  const body = useMemo(
    () =>
      bodyFromStream({
        name: bodyName ?? refBody,
        radius: parentBodyRadius ?? referenceBodyRadius,
      }),
    [bodyName, refBody, parentBodyRadius, referenceBodyRadius],
  );

  const mu = useMemo(
    () => computeMu(orbitalSpeed, radius, sma, period),
    [orbitalSpeed, radius, sma, period],
  );

  const currentOrbit: CurrentOrbit | null = buildCurrentOrbit({
    sma,
    ecc,
    ApR,
    PeR,
    timeToAp,
    timeToPe,
  });

  const plan: PlanResult | null = useMemo(
    () =>
      computePlan({
        preset,
        currentOrbit,
        currentUT,
        mu,
        prograde,
        normal,
        radial,
        burnInSeconds,
        utMode,
        burnAtUT,
        trueAnomaly,
        argPe,
        inclination,
        targetInclination,
        targetInclinationLive,
        targetLanLive,
        lan: lan?.magnitude,
        bodyRadius: body?.radius,
        targetAltitudeKm,
        targetSma: targetSma?.magnitude,
        targetPeA,
        targetArgPe: targetArgPe?.magnitude,
        targetTrueAnomaly,
        targetPeriod,
        standoffMeters,
      }),
    [
      currentOrbit,
      mu,
      currentUT,
      preset,
      prograde,
      normal,
      radial,
      burnInSeconds,
      utMode,
      burnAtUT,
      trueAnomaly,
      argPe,
      inclination,
      targetInclination,
      targetInclinationLive,
      targetLanLive,
      lan,
      body?.radius,
      targetAltitudeKm,
      targetSma,
      targetPeA,
      targetArgPe,
      targetTrueAnomaly,
      targetPeriod,
      standoffMeters,
    ],
  );

  let requiredDeltaV = 0;
  if (plan) {
    requiredDeltaV = isSequence(plan) ? plan.totalDeltaV : plan.requiredDeltaV;
  }
  // `null` when we cannot judge; a real zero budget compares like any number and comes out short.
  const feasible =
    plan === null || availableDeltaV === null
      ? null
      : availableDeltaV >= requiredDeltaV;

  // True anomaly at the burn, placing the preview's drag handle.
  const burnTrueAnomaly: number | null = useMemo(
    () =>
      computeBurnTrueAnomaly({
        preset,
        currentOrbit,
        currentUT,
        mu,
        trueAnomaly,
        utMode,
        burnAtUT,
        burnInSeconds,
      }),
    [
      preset,
      currentOrbit,
      currentUT,
      mu,
      trueAnomaly,
      utMode,
      burnAtUT,
      burnInSeconds,
    ],
  );

  async function dispatchPlanBurns(toDispatch: PlanResult): Promise<void> {
    const burns = isSequence(toDispatch) ? toDispatch.burns : [toDispatch];
    let dispatched = 0;
    for (const b of burns) {
      try {
        await addNodeCmd.send(
          {
            ut: b.ut,
            radialOut: b.radial,
            normal: b.normal,
            prograde: b.prograde,
          },
          { label: "Add maneuver node" },
        );
      } catch (err) {
        // Only here are both counts known: what landed in KSP and what the plan asked for.
        throw new Error(
          describePartialDispatch({
            dispatched,
            total: burns.length,
            reason: err instanceof Error ? err.message : String(err),
          }),
        );
      }
      dispatched += 1;
    }
  }

  async function handleCommit() {
    if (!plan) return;
    setCommitting(true);
    setError(null);
    try {
      await dispatchPlanBurns(plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommitting(false);
    }
  }

  function handleArmTrigger(input: {
    dataKey: string;
    op: ThresholdOp;
    value: number;
  }) {
    const inputs: FrozenPlanInputs = {
      preset,
      prograde,
      normal,
      radial,
      burnInSeconds,
      utMode,
      burnAtUT,
      targetInclination,
      targetAltitudeKm,
      standoffMeters,
    };
    triggerService.arm({
      dataKey: input.dataKey,
      op: input.op,
      value: input.value,
      inputs,
    });
    setTriggerEditorOpen(false);
    setError(null);
  }

  function handleCancelTrigger(id: string) {
    triggerService.cancel(id);
  }

  // An id-less node is off-contract; its array position is not an address the actuator resolves.
  const UNADDRESSABLE =
    "This node arrived without an id, so there is nothing to address the command to.";

  async function handleDelete(nodeId: string) {
    if (!nodeId) {
      setError(UNADDRESSABLE);
      return;
    }
    try {
      await removeNodeCmd.send({ nodeId }, { label: "Remove maneuver node" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleEdit(nodeId: string, patch: NodeEditPatch) {
    if (!nodeId) {
      setError(UNADDRESSABLE);
      return;
    }
    try {
      await updateNodeCmd.send(
        {
          nodeId,
          ut: patch.ut,
          radialOut: patch.radial,
          normal: patch.normal,
          prograde: patch.prograde,
        },
        { label: "Update maneuver node" },
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  async function handleClearAll() {
    // Last node first, so the plan empties from the far end inward as the operator expects.
    for (let i = nodes.length - 1; i >= 0; i--) {
      await removeNodeCmd.send(
        { nodeId: nodes[i].id },
        { label: "Remove maneuver node" },
      );
    }
  }

  /*
   * Positive finite checks, since values can land NaN mid-scene-load. Withheld
   * on a stale orbit too: a craft out of contact may have burned unseen, so its
   * carried elements can describe an orbit it has left. This gates planning
   * only, never the diagram's own trajectory.
   */
  const planReady =
    orbitReading.state === "observed" &&
    isFiniteNumber(sma) &&
    isFiniteNumber(ecc) &&
    isFiniteNumber(ApR) &&
    isFiniteNumber(PeR) &&
    isFiniteNumber(timeToAp) &&
    isFiniteNumber(timeToPe) &&
    isFiniteNumber(currentUT) &&
    mu > 0;
  const waiting = !planReady;

  // An escape orbit has no apoapsis and reads as waiting, so raw ecc tells it apart from no telemetry.
  const hyperbolic = isFiniteNumber(ecc) && ecc >= 1;

  function renderNodesSection() {
    return (
      <PaddedSection>
        <SectionTitle as="h4">Planned nodes</SectionTitle>
        <ManeuverNodeList
          nodes={nodes}
          completedNodes={completedNodes}
          currentUT={currentUT}
          availableDv={availableDeltaV}
          onDelete={handleDelete}
          onEdit={handleEdit}
          onClearAll={handleClearAll}
        />
      </PaddedSection>
    );
  }

  /**
   * The three instants of each queued burn, off the same `nodes` list the node
   * section renders, so the two cannot disagree. Its own section, since three
   * rows and an axis per burn do not fit inside a node row.
   */
  function renderBurnWindowsSection() {
    if (nodes.length === 0) return null;
    return (
      <PaddedSection>
        <SectionTitle as="h4">Burn windows</SectionTitle>
        <Stack>
          {nodes.map((burn) => (
            <BurnWindowRows
              // UT survives KSP renumbering the list on a removal; an index does not.
              key={burn.UT}
              burn={{
                ut: burn.UT,
                ignitionUt: burn.ignitionUt,
                cutoffUt: burn.cutoffUt,
              }}
              nowUt={currentUT ?? 0}
            />
          ))}
        </Stack>
      </PaddedSection>
    );
  }

  /**
   * What each burn was planned with against what it has delivered, whoever
   * planned it. The planned figure is the tracker's `maxDvByUt`, since one sample
   * cannot tell a 300 m/s burn with 300 to go from a 1000 m/s one.
   */
  function renderConformanceSection() {
    if (nodes.length === 0) return null;
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
                  current={
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
                      : null
                  }
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

  function renderNewManeuverSection() {
    return (
      <PaddedSection>
        <SectionTitle as="h4">New maneuver</SectionTitle>
        {/* The plan still renders; the caption stops its Δv being read as measured now. */}
        {elementsNeedDating && (
          <ReadoutCaption>
            Planned from the last known orbit, which is no longer current
          </ReadoutCaption>
        )}
        <PresetInput
          api={inputsApi}
          telemetry={{
            currentUT,
            inclination,
            lan: lan?.magnitude,
            targetName,
            targetInclinationLive,
            targetLanLive,
            targetPeA,
          }}
        />
      </PaddedSection>
    );
  }

  function renderWaitingPanel() {
    // A withheld trajectory is a propagation refusal, not missing telemetry, and has a different remedy.
    if (currentTrajectory !== null && currentTrajectory.shape === "withheld") {
      return (
        <WaitingPanel>
          <TrajectoryWithheldNote withheld={currentTrajectory} />
        </WaitingPanel>
      );
    }
    return <EmptyState>Awaiting orbit telemetry.</EmptyState>;
  }

  function renderHyperbolicPanel() {
    return (
      <WaitingPanel>
        <SectionTitle as="h4">Hyperbolic trajectory</SectionTitle>
        <HyperbolicNotice>
          Escaping on a hyperbolic orbit (no apoapsis), maneuver planning is not
          available.
        </HyperbolicNotice>
      </WaitingPanel>
    );
  }

  function renderArmedTriggersSection() {
    if (armedTriggers.length === 0) return null;
    return (
      <PaddedSection>
        <SectionTitle as="h4">Armed triggers</SectionTitle>
        <ArmedTriggersList
          triggers={armedTriggers}
          onCancel={handleCancelTrigger}
        />
      </PaddedSection>
    );
  }

  return (
    <Panel
      panelTitle="MANEUVER PLANNER"
      // The sections seam is placed inside the Plan tab instead of on every tab.
      panelSections={false}
      sections={[
        refBody !== undefined && (
          <Section key="body" full>
            <RefBodyCaption data-ref-body-caption="">{refBody}</RefBodyCaption>
          </Section>
        ),
        // The node list sits above the tabs: it is the subject both tabs are views of.
        <Section key="nodes" full>
          {renderNodesSection()}
        </Section>,
        <Section key="views" full>
          {/* Plan authors the next burn; Conformance is the retrospective on flown ones. */}
          <Tabs
            tabs={[
              { id: "plan", label: "Plan", content: renderPlanTab() },
              {
                id: "conformance",
                label: "Conformance",
                content: renderConformanceTab(),
              },
            ]}
          />
        </Section>,
      ]}
    />
  );

  function renderPlanTab() {
    return (
      <>
        {renderBurnWindowsSection()}
        {renderArmedTriggersSection()}
        {renderNewManeuverSection()}
        {waiting ? (
          hyperbolic ? (
            renderHyperbolicPanel()
          ) : (
            renderWaitingPanel()
          )
        ) : (
          <ManeuverPreview
            plan={plan}
            currentOrbit={currentOrbit}
            currentTrajectory={currentTrajectory}
            body={body}
            preset={preset}
            burnTrueAnomaly={burnTrueAnomaly}
            diagram={{
              sma,
              ecc,
              ApR,
              PeR,
              trueAnomaly,
              argPe,
            }}
            prograde={prograde}
            radial={radial}
            normal={normal}
            setPrograde={setPrograde}
            setRadial={setRadial}
            availableDeltaV={availableDeltaV}
            feasible={feasible}
            requiredDeltaV={requiredDeltaV}
            currentUT={currentUT}
            error={error}
            committing={committing}
            triggerEditorOpen={triggerEditorOpen}
            setTriggerEditorOpen={setTriggerEditorOpen}
            numericKeys={numericKeys}
            onCommit={handleCommit}
            onArm={handleArmTrigger}
          />
        )}
        {/* The sections slot, below the preview and feasibility check. */}
        <WidgetSections />
      </>
    );
  }

  function renderConformanceTab() {
    return <>{renderConformanceSection()}</>;
  }
}

registerComponent<ManeuverPlannerConfig>({
  id: "maneuver-planner",
  name: "Maneuver Planner",
  description:
    "Plan maneuver nodes: circularise / custom ΔV at next apsis, with live preview + feasibility check against vessel ΔV.",
  tags: ["telemetry", "planning"],
  defaultSize: { w: 10, h: 18 },
  // Seven columns so the preset picker shows its longest label in full.
  minSize: { w: 7, h: 9 },
  component: ManeuverPlannerComponent,
  augmentSlots: ["maneuver-planner.sections"],
  /*
   * Apsides, countdowns and period are solved from these elements, so are not
   * declared. `vessel.target` is not declared either: with nothing targeted the
   * wire tombstones it, and a badge would mark the whole panel NO DATA.
   */
  dataRequirements: [
    "vessel.orbit.sma",
    "vessel.orbit.ecc",
    "vessel.orbit.inc",
    "vessel.orbit.lan",
    "vessel.orbit.argPe",
    "vessel.flight.orbitalSpeed",
    "vessel.orbit.referenceBodyIndex",
    "system.bodies",
    "vessel.identity.parentBodyIndex",
    "vessel.maneuver.nodes",
    "dv.stages",
  ],
  defaultConfig: { defaultPreset: "circularize-apo" },
  actions: maneuverActions,
  pushable: true,
  requires: ["flight"],
});

export { ManeuverPlannerComponent };

// forwardedAs, not as: styled-components consumes `as` and would replace Stack outright.
const PaddedSection = styled(Stack).attrs({
  forwardedAs: "section" as const,
  gap: "related-dense" as const,
})`
  padding-top: var(--gap-planner-section);
`;

const RefBodyCaption = styled.div`
  font-size: var(--font-size-caption);
  color: var(--color-text-muted);
`;

const WaitingPanel = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  padding: var(--inset-surface);
  background: var(--color-surface-panel);
  border: 1px solid var(--color-surface-raised);
  border-radius: var(--radius-regular);
`;

const HyperbolicNotice = styled.p`
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
  margin: 0;
  line-height: var(--line-height-body);
`;
