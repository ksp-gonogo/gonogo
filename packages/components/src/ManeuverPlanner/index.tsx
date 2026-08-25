import {
  type ActionDefinition,
  type ComponentProps,
  type CurrentOrbit,
  getBody,
  registerComponent,
  useOrbitElements,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useManeuverNodes, useValueKeys } from "@ksp-gonogo/data";
import {
  DELTA_V_BUDGET,
  type OrbitTrajectory,
  type Reading,
  useCommand,
  useOrbitTrajectory,
  useProcessor,
  useStream,
  useViewUt,
  type VesselState,
} from "@ksp-gonogo/sitrep-client";
import {
  EmptyState,
  Panel,
  ReadoutCaption,
  SectionTitle,
  Stack,
  Tabs,
  usePanelDelay,
  WidgetSections,
} from "@ksp-gonogo/ui-kit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { magnitudeOf } from "../shared/magnitude";
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

// Actions are stubbed at [] for now, the widget is mouse-driven. Hardware
// bindings (commit from a physical button) can be added later.
const maneuverActions = [] as const satisfies readonly ActionDefinition[];

/**
 * One whole-widget append slot, a broad escape hatch carrying no per-item
 * datum, so its props are empty. `maneuver-planner.sections` sits below the
 * live preview and feasibility check, for alternate transfer-strategy
 * comparisons such as a porkchop or optimal-transfer Uplink.
 *
 * The slot id and its props type are declaration-merged into core's
 * `SlotRegistry` here rather than in a shared central file, so that
 * `<AugmentSlot>` and `registerAugment` see the precise (empty) prop shape
 * rather than the loose `Record<string, unknown>` an unmerged slot id gets,
 * and so parallel per-widget slot work never collides in one file.
 */
export type ManeuverPlannerSectionsSlotProps = Record<string, never>;

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "maneuver-planner.sections": ManeuverPlannerSectionsSlotProps;
  }
}

/**
 * A measurement this widget can present with its age attached, and whether it needs
 * that label. The reckoned value needs none: it IS the current one.
 */
function dateable<T>(reading: Reading<T>): {
  value: T | undefined;
  needsDating: boolean;
} {
  if (reading.state === "observed")
    return { value: reading.value, needsDating: false };
  if (reading.state === "reckonable")
    return { value: reading.reckoned.value, needsDating: false };
  if (reading.state === "stale")
    return { value: reading.value, needsDating: true };
  return { value: undefined, needsDating: false };
}

