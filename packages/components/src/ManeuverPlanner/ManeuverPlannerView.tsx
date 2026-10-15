import type { ComponentProps } from "@ksp-gonogo/core";
import { useManeuverNodes, useNumericFields } from "@ksp-gonogo/data";
import { useStream } from "@ksp-gonogo/sitrep-client";
import type { VesselManeuver } from "@ksp-gonogo/sitrep-sdk";
import { Panel, Section, Text } from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import { currencyOf } from "../shared/currencyOf";
import { mergeMarkings } from "../shared/mergeMarkings";
import { ArmedTriggersList } from "./ArmedTriggersList";
import { BurnWindowsSection } from "./BurnWindowsSection";
import { ConformanceSection } from "./ConformanceSection";
import { ManeuverNodeList } from "./ManeuverNodeList";
import { ManeuverPreview } from "./ManeuverPreview";
import { NewManeuverSection } from "./NewManeuverSection";
import { NotPlannableNotice } from "./NotPlannableNotice";
import { type ManeuverPlannerConfig, usesTarget } from "./presets";
import { useTriggerSnapshot } from "./triggerService";
import type { FrozenPlanInputs, ThresholdOp } from "./triggerTypes";
import { useNodeCommands } from "./useNodeCommands";
import { usePlan } from "./usePlan";
import { usePlannerInputs } from "./usePlannerInputs";
import { usePlannerTelemetry } from "./usePlannerTelemetry";
import { usePlannerTriggerService } from "./usePlannerTriggerService";

export function ManeuverPlannerComponent({
  config,
}: Readonly<ComponentProps<ManeuverPlannerConfig>>) {
  const inputsApi = usePlannerInputs(config);
  const { inputs, setPrograde, setRadial } = inputsApi;
  const telemetry = usePlannerTelemetry();
  const {
    currentTrajectory,
    sma,
    ecc,
    ApR,
    PeR,
    trueAnomaly,
    argPe,
    currentUT,
    nowUtSeconds,
    refBody,
    availableDeltaV,
    body,
    currentOrbit,
    orbitMarking,
    targetMarking,
  } = telemetry;
  const nodes = useManeuverNodes();
  // The plan stands until changed, but a change made while the link is down is missed, so its figures take the plan reading's currency.
  const planReading = useStream<VesselManeuver>("vessel.maneuver");
  const planCurrency = [currencyOf(planReading)];
  const planAwaited =
    planReading.state !== "observed" && planReading.state !== "held";
  const {
    plan,
    requiredDeltaV,
    feasible,
    burnTrueAnomaly,
    planReady,
    hyperbolic,
  } = usePlan(inputs, telemetry);
  const {
    sendDelay,
    committing,
    removing,
    error,
    setError,
    completedNodes,
    watches,
    handleCommit,
    handleDelete,
    handleEdit,
    handleClearAll,
  } = useNodeCommands(nodes, plan, telemetry.burnContext);

  const triggerService = usePlannerTriggerService();
  const armedTriggers = useTriggerSnapshot(triggerService).triggers;
  const [triggerEditorOpen, setTriggerEditorOpen] = useState(false);
  // A trigger compares a number, so only numeric fields are offered.
  const numericKeys = useNumericFields();

  function handleArmTrigger(input: {
    dataKey: string;
    op: ThresholdOp;
    value: number;
  }) {
    const frozen: FrozenPlanInputs = { ...inputs };
    triggerService.arm({
      dataKey: input.dataKey,
      op: input.op,
      value: input.value,
      inputs: frozen,
    });
    setTriggerEditorOpen(false);
    setError(null);
  }

  // The plan inherits the basis of the orbit it was computed from, and of the target's too for a preset that reads one.
  const planMarking = usesTarget(inputs.preset)
    ? mergeMarkings(orbitMarking, targetMarking)
    : orbitMarking;

  return (
    <Panel
      panelTitle="MANEUVER PLANNER"
      sections={[
        refBody !== undefined && (
          <Section key="body" full>
            <Text
              level="muted"
              style={REF_BODY_CAPTION_STYLE}
              data-ref-body-caption=""
            >
              {refBody}
            </Text>
          </Section>
        ),
        <Section key="nodes" title="Planned nodes">
          <ManeuverNodeList
            nodes={nodes}
            awaiting={planAwaited}
            completedNodes={completedNodes}
            currentUT={currentUT}
            availableDv={availableDeltaV}
            thrust={telemetry.thrustLatch}
            from={planCurrency}
            onDelete={handleDelete}
            onEdit={handleEdit}
            onClearAll={handleClearAll}
            removing={removing}
          />
          {/* Mounted while empty, so a trigger listed later, a fired one that went wrong included, is announced. */}
          <div role="status" aria-live="polite" aria-atomic="false">
            {armedTriggers.length > 0 && (
              <Section title="Armed triggers" gap="related">
                <ArmedTriggersList
                  triggers={armedTriggers}
                  onCancel={(id) => triggerService.cancel(id)}
                />
              </Section>
            )}
          </div>
        </Section>,
        <BurnWindowsSection
          key="windows"
          nodes={nodes}
          currentUT={nowUtSeconds}
          from={planCurrency}
        />,
        <NewManeuverSection key="new" api={inputsApi} telemetry={telemetry} />,
        planReady ? (
          <ManeuverPreview
            key="preview"
            plan={plan}
            currentOrbit={currentOrbit}
            currentTrajectory={currentTrajectory}
            body={body}
            preset={inputs.preset}
            burnTrueAnomaly={burnTrueAnomaly}
            diagram={{
              sma,
              ecc,
              ApR,
              PeR,
              trueAnomaly,
              argPe,
            }}
            prograde={inputs.prograde}
            radial={inputs.radial}
            normal={inputs.normal}
            setPrograde={setPrograde}
            setRadial={setRadial}
            availableDeltaV={availableDeltaV}
            orbitMarking={orbitMarking}
            planMarking={planMarking}
            feasible={feasible}
            requiredDeltaV={requiredDeltaV}
            currentUT={currentUT}
            error={error}
            committing={committing}
            sendDelay={sendDelay}
            triggerEditorOpen={triggerEditorOpen}
            setTriggerEditorOpen={setTriggerEditorOpen}
            numericKeys={numericKeys}
            onCommit={handleCommit}
            onArm={handleArmTrigger}
          />
        ) : (
          <Section key="preview">
            <NotPlannableNotice
              hyperbolic={hyperbolic}
              currentTrajectory={currentTrajectory}
            />
          </Section>
        ),
        // What was flown against what was planned: the retrospective on the nodes above.
        <ConformanceSection
          key="conformance"
          nodes={nodes}
          awaiting={planAwaited}
          watches={watches}
          telemetry={telemetry}
          from={planCurrency}
        />,
      ]}
    />
  );
}

const REF_BODY_CAPTION_STYLE = {
  fontSize: "var(--font-size-caption)",
} as const;
