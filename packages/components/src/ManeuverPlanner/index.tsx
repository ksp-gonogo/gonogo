import {
  type ActionDefinition,
  type ComponentProps,
  type CurrentOrbit,
  circularizeAtApo,
  circularizeAtPeri,
  customAtApsis,
  customAtUT,
  formatDistance,
  formatDuration,
  getBody,
  gravParameterFromState,
  type ManeuverPlan,
  matchInclination,
  matchTargetPlane,
  registerComponent,
  stateAtUT,
  useDataValue,
  useExecuteAction,
} from "@gonogo/core";
import { useManeuverNodes, useVesselDeltaV } from "@gonogo/data";
import { Button, Panel, PanelSubtitle, PanelTitle } from "@gonogo/ui";
import { useMemo, useState } from "react";
import styled from "styled-components";
import { OrbitDiagram } from "../shared/OrbitDiagram";
import { LabeledInput } from "./LabeledInput";
import { NodeRow } from "./NodeRow";
import { PresetPicker } from "./PresetPicker";
import {
  isFiniteNumber,
  type ManeuverPlannerConfig,
  PRESETS,
  type PresetId,
} from "./presets";
import {
  FeasibilityBanner,
  FeasibilityBannerBody,
  FeasibilityBannerTitle,
  FeasibilityChip,
} from "./styles";

// Actions are stubbed at [] for now — the widget is mouse-driven. Hardware
// bindings (commit from a physical button) can be added later.
const maneuverActions = [] as const satisfies readonly ActionDefinition[];

// ---------------------------------------------------------------------------
// Plan dispatch — lives outside the component so each preset branch can be
// read in isolation and so the component's cognitive complexity stays low
// (Sonar S3776). Pure function: same inputs → same ManeuverPlan | null.
// ---------------------------------------------------------------------------

interface PlanInputs {
  preset: PresetId;
  currentOrbit: CurrentOrbit | null;
  currentUT: number | undefined;
  mu: number;
  prograde: number;
  normal: number;
  radial: number;
  burnInSeconds: number;
  utMode: "relative" | "absolute";
  burnAtUT: number;
  trueAnomaly: number | undefined;
  argPe: number | undefined;
  inclination: number | undefined;
  targetInclination: number;
  targetInclinationLive: number | undefined;
  targetLanLive: number | undefined;
  lan: number | undefined;
}

function computePlan(i: PlanInputs): ManeuverPlan | null {
  if (!i.currentOrbit || i.currentUT === undefined || i.mu <= 0) return null;
  switch (i.preset) {
    case "circularize-apo":
      return circularizeAtApo(i.currentOrbit, i.mu, i.currentUT);
    case "circularize-peri":
      return circularizeAtPeri(i.currentOrbit, i.mu, i.currentUT);
    case "custom-apo":
    case "custom-peri":
      return customAtApsis(
        i.currentOrbit,
        i.mu,
        i.currentUT,
        i.preset === "custom-apo" ? "apo" : "peri",
        i.prograde,
        i.normal,
        i.radial,
      );
    case "custom-ut":
      return planCustomUT(i);
    case "match-inclination":
      return planMatchInclination(i, i.targetInclination);
    case "match-target-inclination":
      if (i.targetInclinationLive === undefined) return null;
      return planMatchInclination(i, i.targetInclinationLive);
    case "match-target-plane":
      return planMatchTargetPlane(i);
  }
}

function planCustomUT(i: PlanInputs): ManeuverPlan | null {
  if (
    i.trueAnomaly === undefined ||
    !i.currentOrbit ||
    i.currentUT === undefined
  ) {
    return null;
  }
  const burnUT =
    i.utMode === "absolute"
      ? i.burnAtUT
      : i.currentUT + Math.max(0, i.burnInSeconds);
  return customAtUT(
    i.currentOrbit,
    i.trueAnomaly,
    i.mu,
    i.currentUT,
    burnUT,
    i.prograde,
    i.normal,
    i.radial,
  );
}

function planMatchInclination(
  i: PlanInputs,
  targetInc: number,
): ManeuverPlan | null {
  if (
    !i.currentOrbit ||
    i.currentUT === undefined ||
    i.trueAnomaly === undefined ||
    i.argPe === undefined ||
    i.inclination === undefined
  ) {
    return null;
  }
  return matchInclination(
    i.currentOrbit,
    i.trueAnomaly,
    i.argPe,
    i.inclination,
    i.mu,
    i.currentUT,
    targetInc,
  );
}

