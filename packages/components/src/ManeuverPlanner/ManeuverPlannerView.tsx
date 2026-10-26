import type { ComponentProps } from "@ksp-gonogo/core";
import { useManeuverNodes, useNumericFields } from "@ksp-gonogo/data";
import { useStream } from "@ksp-gonogo/sitrep-client";
import type { VesselManeuver } from "@ksp-gonogo/sitrep-sdk";
import {
  Panel,
  Section,
  Stack,
  Tabs,
  Text,
  useElementSize,
} from "@ksp-gonogo/ui-kit";
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
import {
  type ManeuverPlannerConfig,
  usesBodyTransfer,
  usesTarget,
} from "./presets";
import { TransferCheck } from "./TransferCheck";
import { useTriggerSnapshot } from "./triggerService";
import type { FrozenPlanInputs, ThresholdOp } from "./triggerTypes";
import { useNodeCommands } from "./useNodeCommands";
import { usePlan } from "./usePlan";
import { usePlannerInputs } from "./usePlannerInputs";
import { usePlannerTab } from "./usePlannerTab";
import { usePlannerTelemetry } from "./usePlannerTelemetry";
import { usePlannerTriggerService } from "./usePlannerTriggerService";

export function ManeuverPlannerComponent({
  id,
  config,
}: Readonly<ComponentProps<ManeuverPlannerConfig>>) {
  const [tab, setTab] = usePlannerTab(id);
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
    apsisDefined,
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
    landed,
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

  const caption = refBody !== undefined && (
    <Section key="body" full>
      <Text
        level="muted"
        style={REF_BODY_CAPTION_STYLE}
        data-ref-body-caption=""
      >
        {refBody}
      </Text>
    </Section>
  );
  const nodeSection = (
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
      {usesBodyTransfer(inputs.preset) && inputs.transferBody !== "" && (
        <TransferCheck
          nodes={nodes}
          target={inputs.transferBody}
          onNudge={handleEdit}
        />
      )}
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
    </Section>
  );
  const windows = (
    <BurnWindowsSection
      key="windows"
      nodes={nodes}
      currentUT={nowUtSeconds}
      from={planCurrency}
    />
  );
  const newManeuver = (
    <NewManeuverSection key="new" api={inputsApi} telemetry={telemetry} />
  );
  const preview = planReady ? (
    <ManeuverPreview
      key="preview"
      plan={plan}
      currentOrbit={currentOrbit}
      currentTrajectory={currentTrajectory}
      body={body}
      preset={inputs.preset}
      burnTrueAnomaly={burnTrueAnomaly}
      apsisDefined={apsisDefined}
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
        landed={landed}
        currentTrajectory={currentTrajectory}
      />
    </Section>
  );
  // What was flown against what was planned: the retrospective on the nodes above.
  const conformance = (
    <ConformanceSection
      key="conformance"
      maxPlotHeight="16rem"
      nodes={nodes}
      awaiting={planAwaited}
      watches={watches}
      telemetry={telemetry}
      from={planCurrency}
    />
  );
  /*
   * The plan reads top to bottom in one block, and the flight plan (nodes, burn
   * windows, conformance) beside it where there is room: Tabs lays the two out
   * side by side from two columns' width and as a strip with one panel below.
   */
  const planBlock = (
    <Stack key="plan" style={PLAN_BLOCK_STYLE}>
      {newManeuver}
      {preview}
    </Stack>
  );
  /*
   * Side by side needs room in height as well as width: the flight plan column
   * stacks the planned nodes over their burn windows, which a wide, short tile
   * cannot hold. Below this height the two views are tabs, one panel at a time.
   * Unmeasured counts as short, like the width does.
   */
  const { ref: tile, size } = useElementSize<HTMLDivElement>({ w: 0, h: 0 });
  const tall = size.h >= SIDE_BY_SIDE_MIN_HEIGHT;
  const flightPlan = (
    <Stack key="flight" style={FLIGHT_COLUMN_STYLE}>
      {nodeSection}
      {windows}
      {nodes.length > 0 && conformance}
    </Stack>
  );
  return (
    <div ref={tile} style={TILE_STYLE}>
      <Panel
        panelTitle="MANEUVER PLANNER"
        sectionMinWidth="100%"
        sections={[
          caption,
          <Tabs
            key="body"
            aria-label="Maneuver planner views"
            expandWhenRoomy={tall}
            activeId={tab}
            onChange={setTab}
            tabs={[
              { id: "plan", label: "New maneuver", content: planBlock },
              { id: "flight", label: "Flight plan", content: flightPlan },
            ]}
          />,
        ]}
      />
    </div>
  );
}

/** The tile height, in CSS pixels, from which the plan and the flight plan may sit side by side: the flight plan column's node and three instants with room to spare. */
const SIDE_BY_SIDE_MIN_HEIGHT = 520;

const TILE_STYLE = { height: "100%", minHeight: 0 } as const;

const PLAN_BLOCK_STYLE = { gap: "var(--gap-related)" } as const;

const FLIGHT_COLUMN_STYLE = { gap: "var(--gap-panel-sections)" } as const;

const REF_BODY_CAPTION_STYLE = {
  fontSize: "var(--font-size-caption)",
} as const;
