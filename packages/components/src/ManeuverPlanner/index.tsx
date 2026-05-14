import {
  type ActionDefinition,
  type ComponentProps,
  type CurrentOrbit,
  getBody,
  registerComponent,
  useDataValue,
  useExecuteAction,
  useOrbitElements,
} from "@gonogo/core";
import { useDataSchema, useManeuverNodes, useVesselDeltaV } from "@gonogo/data";
import {
  CheckIcon,
  Panel,
  PanelSubtitle,
  PanelTitle,
  ScrollArea,
} from "@gonogo/ui";
import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { ArmedTriggersList } from "./ArmedTriggersList";
import { useBurnCompletionTracker } from "./BurnCompletionTracker";
import { LocalManeuverTriggerService } from "./LocalManeuverTriggerService";
import { ManeuverNodeList } from "./ManeuverNodeList";
import { ManeuverPreview } from "./ManeuverPreview";
import type { NodeEditPatch } from "./NodeRow";
import { PresetInput } from "./PresetInput";
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

// Actions are stubbed at [] for now — the widget is mouse-driven. Hardware
// bindings (commit from a physical button) can be added later.
const maneuverActions = [] as const satisfies readonly ActionDefinition[];

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

  // Live orbit state — everything we need for the preset math + preview.
  const sma = useDataValue("data", "o.sma");
  const ecc = useDataValue("data", "o.eccentricity");
  const {
    apoapsisRadius: ApR,
    periapsisRadius: PeR,
    timeToApoapsis: timeToAp,
    timeToPeriapsis: timeToPe,
  } = useOrbitElements();
  const argPe = useDataValue("data", "o.argumentOfPeriapsis");
  const trueAnomaly = useDataValue("data", "o.trueAnomaly");
  const currentUT = useDataValue("data", "t.universalTime");
  const orbitalSpeed = useDataValue("data", "o.orbitalSpeed");
  const radius = useDataValue("data", "o.radius");
  const physicsMode = useDataValue("data", "a.physicsMode");
  const refBody = useDataValue("data", "o.referenceBody");
  const bodyName = useDataValue("data", "v.body");
  const inclination = useDataValue("data", "o.inclination");
  const targetName = useDataValue("data", "tar.name");
  const targetInclinationLive = useDataValue("data", "tar.o.inclination");
  const targetLanLive = useDataValue("data", "tar.o.lan");
  const targetSma = useDataValue("data", "tar.o.sma");
  const targetPeA = useDataValue("data", "tar.o.PeA");
  const targetArgPe = useDataValue("data", "tar.o.argumentOfPeriapsis");
  const targetTrueAnomaly = useDataValue("data", "tar.o.trueAnomaly");
  const targetPeriod = useDataValue("data", "tar.o.period");
  const lan = useDataValue("data", "o.lan");

  const period = useDataValue("data", "o.period");

  const nodes = useManeuverNodes();
  const vesselDeltaV = useVesselDeltaV();
  const execute = useExecuteAction("data");
  const schema = useDataSchema("data");

  const { completedNodes } = useBurnCompletionTracker(nodes, execute);

  // Armed conditional triggers come from a service — host service on the
  // main screen (see @gonogo/app/src/maneuverTriggers), client service on
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

  // Editor visibility — the picker's draft fields live inside `TriggerEditor`.
  const [triggerEditorOpen, setTriggerEditorOpen] = useState(false);

  const numericKeys = useMemo(
    () =>
      schema.filter(
        (k) =>
          k.unit !== "bool" &&
          k.unit !== "enum" &&
          k.unit !== "raw" &&
          k.group !== "Actions",
      ),
    [schema],
  );

  const principia = physicsMode === "n_body";
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
        lan,
        bodyRadius: body?.radius,
        targetAltitudeKm,
        targetSma,
        targetPeA,
        targetArgPe,
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
  const feasible =
    plan === null || vesselDeltaV.totalVac === 0
      ? null
      : vesselDeltaV.totalVac >= requiredDeltaV;

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
    for (const b of burns) {
      const action = `o.addManeuverNode[${b.ut.toFixed(3)},${b.radial.toFixed(3)},${b.normal.toFixed(3)},${b.prograde.toFixed(3)}]`;
      await execute(action);
    }
  }

  async function handleCommit() {
    if (!plan) return;
    if (principia) return;
    setCommitting(true);
    setError(null);
    try {
      // Telemachus passes `[ut,x,y,z]` straight to KSP's
      // `ManeuverNode.OnGizmoUpdated(new Vector3d(x,y,z), ut)`. KSP's
      // node-local frame is `Vector3d(radialOut, normal, prograde)` —
      // confirmed by kOS's Node.cs which constructs the same vector in
      // that exact order. So the on-wire order is RADIAL, NORMAL,
      // PROGRADE — *not* prograde-first. Sending pure prograde in the
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
    if (principia) return;
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

  async function handleDelete(id: number) {
    try {
      await execute(`o.removeManeuverNode[${id}]`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleEdit(id: number, patch: NodeEditPatch) {
    // Same vector convention as `o.addManeuverNode`: KSP's node-local frame is
    // `Vector3d(radialOut, normal, prograde)`, so the on-wire arg order is
    // RADIAL, NORMAL, PROGRADE — *not* prograde-first.
    const action = `o.updateManeuverNode[${id},${patch.ut.toFixed(3)},${patch.radial.toFixed(3)},${patch.normal.toFixed(3)},${patch.prograde.toFixed(3)}]`;
    try {
      await execute(action);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  async function handleClearAll() {
    // Remove from the highest index down — removing index 0 first would
    // shift every subsequent id and break the loop.
    for (let i = nodes.length - 1; i >= 0; i--) {
      await execute(`o.removeManeuverNode[${i}]`);
    }
  }

  // Per-field "is this telemetry ready?" map. Feeds the diagnostic
  // waiting panel — a generic "Waiting for telemetry…" with no detail
  // left us blind the first time it triggered, and real Telemachus
  // data can land values as null / NaN mid-scene-load that wouldn't
  // look "missing" to a simple `=== undefined` check.
  const telemetryStatus: Array<{ label: string; ok: boolean }> = [
    { label: "o.sma", ok: isFiniteNumber(sma) },
    { label: "o.eccentricity", ok: isFiniteNumber(ecc) },
    { label: "o.ApR / o.PeR", ok: isFiniteNumber(ApR) && isFiniteNumber(PeR) },
    {
      label: "o.timeToAp / o.timeToPe",
      ok: isFiniteNumber(timeToAp) && isFiniteNumber(timeToPe),
    },
    { label: "t.universalTime", ok: isFiniteNumber(currentUT) },
    { label: "μ (orbitalSpeed×radius or period)", ok: mu > 0 },
  ];
  const waiting = telemetryStatus.some((s) => !s.ok);

  // Render split into nested helpers so the component's cognitive
  // complexity stays below Sonar's S3776 threshold. Each helper is
  // measured independently by the rule.
  function renderNodesSection() {
    return (
      <Section>
        <SectionTitle>Planned nodes</SectionTitle>
        <ManeuverNodeList
          nodes={nodes}
          completedNodes={completedNodes}
          currentUT={currentUT}
          availableDv={vesselDeltaV.totalVac}
          onDelete={handleDelete}
          onEdit={handleEdit}
          onClearAll={handleClearAll}
        />
      </Section>
    );
  }

  function renderNewManeuverSection() {
    return (
      <Section>
        <SectionTitle>New maneuver</SectionTitle>
        <PresetInput
          api={inputsApi}
          telemetry={{
            currentUT,
            inclination,
            lan,
            targetName,
            targetInclinationLive,
            targetLanLive,
            targetPeA,
          }}
        />
      </Section>
    );
  }

  function renderWaitingPanel() {
    return (
      <WaitingPanel>
        <SectionTitle>Waiting for telemetry</SectionTitle>
        <StatusList>
          {telemetryStatus.map((s) => (
            <StatusRow key={s.label}>
              <StatusDot $ok={s.ok}>
                {s.ok ? <CheckIcon size={11} strokeWidth={2.5} /> : "·"}
              </StatusDot>
              <StatusLabel>{s.label}</StatusLabel>
            </StatusRow>
          ))}
        </StatusList>
      </WaitingPanel>
    );
  }

  function renderArmedTriggersSection() {
    if (armedTriggers.length === 0) return null;
    return (
      <Section>
        <SectionTitle>Armed triggers</SectionTitle>
        <ArmedTriggersList
          triggers={armedTriggers}
          onCancel={handleCancelTrigger}
        />
      </Section>
    );
  }

  return (
    <Panel>
      <PanelTitle>MANEUVER PLANNER</PanelTitle>
      {refBody !== undefined && <PanelSubtitle>{refBody}</PanelSubtitle>}
      <ScrollBody>
        {principia && (
          <PrincipiaBanner>
            N-body physics detected — impulsive maneuver nodes are unsupported
            under Principia. Commit disabled.
          </PrincipiaBanner>
        )}
        {renderNodesSection()}
        {renderArmedTriggersSection()}
        {renderNewManeuverSection()}
        {waiting ? (
          renderWaitingPanel()
        ) : (
          <ManeuverPreview
            plan={plan}
            currentOrbit={currentOrbit}
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
            vesselDeltaV={vesselDeltaV}
            feasible={feasible}
            requiredDeltaV={requiredDeltaV}
            currentUT={currentUT}
            error={error}
            principia={principia}
            committing={committing}
            triggerEditorOpen={triggerEditorOpen}
            setTriggerEditorOpen={setTriggerEditorOpen}
            numericKeys={numericKeys}
            onCommit={handleCommit}
            onArm={handleArmTrigger}
          />
        )}
      </ScrollBody>
    </Panel>
  );
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
  dataRequirements: [
    "o.sma",
    "o.eccentricity",
    "o.ApR",
    "o.PeR",
    "o.argumentOfPeriapsis",
    "o.inclination",
    "o.lan",
    "o.trueAnomaly",
    "o.timeToAp",
    "o.timeToPe",
    "o.orbitalSpeed",
    "o.radius",
    "o.referenceBody",
    "o.maneuverNodes",
    "t.universalTime",
    "a.physicsMode",
    "v.body",
    "dv.stages",
    "tar.name",
    "tar.o.inclination",
    "tar.o.lan",
    "tar.o.sma",
    "tar.o.PeA",
    "tar.o.argumentOfPeriapsis",
    "tar.o.trueAnomaly",
    "tar.o.period",
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

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 4px;
`;

const SectionTitle = styled.h4`
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-dim);
  margin: 0 0 2px 0;
`;

const PrincipiaBanner = styled.div`
  font-size: 11px;
  background: var(--color-status-alert-muted);
  border: 1px solid var(--color-border-strong);
  color: var(--color-status-nogo-fg);
  padding: 4px 8px;
  border-radius: 2px;
`;

const ScrollBody = styled(ScrollArea)`
  flex: 1;
  [data-scroll-area-inner] {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
`;

const WaitingPanel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-surface-raised);
  border-radius: 2px;
`;

const StatusList = styled.ul`
  display: flex;
  flex-direction: column;
  gap: 2px;
  list-style: none;
  margin: 0;
  padding: 0;
`;

const StatusRow = styled.li`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const StatusDot = styled.span<{ $ok: boolean }>`
  width: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${({ $ok }) => ($ok ? "var(--color-accent-fg)" : "var(--color-text-muted)")};
  font-size: 11px;
`;

const StatusLabel = styled.span`
  font-size: 11px;
  color: var(--color-text-muted);
`;