/**
 * All orbital scalars must be finite before we can construct a
 * CurrentOrbit — otherwise the propagator hits NaNs and downstream
 * widgets render garbage. Split out so the component body doesn't pay
 * the complexity cost of a six-term && chain.
 */
function buildCurrentOrbit(vals: {
  sma: number | undefined;
  ecc: number | undefined;
  ApR: number | undefined;
  PeR: number | undefined;
  timeToAp: number | undefined;
  timeToPe: number | undefined;
}): CurrentOrbit | null {
  const { sma, ecc, ApR, PeR, timeToAp, timeToPe } = vals;
  if (
    !isFiniteNumber(sma) ||
    !isFiniteNumber(ecc) ||
    !isFiniteNumber(ApR) ||
    !isFiniteNumber(PeR) ||
    !isFiniteNumber(timeToAp) ||
    !isFiniteNumber(timeToPe)
  ) {
    return null;
  }
  return { sma, eccentricity: ecc, ApR, PeR, timeToAp, timeToPe };
}

/**
 * μ from live telemetry only — never the body-registry value. vis-viva
 * (v²·a·r/(2a−r)) is preferred; Kepler's 3rd (4π²a³/T²) is the fallback
 * for the brief window at scene load when orbitalSpeed/radius haven't
 * streamed yet. Returns 0 when neither formula has usable inputs.
 */
function computeMu(
  orbitalSpeed: number | undefined,
  radius: number | undefined,
  sma: number | undefined,
  period: number | undefined,
): number {
  if (
    isFiniteNumber(orbitalSpeed) &&
    isFiniteNumber(radius) &&
    isFiniteNumber(sma) &&
    orbitalSpeed > 0 &&
    sma > 0
  ) {
    const viaVisViva = gravParameterFromState(orbitalSpeed, radius, sma);
    if (viaVisViva > 0) return viaVisViva;
  }
  if (isFiniteNumber(period) && isFiniteNumber(sma) && period > 0) {
    return (4 * Math.PI * Math.PI * sma ** 3) / (period * period);
  }
  return 0;
}

/** True anomaly at the burn for drag-handle placement. Null outside the
 *  custom-* presets or when inputs aren't ready. */
function computeBurnTrueAnomaly(i: PlanInputs): number | null {
  if (!i.currentOrbit || i.currentUT === undefined || i.mu <= 0) return null;
  if (i.preset === "custom-apo") return 180;
  if (i.preset === "custom-peri") return 0;
  if (i.preset !== "custom-ut") return null;
  if (i.trueAnomaly === undefined) return null;
  const burnUT =
    i.utMode === "absolute"
      ? i.burnAtUT
      : i.currentUT + Math.max(0, i.burnInSeconds);
  if (burnUT <= i.currentUT) return null;
  return stateAtUT(i.currentOrbit, i.trueAnomaly, i.mu, i.currentUT, burnUT)
    .trueAnomalyDeg;
}

