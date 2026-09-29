import type { ComponentProps } from "@ksp-gonogo/core";
import { useManeuverNodes, useNumericFields } from "@ksp-gonogo/data";
import {
  Panel,
  Section,
  SectionTitle,
  Tabs,
  Text,
  WidgetSections,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import { ArmedTriggersList } from "./ArmedTriggersList";
import { BurnWindowsSection } from "./BurnWindowsSection";
import { ConformanceSection } from "./ConformanceSection";
import { ManeuverNodeList } from "./ManeuverNodeList";
import { ManeuverPreview } from "./ManeuverPreview";
import { NewManeuverSection } from "./NewManeuverSection";
import { NotPlannableNotice } from "./NotPlannableNotice";
import type { ManeuverPlannerConfig } from "./presets";
import { PaddedSection } from "./styles";
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
    refBody,
    availableDeltaV,
    body,
    currentOrbit,
  } = telemetry;
  const nodes = useManeuverNodes();
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
    error,
    setError,
    completedNodes,
    maxDvByUt,
    handleCommit,
    handleDelete,
    handleEdit,
    handleClearAll,
  } = useNodeCommands(nodes, plan);

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

  function renderPlanTab() {
    return (
      <>
        <BurnWindowsSection nodes={nodes} currentUT={currentUT} />
        {/* Mounted while empty, so a trigger listed later, a fired one that went wrong included, is announced. */}
        <div role="status" aria-live="polite" aria-atomic="false">
          {armedTriggers.length > 0 && (
            <PaddedSection>
              <SectionTitle as="h4">Armed triggers</SectionTitle>
              <ArmedTriggersList
                triggers={armedTriggers}
                onCancel={(id) => triggerService.cancel(id)}
              />
            </PaddedSection>
          )}
        </div>
        <NewManeuverSection api={inputsApi} telemetry={telemetry} />
        {planReady ? (
          <ManeuverPreview
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
          <NotPlannableNotice
            hyperbolic={hyperbolic}
            currentTrajectory={currentTrajectory}
          />
        )}
        {/* The sections slot, below the preview and feasibility check. */}
        <WidgetSections />
      </>
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
            <Text
              level="muted"
              style={REF_BODY_CAPTION_STYLE}
              data-ref-body-caption=""
            >
              {refBody}
            </Text>
          </Section>
        ),
        // The node list sits above the tabs: it is the subject both tabs are views of.
        <Section key="nodes" full>
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
        </Section>,
        <Section key="views" full>
          {/* Plan authors the next burn; Conformance is the retrospective on flown ones. */}
          <Tabs
            tabs={[
              { id: "plan", label: "Plan", content: renderPlanTab() },
              {
                id: "conformance",
                label: "Conformance",
                content: (
                  <ConformanceSection
                    nodes={nodes}
                    maxDvByUt={maxDvByUt}
                    telemetry={telemetry}
                  />
                ),
              },
            ]}
          />
        </Section>,
      ]}
    />
  );
}

const REF_BODY_CAPTION_STYLE = {
  fontSize: "var(--font-size-caption)",
} as const;