/**
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
function stillTrue<T, A>(
  reading: Reading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "reckonable") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
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

  // Live orbit state: everything we need for the preset math + preview.
  // Magnitudes, because all of it feeds the solver and the finite-number
  // readiness checks below, both of which take plain numbers.
  //
  // ONE read per record, then fields off it. This was five separate
  // `useTelemetry("vessel.orbit")` calls and five `useTelemetry("vessel.target")`
  // calls, scattered down the body between unrelated `vessel.state` reads: ten
  // reads of two memoized records, and shortly ten branches on two currencies
  // that cannot possibly differ within a frame. Read once, destructure, and the
  // orbital elements visibly arrive together, which is what they are.
  /**
   * A maneuver plan is not an instruction for right now. Unlike a suicide-burn
   * countdown, whose number IS the instruction and which `LandingStatus` therefore
   * refuses, a node sits minutes or hours out and the operator reviews it before
   * committing. A plan computed from elements a few seconds old is still a good
   * plan, so this widget dates its inputs rather than withholding them.
   *
   * `dateable` prefers the modelled value where a reckoner exists, and an orbit is
   * propagatable, so in the common case the elements are current rather than dated
   * and `needsDating` is false. The caption only appears when nothing could model
   * them forward.
   *
   * This answers the caption that was OWED here. Note the warning that came with
   * it, which still stands: do NOT compute the age as `viewUt - orbit.epoch`.
   * `epoch` is the mean-anomaly REFERENCE epoch, not an observation time, so that
   * difference looks like an age and is not one, and the `ut` token cannot catch it
   * because both operands are correctly instants. The age comes off the reading's
   * own `asOfUt`, which is the only thing that knows when the sample was taken.
   */
  const orbitReading = useTelemetry("vessel.orbit");
  const targetReading = useTelemetry("vessel.target");
  const { value: orbit, needsDating: orbitNeedsDating } =
    dateable(orbitReading);
  const { value: target, needsDating: targetNeedsDating } =
    dateable(targetReading);
  const elementsNeedDating = orbitNeedsDating || targetNeedsDating;
  /**
   * The thrust latch, for conformance. Undefined until the propulsion channel
   * arrives, which is NOT "engines off": see ThrustLatchReading.
   *
   * `stillTrue`, because the latch is a FACT and was built to be one: the start
   * instant is nulled on cessation and set on ignition precisely so it survives a
   * dropped frame the way an instantaneous thrust reading does not. Withholding it
   * when the reading goes stale would undo the thing the latch exists for.
   *
   * A confirmed absence reads as no latch, same as never having arrived. That is a
   * decision rather than a default: a vessel whose propulsion channel says there is
   * nothing has no burn to latch, and the two are the same statement here.
   */
  const propulsion = stillTrue(useTelemetry("vessel.propulsion"), undefined);
  const thrustLatch = propulsion
    ? {
        // Latched, not `currentThrust > 0`: the start instant is nulled on
        // cessation and set on ignition, so it survives a dropped frame the way
        // an instantaneous thrust reading does not.
        thrusting: magnitudeOf(propulsion.thrustStartedUt) != null,
        lastThrustEndUt: magnitudeOf(propulsion.lastThrustEndUt),
      }
    : undefined;
  // What the CURRENT orbit's curve is, asked of the propagation seam rather than
  // decided by whichever of this widget's two diagrams is drawing it. Both put
  // the live orbit on screen as a conic and neither asked, so electing a
  // provider that integrates changed nothing an operator saw in either.
  const currentTrajectory: OrbitTrajectory | null = useOrbitTrajectory(orbit);
  const sma = magnitudeOf(orbit?.sma) ?? undefined;
  const ecc = magnitudeOf(orbit?.ecc) ?? undefined;
  const {
    apoapsisRadius: ApR,
    periapsisRadius: PeR,
    timeToApoapsis: timeToAp,
    timeToPeriapsis: timeToPe,
  } = useOrbitElements();
  const argPe = magnitudeOf(orbit?.argPe) ?? undefined;
  const trueAnomaly =
    useStream<VesselState>("vessel.state")?.trueAnomaly ?? undefined;
  // t.universalTime is dropped as a data key, it was never a stream, it IS
  // the SDK view-UT the propagation is evaluated at, so read that directly.
  // `.magnitude` at the read: this widget threads the view time through geometry and
  // solver code typed on plain numbers, and the instant type earns nothing there.
  const currentUT = useViewUt()?.magnitude;
  const orbitalSpeed =
    useStream<VesselState>("vessel.state")?.orbitalSpeed ?? undefined;
  const radius =
    useStream<VesselState>("vessel.state")?.orbitalRadius ?? undefined;
  const refBody = useStream<VesselState>("vessel.state")?.referenceBodyName;
  const bodyName = useStream<VesselState>("vessel.state")?.parentBodyName;
  const inclination = magnitudeOf(orbit?.inc) ?? undefined;
  const targetName = target?.name;
  const targetInclinationLive = magnitudeOf(target?.orbit?.inc) ?? undefined;
  const targetLanLive = magnitudeOf(target?.orbit?.lan) ?? undefined;
  const targetSma = target?.orbit?.sma;
  const targetPeA =
    useStream<VesselState>("vessel.state")?.targetPeriapsisAlt ?? undefined;
  const targetArgPe = target?.orbit?.argPe;
  const targetTrueAnomaly =
    useStream<VesselState>("vessel.state")?.targetTrueAnomaly ?? undefined;
  const targetPeriod =
    useStream<VesselState>("vessel.state")?.targetPeriod ?? undefined;
  const lan = orbit?.lan;

  const period = useStream<VesselState>("vessel.state")?.period ?? undefined;

  const nodes = useManeuverNodes();
  /**
   * The shared ΔV budget: the game's own vessel total off `dv.summary`, never a
   * client-side sum of the stage rows. The two are built from different stage
   * lists (`OperatingStageInfo` versus `WorkingStageInfo`), so summing the rows
   * here lets the planner and the fuel panel disagree about the same craft.
   *
   * Carried when it goes stale rather than blanked, which matters here more than
   * anywhere: `feasible === false` is the ONLY thing that disables the commit, so
   * a budget vanishing mid-blackout turns a craft that is demonstrably short
   * into one we have no opinion about, and re-enables the button.
   */
  const availableDeltaV = magnitudeOf(useProcessor(DELTA_V_BUDGET)?.totalVac);

  // Adding, updating and removing a node all actuate the craft's flight plan, so each is subject to signal delay and rides `useCommand`.
  const addNodeCmd = useCommand("vessel.maneuver.add");
  const updateNodeCmd = useCommand("vessel.maneuver.update");
  const removeNodeCmd = useCommand("vessel.maneuver.remove");
  usePanelDelay(addNodeCmd);
  usePanelDelay(updateNodeCmd);
  usePanelDelay(removeNodeCmd);

  // The node carries the id the remove command addresses it by, so there is
  // nothing to resolve and nothing to keep in a ref. `removeNode` stays
  // referentially stable, which it must: `useBurnCompletionTracker` puts it in
  // a `useEffect` dependency array that schedules the 10 s hold, and a callback
  // rebuilt on every 1 UT sample would tear the timers down before it elapsed.
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

  // Armed conditional triggers come from a service, host service on the
  // main screen (see @ksp-gonogo/app/src/maneuverTriggers), client service on
  // station screens. When the widget is rendered without a provider (legacy
  // tests, standalone embeds) we fall back to an in-process LocalService so
  // the feature still works for the local user.
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

  // Editor visibility: the picker's draft fields live inside `TriggerEditor`.
  const [triggerEditorOpen, setTriggerEditorOpen] = useState(false);

  // Value-restricted keys: see `useValueKeys`'s doc comment. A trigger's
  // `dataKey` now reads off the stream (`LocalManeuverTriggerService`'s
  // `getValue`), so this also excludes any legacy key with no stream home.
  const numericKeys = useValueKeys("data");

  const body = getBody(bodyName ?? refBody ?? "");

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
  // `null` when we cannot judge, which is NOT the same as a vessel that cannot afford
  // it. This read `=== 0` and so treated a spent craft as unknown: no SHORT chip, and
  // `feasible === false` is the only thing that disables the commit, so an out-of-fuel
  // vessel would accept a plan it could not fly. A real 0 now compares like any other
  // number and comes out short.
  const feasible =
    plan === null || availableDeltaV === null
      ? null
      : availableDeltaV >= requiredDeltaV;

  // True anomaly at the burn, for drag-handle placement on the preview.
  // Apsis presets are exact (0° / 180°); custom-ut re-uses our propagator.
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
      // Same RADIAL, NORMAL, PROGRADE wire order as before (see handleCommit's
      // own comment): only the transport changed, not the arg shape.
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
        // Both counts exist HERE and nowhere above: `dispatched` is what actually
        // landed in KSP and `burns.length` is the plan. Rethrowing a bare reason would
        // reach `handleCommit` with no way to recover either, and a wrong count is
        // worse than none because it is a confident claim about vessel state.
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
      // The legacy command passed `[ut,x,y,z]` straight to KSP's
      // `ManeuverNode.OnGizmoUpdated(new Vector3d(x,y,z), ut)`. KSP's
      // node-local frame is `Vector3d(radialOut, normal, prograde)`,
      // confirmed by kOS's Node.cs which constructs the same vector in
      // that exact order. So the on-wire order is RADIAL, NORMAL,
      // PROGRADE: *not* prograde-first. Sending pure prograde in the
      // first slot turns it into pure radial-out and the burn points
      // straight up.
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

  /**
   * A node the craft cannot be asked about. Nothing on the live wire omits an
   * id, so this is an off-contract payload rather than a wait, and saying so
   * beats dispatching a command that cannot resolve. Falling back to the node's
   * array POSITION is the tempting substitute, and the actuator answers
   * NotFound to it every time, with the refusal reaching nobody.
   */
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
    // Same vector convention as `o.addManeuverNode`: KSP's node-local frame is
    // `Vector3d(radialOut, normal, prograde)`, so the on-wire arg order is
    // RADIAL, NORMAL, PROGRADE: *not* prograde-first.
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
    // Last node first. Order no longer decides whether this works, now each
    // node is addressed by its own id rather than by a position that shifted
    // under the loop, but the craft loses its plan from the far end inward,
    // which is the order an operator watching the list expects.
    for (let i = nodes.length - 1; i >= 0; i--) {
      await removeNodeCmd.send(
        { nodeId: nodes[i].id },
        { label: "Remove maneuver node" },
      );
    }
  }

  // Whether there is enough of an orbit to plan against. Values can land null
  // or NaN mid-scene-load, so this is a positive check rather than a
  // `!== undefined` one.
  const planReady =
    isFiniteNumber(sma) &&
    isFiniteNumber(ecc) &&
    isFiniteNumber(ApR) &&
    isFiniteNumber(PeR) &&
    isFiniteNumber(timeToAp) &&
    isFiniteNumber(timeToPe) &&
    isFiniteNumber(currentUT) &&
    mu > 0;
  const waiting = !planReady;

  // O5: a hyperbolic/escape orbit (ecc >= 1) has no apoapsis, so
  // `buildCurrentOrbit` legitimately returns null (ApR/timeToAp are NaN),
  // that reads as `waiting` above, which is indistinguishable from genuinely
  // no telemetry at all. Read the raw `vessel.orbit.ecc` directly (always
  // present once the orbit topic lands, unlike the derived `currentOrbit`)
  // so we can tell the operator "escaping, planner N/A" instead of showing
  // the generic empty/no-data panel.
  const hyperbolic = isFiniteNumber(ecc) && ecc >= 1;

  // Render split into nested helpers so the component's cognitive
  // complexity stays below Sonar's S3776 threshold. Each helper is
  // measured independently by the rule.
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
   * The three instants of each queued burn, off `nodes`: THE SAME LIST the
   * node-list section above renders.
   *
   * It first read `vessel.maneuver` directly, because the instants were new
   * contract fields the legacy reshape predated. That is what let a render show
   * a burn window for a node the list beside it said did not exist: two reads of
   * one truth, free to disagree, and a fixture that fed only one of them made
   * them. The instants now travel on the parsed node itself, so the two sections
   * are structurally incapable of disagreeing rather than merely tested for it.
   *
   * Its own section rather than inside each node row: three rows plus an axis
   * per burn is more than a row can hold at the sizes this widget is used at,
   * and the whole reason the instants are separate is that they must not be
   * squeezed back onto one line.
   */
  function renderBurnWindowsSection() {
    if (nodes.length === 0) return null;
    return (
      <PaddedSection>
        <SectionTitle as="h4">Burn windows</SectionTitle>
        <Stack gap="sm">
          {nodes.map((burn) => (
            <BurnWindowRows
              // UT, the same key the burn tracker uses: stable across KSP
              // renumbering the list on a removal, which an index is not.
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
   * Tier-1 conformance: what each burn was planned with against what it has
   * delivered. Model-agnostic, so it reads the same whoever planned the burn.
   *
   * Reads `maxDvByUt` off the completion tracker rather than watching the burns
   * itself, because a single sample cannot tell a 300 m/s burn with 300 to go
   * from a 1000 m/s burn with 300 to go, and two independent watchers of that
   * one quantity could disagree about whether the same burn finished.
   */
  function renderConformanceSection() {
    if (nodes.length === 0) return null;
    return (
      <PaddedSection>
        <SectionTitle as="h4">Conformance</SectionTitle>
        <Stack gap="xs">
          {nodes.map((node) => {
            const first = node.orbitPatches[0];
            // ONE conformance reading feeding both the row and the plot's
            // regime. They are two views of the same burn and a render caught
            // them contradicting each other when each worked it out for itself:
            // the row said "not started, 0 of 300" beside a chip saying "flown,
            // the gap is the deviance".
            const conformance = burnConformance(
              node.deltaVMagnitude,
              maxDvByUt.get(node.UT) ?? null,
              thrustLatch,
            );
            return (
              <Stack key={node.UT} gap="xs">
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
                  // Patches[0] ONLY, the immediate post-burn conic. See the
                  // component's own doc for why a downstream patch cannot be
                  // compared at all.
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
                  // The CURRENT orbit follows the observation rules; the planned
                  // conic is authored and never dims.
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
        {/* The plan still renders, because a node is reviewed before it is
            committed and elements a few seconds old still make a good plan. What
            the operator must not do is read the resulting Δv as measured now. */}
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
    // Was a per-field checklist naming the wire keys it was waiting on. No
    // other widget exposes its plumbing that way, and the keys it named had
    // stopped being the ones it reads, so it was sending an operator to look
    // for something that no longer exists. An ordinary empty state says the
    // one thing they can act on: there is no orbit to plan against yet.
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
    <Panel panelTitle="MANEUVER PLANNER" panelSections={false}>
      <ScrollBody>
        {refBody !== undefined && (
          <RefBodyCaption data-ref-body-caption="">{refBody}</RefBodyCaption>
        )}
        {/* The node list sits ABOVE the tabs and shows on both, because it is
            the SUBJECT and the tabs are two views of it. Inside PLAN, switching
            to CONFORMANCE lost sight of the thing being conformed to. */}
        {renderNodesSection()}
        {/* Two tabs, PLAN and CONFORMANCE.
            PLAN is everything about authoring and flying the next burn: the
            queued nodes' windows, the armed triggers, and NEW MANEUVER with its
            preview. CONFORMANCE is the retrospective: what each burn delivered
            against what it was planned with, and the two-conic plot. They are
            separated because they answer different questions at different
            times, and stacking them made the operator scroll past a preview to
            reach a verdict. */}
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
      </ScrollBody>
    </Panel>
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
        {/* Below the preview + feasibility check: an alternate-transfer-strategy
            Uplink (porkchop / optimal transfer) binds here. Placed rather than
            left to `Panel`'s end-of-body default because this is the PLAN tab;
            the default mount would sit outside the tabs and show on every one
            of them. */}
        <WidgetSections />
      </>
    );
  }

  function renderConformanceTab() {
    return <>{renderConformanceSection()}</>;
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerComponent<ManeuverPlannerConfig>({
  id: "maneuver-planner",
  name: "Maneuver Planner",
  description:
    "Plan maneuver nodes: circularise / custom ΔV at next apsis, with live preview + feasibility check against vessel ΔV.",
  tags: ["telemetry", "planning"],
  defaultSize: { w: 10, h: 18 },
  minSize: { w: 6, h: 9 },
  component: ManeuverPlannerComponent,
  // A body `sections` slot for alternate-transfer-strategy comparisons, empty until an augment binds.
  augmentSlots: ["maneuver-planner.sections"],
  // The target's reads split by kind: the three quantities propagated to the
  // same view-UT as the self vessel are derived `vessel.state` fields.
  //
  // The raw target-orbit field subtopics are deliberately not named. Nothing
  // targeted is the common case, and the wire tombstones the whole
  // `vessel.target` topic for it, which a badge reads as a confirmed absence:
  // declaring them badged this panel NO DATA whenever no target was selected,
  // drowning out nodes, burn windows and a preview that were all populated.
  // The widget reads the topic through `useTelemetry("vessel.target")`, which
  // subscribes on its own account, so naming it here buys nothing.
  dataRequirements: [
    "vessel.orbit.sma",
    "vessel.orbit.ecc",
    "vessel.orbit.inc",
    "vessel.orbit.lan",
    "vessel.orbit.argPe",
    "vessel.state.apoapsisRadius",
    "vessel.state.periapsisRadius",
    "vessel.state.timeToAp",
    "vessel.state.timeToPe",
    "vessel.state.trueAnomaly",
    "vessel.state.orbitalSpeed",
    "vessel.state.orbitalRadius",
    "vessel.state.referenceBodyName",
    "vessel.state.parentBodyName",
    "vessel.maneuver.nodes",
    "dv.stages",
    "vessel.state.targetPeriapsisAlt",
    "vessel.state.targetTrueAnomaly",
    "vessel.state.targetPeriod",
  ],
  defaultConfig: { defaultPreset: "circularize-apo" },
  actions: maneuverActions,
  pushable: true,
  requires: ["flight"],
});

export { ManeuverPlannerComponent };

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

// forwardedAs, not as: styled-components CONSUMES `as` and renders that
// element in place of the wrapped component, so `as: "section"` would silently
// drop Stack entirely and leak `gap` to the DOM as an attribute. forwardedAs
// passes it down to Stack, which has its own `as` prop for exactly this.
const PaddedSection = styled(Stack).attrs({
  forwardedAs: "section" as const,
  gap: "sm" as const,
})`
  padding-top: var(--space-4);
`;

const ScrollBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
`;

const RefBodyCaption = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
`;

const WaitingPanel = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6) var(--space-8);
  background: var(--color-surface-panel);
  border: 1px solid var(--color-surface-raised);
  border-radius: var(--radius-xs);
`;

const StatusList = styled.ul`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  list-style: none;
  margin: 0;
  padding: 0;
`;

const StatusRow = styled.li`
  display: flex;
  align-items: center;
  gap: var(--space-6);
`;

const StatusDot = styled.span<{ $ok: boolean }>`
  width: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${({ $ok }) => ($ok ? "var(--color-accent-fg)" : "var(--color-text-muted)")};
  font-size: var(--font-size-xs);
`;

const StatusLabel = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
`;

const HyperbolicNotice = styled.p`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin: 0;
  line-height: var(--line-height-body);
`;