function planMatchTargetPlane(i: PlanInputs): ManeuverPlan | null {
  if (
    !i.currentOrbit ||
    i.currentUT === undefined ||
    i.trueAnomaly === undefined ||
    i.argPe === undefined ||
    i.inclination === undefined ||
    i.lan === undefined ||
    i.targetInclinationLive === undefined ||
    i.targetLanLive === undefined
  ) {
    return null;
  }
  return matchTargetPlane(
    i.currentOrbit,
    i.trueAnomaly,
    i.argPe,
    i.inclination,
    i.lan,
    i.targetInclinationLive,
    i.targetLanLive,
    i.mu,
    i.currentUT,
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function ManeuverPlannerComponent({
  config,
}: Readonly<ComponentProps<ManeuverPlannerConfig>>) {
  const [preset, setPreset] = useState<PresetId>(
    config?.defaultPreset ?? "circularize-apo",
  );
  const [prograde, setPrograde] = useState(0);
  const [normal, setNormal] = useState(0);
  const [radial, setRadial] = useState(0);
  // "Burn in N seconds" input for the custom-ut preset. Default 60s so the
  // UI always has a sensible future UT even before the user touches it.
  const [burnInSeconds, setBurnInSeconds] = useState(60);
  // "relative" → burnInSeconds from now; "absolute" → burnAtUT as entered.
  const [utMode, setUtMode] = useState<"relative" | "absolute">("relative");
  const [burnAtUT, setBurnAtUT] = useState(0);
  // Target inclination for the match-inclination preset (°).
  const [targetInclination, setTargetInclination] = useState(0);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live orbit state — everything we need for the preset math + preview.
  const sma = useDataValue("data", "o.sma");
  const ecc = useDataValue("data", "o.eccentricity");
  const ApR = useDataValue("data", "o.ApR");
  const PeR = useDataValue("data", "o.PeR");
  const argPe = useDataValue("data", "o.argumentOfPeriapsis");
  const trueAnomaly = useDataValue("data", "o.trueAnomaly");
  const timeToAp = useDataValue("data", "o.timeToAp");
  const timeToPe = useDataValue("data", "o.timeToPe");
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
  const lan = useDataValue("data", "o.lan");

  const period = useDataValue("data", "o.period");

  const nodes = useManeuverNodes();
  const vesselDeltaV = useVesselDeltaV();
  const execute = useExecuteAction("data");

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

  const plan: ManeuverPlan | null = useMemo(
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
    ],
  );

  const feasible =
    plan === null || vesselDeltaV.totalVac === 0
      ? null
      : vesselDeltaV.totalVac >= plan.requiredDeltaV;

  // True anomaly at the burn, for drag-handle placement on the preview.
  // Apsis presets are exact (0° / 180°); custom-ut re-uses our propagator.
  const burnTrueAnomaly: number | null = useMemo(
    () =>
      computeBurnTrueAnomaly({
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
      prograde,
      normal,
      radial,
      argPe,
      inclination,
      targetInclination,
      targetInclinationLive,
      targetLanLive,
      lan,
    ],
  );

  async function handleCommit() {
    if (!plan) return;
    if (principia) return;
    setCommitting(true);
    setError(null);
    try {
      // Telemachus Reborn uses `[ut,x,y,z]` args on the action key. Each
      // component in the vector is the prograde/normal/radial ΔV in the
      // node's local frame (m/s).
      const action = `o.addManeuverNode[${plan.ut.toFixed(3)},${plan.prograde.toFixed(3)},${plan.normal.toFixed(3)},${plan.radial.toFixed(3)}]`;
      await execute(action);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommitting(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await execute(`o.removeManeuverNode[${id}]`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleClearAll() {
    // Remove from the highest index down — removing index 0 first would
    // shift every subsequent id and break the loop.
    for (let i = nodes.length - 1; i >= 0; i--) {
      await execute(`o.removeManeuverNode[${i}]`);
    }
  }

  const selectedPreset = PRESETS.find((p) => p.id === preset);

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
        {nodes.length === 0 ? (
          <Empty>No maneuver nodes planned.</Empty>
        ) : (
          <NodeList>
            {nodes.map((n) => (
              <NodeRow
                key={n.id}
                node={n}
                currentUT={currentUT}
                availableDv={vesselDeltaV.totalVac}
                onDelete={() => void handleDelete(n.id)}
              />
            ))}
          </NodeList>
        )}
        {nodes.length > 1 && (
          <ClearAllRow>
            <GhostLink type="button" onClick={() => void handleClearAll()}>
              Clear all
            </GhostLink>
          </ClearAllRow>
        )}
      </Section>
    );
  }

  function renderCustomInputs() {
    if (!selectedPreset?.needsCustomInput) return null;
    if (preset === "match-inclination") {
      return (
        <CustomInputs>
          <LabeledInput
            label="Target inc"
            value={targetInclination}
            onChange={setTargetInclination}
            suffix="°"
          />
        </CustomInputs>
      );
    }
    return (
      <CustomInputs>
        {preset === "custom-ut" && renderUtModeInputs()}
        <LabeledInput
          label="Prograde"
          value={prograde}
          onChange={setPrograde}
        />
        <LabeledInput label="Normal" value={normal} onChange={setNormal} />
        <LabeledInput label="Radial" value={radial} onChange={setRadial} />
      </CustomInputs>
    );
  }

  function renderUtModeInputs() {
    return (
      <>
        <UTModeRow>
          <UTModeButton
            $active={utMode === "relative"}
            type="button"
            onClick={() => setUtMode("relative")}
          >
            burn in
          </UTModeButton>
          <UTModeButton
            $active={utMode === "absolute"}
            type="button"
            onClick={() => {
              // Seed the absolute field with "now + 60s" the first time
              // the user flips modes, so they don't see a 0.
              if (burnAtUT === 0 && currentUT !== undefined) {
                setBurnAtUT(currentUT + 60);
              }
              setUtMode("absolute");
            }}
          >
            at UT
          </UTModeButton>
        </UTModeRow>
        {utMode === "relative" ? (
          <LabeledInput
            label="Burn in"
            value={burnInSeconds}
            onChange={setBurnInSeconds}
            suffix="s"
          />
        ) : (
          <LabeledInput
            label="At UT"
            value={burnAtUT}
            onChange={setBurnAtUT}
            suffix=""
          />
        )}
      </>
    );
  }

  function renderTargetDescription() {
    if (preset === "match-target-inclination") {
      return (
        <PresetDesc>
          {targetName
            ? `Target: ${targetName} (${(targetInclinationLive ?? 0).toFixed(1)}°)`
            : "No target selected in-game."}
        </PresetDesc>
      );
    }
    if (preset === "match-target-plane") {
      return (
        <PresetDesc>
          {targetName && targetLanLive !== undefined
            ? `Target: ${targetName} — i=${(targetInclinationLive ?? 0).toFixed(1)}° Ω=${targetLanLive.toFixed(1)}°`
            : "No target selected in-game (or target LAN unavailable)."}
        </PresetDesc>
      );
    }
    return null;
  }

  function renderNewManeuverSection() {
    return (
      <Section>
        <SectionTitle>New maneuver</SectionTitle>
        <PresetPicker
          value={preset}
          onChange={(next) => {
            setPreset(next);
            if (!PRESETS.find((p) => p.id === next)?.needsCustomInput) {
              setPrograde(0);
              setNormal(0);
              setRadial(0);
            }
          }}
        />
        {selectedPreset?.description && (
          <PresetDesc>{selectedPreset.description}</PresetDesc>
        )}
        {renderCustomInputs()}
        {renderTargetDescription()}
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
              <StatusDot $ok={s.ok}>{s.ok ? "✓" : "·"}</StatusDot>
              <StatusLabel>{s.label}</StatusLabel>
            </StatusRow>
          ))}
        </StatusList>
      </WaitingPanel>
    );
  }

  function renderPreviewGrid() {
    if (!plan) return null;
    return (
      <PreviewGrid>
        <Label>ΔV</Label>
        <Value>{plan.requiredDeltaV.toFixed(1)} m/s</Value>

        <Label>Burn in</Label>
        <Value>{formatDuration(plan.ut - (currentUT ?? 0))}</Value>

        <Label>Available</Label>
        <Value>
          {vesselDeltaV.totalVac === 0
            ? "—"
            : `${vesselDeltaV.totalVac.toFixed(0)} m/s`}
          {feasible !== null && (
            <FeasibilityChip $ok={feasible}>
              {feasible ? "OK" : "SHORT"}
            </FeasibilityChip>
          )}
        </Value>

        {renderProjectedRows()}
      </PreviewGrid>
    );
  }

  function renderProjectedRows() {
    if (!plan?.projected) {
      return (
        <>
          <Label>Projection</Label>
          <Value>escape / invalid</Value>
        </>
      );
    }
    const p = plan.projected;
    return (
      <>
        <Label>New Ap</Label>
        <Value $accent="ap">
          {formatDistance(p.ApR - (body?.radius ?? 0))}
        </Value>
        <Label>New Pe</Label>
        <Value $accent="pe">
          {formatDistance(p.PeR - (body?.radius ?? 0))}
        </Value>
        <Label>New Ecc</Label>
        <Value>{p.eccentricity.toFixed(4)}</Value>
        <Label>New T</Label>
        <Value>{formatDuration(p.period)}</Value>
        {p.inclination !== undefined && (
          <>
            <Label>New Inc</Label>
            <Value>{p.inclination.toFixed(2)}°</Value>
          </>
        )}
      </>
    );
  }

  function renderDiagram() {
    if (!plan || !currentOrbit || !ApR || !PeR) return null;
    const customWithHandles =
      preset === "custom-apo" ||
      preset === "custom-peri" ||
      preset === "custom-ut";
    return (
      <DiagramWrap>
        <OrbitDiagram
          variant="mini"
          sma={sma ?? 0}
          ecc={ecc ?? 0}
          apoapsis={ApR}
          periapsis={PeR}
          trueAnomaly={trueAnomaly ?? 0}
          argPe={argPe ?? 0}
          bodyColor={body?.color}
          bodyRadius={body?.radius}
          projected={
            plan.projected
              ? {
                  sma: plan.projected.sma,
                  ecc: plan.projected.eccentricity,
                  apoapsis: plan.projected.ApR,
                  periapsis: plan.projected.PeR,
                }
              : null
          }
          maneuverHandles={
            burnTrueAnomaly !== null && customWithHandles
              ? {
                  burnTrueAnomaly,
                  prograde,
                  radial,
                  onPrograde: setPrograde,
                  onRadial: setRadial,
                }
              : null
          }
        />
      </DiagramWrap>
    );
  }

  function renderShortfallBanner() {
    if (feasible !== false || !plan) return null;
    return (
      <FeasibilityBanner role="alert">
        <FeasibilityBannerTitle>
          ΔV shortfall — commit disabled
        </FeasibilityBannerTitle>
        <FeasibilityBannerBody>
          Required {plan.requiredDeltaV.toFixed(0)} m/s · available{" "}
          {vesselDeltaV.totalVac.toFixed(0)} m/s ·{" "}
          {(plan.requiredDeltaV - vesselDeltaV.totalVac).toFixed(0)} m/s short.
        </FeasibilityBannerBody>
      </FeasibilityBanner>
    );
  }

  function renderPreview() {
    if (!plan) return null;
    return (
      <PreviewSection>
        <SectionTitle>Preview</SectionTitle>
        {renderPreviewGrid()}
        {renderDiagram()}
        {normal !== 0 && (
          <Note>
            Normal component tilts the plane; projection shows in-plane shape
            only.
          </Note>
        )}
        {renderShortfallBanner()}
        {error && <ErrorLine>{error}</ErrorLine>}
        <CommitRow>
          <Button
            onClick={() => void handleCommit()}
            disabled={committing || principia || feasible === false}
          >
            {committing ? "Adding…" : "Add node"}
          </Button>
        </CommitRow>
      </PreviewSection>
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
        {renderNewManeuverSection()}
        {waiting ? renderWaitingPanel() : renderPreview()}
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
  ],
  defaultConfig: { defaultPreset: "circularize-apo" },
  actions: maneuverActions,
  pushable: true,
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

const SectionTitle = styled.div`
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #666;
  margin-bottom: 2px;
`;

const PrincipiaBanner = styled.div`
  font-size: 11px;
  background: #3a1a1a;
  border: 1px solid #4a2a2a;
  color: #fbb;
  padding: 4px 8px;
  border-radius: 2px;
`;

const Empty = styled.div`
  color: #555;
  font-size: 11px;
  padding: 4px 0;
`;

const ScrollBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* Reserve a sliver for the scrollbar so content isn't pushed under it. */
  padding-right: 4px;
`;

const WaitingPanel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  background: #0f0f0f;
  border: 1px solid #1f1f1f;
  border-radius: 2px;
`;

const StatusList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const StatusRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const StatusDot = styled.span<{ $ok: boolean }>`
  width: 12px;
  text-align: center;
  color: ${({ $ok }) => ($ok ? "#5f5" : "#a66")};
  font-family: monospace;
  font-size: 11px;
`;

const StatusLabel = styled.span`
  font-family: monospace;
  font-size: 11px;
  color: #888;
`;

const NodeList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const ClearAllRow = styled.div`
  display: flex;
  justify-content: flex-end;
  padding-top: 2px;
`;

const GhostLink = styled.button`
  background: transparent;
  border: none;
  color: #666;
  font-family: monospace;
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline;
  &:hover {
    color: #aaa;
  }
`;

const PresetDesc = styled.div`
  font-size: 11px;
  color: #666;
  padding-top: 2px;
`;

const CustomInputs = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 4px;
`;

const UTModeRow = styled.div`
  display: flex;
  gap: 4px;
`;

const UTModeButton = styled.button<{ $active: boolean }>`
  background: ${({ $active }) => ($active ? "#2e5a2e" : "#1a1a1a")};
  border: 1px solid ${({ $active }) => ($active ? "#3e7a3e" : "#2a2a2a")};
  color: ${({ $active }) => ($active ? "#cfe" : "#888")};
  font-family: monospace;
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 2px;
  cursor: pointer;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const PreviewSection = styled.section`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 4px;
`;

const PreviewGrid = styled.div`
  display: grid;
  grid-template-columns: 4em 1fr;
  gap: 2px 8px;
  align-items: baseline;
`;

const Label = styled.span`
  font-size: 10px;
  color: #555;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const accentColor = {
  ap: "#ff8c00",
  pe: "#4499ff",
};

const Value = styled.span<{ $accent?: "ap" | "pe" }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: ${({ $accent }) => ($accent ? accentColor[$accent] : "#ccc")};
  letter-spacing: 0.03em;
`;

const DiagramWrap = styled.div`
  height: 180px;
  flex-shrink: 0;
  display: flex;
`;

const Note = styled.div`
  font-size: 10px;
  color: #666;
  font-style: italic;
`;

const ErrorLine = styled.div`
  font-size: 11px;
  color: #fbb;
  background: #2a1111;
  border: 1px solid #4a2a2a;
  padding: 4px 6px;
  border-radius: 2px;
`;

const CommitRow = styled.div`
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
`;
