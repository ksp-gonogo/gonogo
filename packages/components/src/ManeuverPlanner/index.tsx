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
  hohmannRendezvous,
  hohmannToRadius,
  type ManeuverPlan,
  type ManeuverSequence,
  matchInclination,
  matchTargetPlane,
  registerComponent,
  stateAtUT,
  useDataValue,
  useExecuteAction,
} from "@gonogo/core";
import {
  type ParsedManeuverNode,
  useDataSchema,
  useManeuverNodes,
  useVesselDeltaV,
} from "@gonogo/data";
import {
  Button,
  DataKeyPicker,
  Panel,
  PanelSubtitle,
  PanelTitle,
} from "@gonogo/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// A maneuver counts as "complete" once its remaining ΔV crosses below this
// threshold *after* having been observed above it — guards against tiny
// freshly-planned correction burns being mistaken for completed ones.
const COMPLETED_THRESHOLD_DV = 0.5;
// Wall-clock hold so the operator gets visual confirmation. Real time, not
// game time — timewarp would otherwise expire it instantly post-burn.
const COMPLETED_HOLD_MS = 10_000;

interface CompletedEntry {
  snapshot: ParsedManeuverNode;
  completedAt: number;
}

// Operator set mirrors `ThresholdOp` in the alarms module — kept local so
// the components package doesn't depend on app-only types.
type ThresholdOp = ">" | ">=" | "<" | "<=" | "==" | "!=";
const THRESHOLD_OPS: ThresholdOp[] = [">", ">=", "<", "<=", "==", "!="];

function compareThreshold(
  value: number,
  op: ThresholdOp,
  threshold: number,
): boolean {
  switch (op) {
    case ">":
      return value > threshold;
    case ">=":
      return value >= threshold;
    case "<":
      return value < threshold;
    case "<=":
      return value <= threshold;
    case "==":
      return value === threshold;
    case "!=":
      return value !== threshold;
  }
}

// User-input fields captured at arm time. Live orbit data is *not* frozen —
// the trigger is meant to fire "compute the burn against current orbit when
// the condition holds", which requires fresh `currentOrbit` / `mu` / etc.
interface FrozenPlanInputs {
  preset: PresetId;
  prograde: number;
  normal: number;
  radial: number;
  burnInSeconds: number;
  utMode: "relative" | "absolute";
  burnAtUT: number;
  targetInclination: number;
  targetAltitudeKm: number;
  standoffMeters: number;
}

interface ArmedTrigger {
  id: string;
  dataKey: string;
  op: ThresholdOp;
  value: number;
  inputs: FrozenPlanInputs;
}

/** Subscribes to one armed trigger's data key and fires once when the
 *  comparison first holds. Rendered as a sibling per active trigger so
 *  hooks aren't called in a loop, and unmounts when the trigger disarms. */
function ArmedTriggerWatcher({
  trigger,
  onFire,
}: {
  trigger: ArmedTrigger;
  onFire: (trigger: ArmedTrigger) => void;
}) {
  const value = useDataValue("data", trigger.dataKey);
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    if (compareThreshold(value, trigger.op, trigger.value)) {
      fired.current = true;
      onFire(trigger);
    }
  }, [value, trigger, onFire]);
  return null;
}

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
  /** Body radius — converts the Hohmann altitude input into a radius. */
  bodyRadius: number | undefined;
  /** Hohmann target altitude (km above the reference body). */
  targetAltitudeKm: number;
  /** Live target orbit fields for hohmann-rendezvous-target. */
  targetSma: number | undefined;
  targetPeA: number | undefined;
  targetArgPe: number | undefined;
  targetTrueAnomaly: number | undefined;
  targetPeriod: number | undefined;
  /** Rendezvous standoff offset along-track on target orbit (m). */
  standoffMeters: number;
}

/** Either a single-burn plan (existing presets) or a multi-burn sequence
 *  (Hohmann). Render code branches on `"burns" in result`. */
type PlanResult = ManeuverPlan | ManeuverSequence;

function isSequence(result: PlanResult): result is ManeuverSequence {
  return "burns" in result;
}

function computePlan(i: PlanInputs): PlanResult | null {
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
    case "hohmann-to-altitude":
      return planHohmann(i);
    case "hohmann-rendezvous-target":
      return planHohmannRendezvous(i);
    case "match-inclination":
      return planMatchInclination(i, i.targetInclination);
    case "match-target-inclination":
      if (i.targetInclinationLive === undefined) return null;
      return planMatchInclination(i, i.targetInclinationLive);
    case "match-target-plane":
      return planMatchTargetPlane(i);
  }
}

function planHohmann(i: PlanInputs): ManeuverSequence | null {
  if (
    !i.currentOrbit ||
    i.currentUT === undefined ||
    i.bodyRadius === undefined ||
    !(i.bodyRadius > 0)
  ) {
    return null;
  }
  const targetR = i.bodyRadius + i.targetAltitudeKm * 1000;
  if (!(targetR > 0)) return null;
  return hohmannToRadius(i.currentOrbit, i.mu, i.currentUT, targetR);
}

function planHohmannRendezvous(i: PlanInputs): ManeuverSequence | null {
  if (
    !i.currentOrbit ||
    i.currentUT === undefined ||
    i.trueAnomaly === undefined ||
    i.argPe === undefined ||
    i.inclination === undefined ||
    i.lan === undefined ||
    i.targetSma === undefined ||
    i.targetPeA === undefined ||
    i.targetInclinationLive === undefined ||
    i.targetLanLive === undefined ||
    i.targetArgPe === undefined ||
    i.targetTrueAnomaly === undefined ||
    i.targetPeriod === undefined ||
    i.bodyRadius === undefined ||
    !(i.bodyRadius > 0)
  ) {
    return null;
  }
  return hohmannRendezvous(
    i.currentOrbit,
    i.trueAnomaly,
    i.argPe,
    i.inclination,
    i.lan,
    i.mu,
    i.currentUT,
    {
      sma: i.targetSma,
      // Telemachus reports PeA (altitude); convert to PeR (from body centre).
      PeR: i.bodyRadius + i.targetPeA,
      inclinationDeg: i.targetInclinationLive,
      lanDeg: i.targetLanLive,
      argPeDeg: i.targetArgPe,
      trueAnomalyDeg: i.targetTrueAnomaly,
      period: i.targetPeriod,
    },
    i.standoffMeters,
  );
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

/** Relative inclination (°) between two orbits given each one's
 *  inclination + LAN. Returns null if any input is missing. Used in the
 *  rendezvous preset description so the user can see whether the
 *  preset will prepend a plane-match burn (threshold 0.5°). */
function computeRelInc(
  inc1: number | undefined,
  lan1: number | undefined,
  inc2: number | undefined,
  lan2: number | undefined,
): number | null {
  if (
    inc1 === undefined ||
    lan1 === undefined ||
    inc2 === undefined ||
    lan2 === undefined
  ) {
    return null;
  }
  const i1 = (inc1 * Math.PI) / 180;
  const i2 = (inc2 * Math.PI) / 180;
  const dOmega = ((lan2 - lan1) * Math.PI) / 180;
  const cosRel =
    Math.cos(i1) * Math.cos(i2) +
    Math.sin(i1) * Math.sin(i2) * Math.cos(dOmega);
  return (Math.acos(Math.max(-1, Math.min(1, cosRel))) * 180) / Math.PI;
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
  // Target altitude for the hohmann-to-altitude preset (km above body).
  const [targetAltitudeKm, setTargetAltitudeKm] = useState(100);
  // Standoff distance for hohmann-rendezvous-target (m, along-track).
  const [standoffMeters, setStandoffMeters] = useState(
    config?.defaultStandoffMeters ?? 500,
  );
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

  // Completion tracking. Keyed by UT (stable across index shifts when KSP
  // re-numbers the list after a removal). `completedNodes` is React state so
  // re-renders pick up the green flash; `maxDvByUt` is a ref because it's
  // pure derived bookkeeping.
  const [completedNodes, setCompletedNodes] = useState<
    Map<number, CompletedEntry>
  >(() => new Map());
  const maxDvByUt = useRef<Map<number, number>>(new Map());
  // Latest `nodes` for use inside the auto-removal timeout — without this
  // ref the timeout would close over a stale list and look up the wrong id.
  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    const max = maxDvByUt.current;
    for (const n of nodes) {
      const prev = max.get(n.UT) ?? 0;
      if (n.deltaVMagnitude > prev) max.set(n.UT, n.deltaVMagnitude);
    }
    setCompletedNodes((current) => {
      let next = current;
      for (const n of nodes) {
        if (current.has(n.UT)) continue;
        const observedMax = max.get(n.UT) ?? 0;
        if (
          observedMax > COMPLETED_THRESHOLD_DV &&
          n.deltaVMagnitude < COMPLETED_THRESHOLD_DV
        ) {
          if (next === current) next = new Map(current);
          next.set(n.UT, { snapshot: n, completedAt: Date.now() });
        }
      }
      return next;
    });
  }, [nodes]);

  useEffect(() => {
    if (completedNodes.size === 0) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const [ut, entry] of completedNodes) {
      const remaining = Math.max(
        0,
        COMPLETED_HOLD_MS - (Date.now() - entry.completedAt),
      );
      timers.push(
        setTimeout(() => {
          const live = nodesRef.current.find((n) => n.UT === ut);
          if (live) {
            void execute(`o.removeManeuverNode[${live.id}]`).catch(() => {
              // Swallow — if KSP can't find the node it's already gone.
            });
          }
          setCompletedNodes((current) => {
            if (!current.has(ut)) return current;
            const next = new Map(current);
            next.delete(ut);
            return next;
          });
          maxDvByUt.current.delete(ut);
        }, remaining),
      );
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [completedNodes, execute]);

  // Armed conditional triggers. State lives here but the live-data ref + fire
  // callback are wired further down, after `currentOrbit` / `mu` / `body` are
  // derived. The state itself has no orbit-data dependency so it lives above.
  const [armedTriggers, setArmedTriggers] = useState<ArmedTrigger[]>([]);
  // Editor visibility + draft fields for the inline trigger picker.
  const [triggerEditorOpen, setTriggerEditorOpen] = useState(false);
  const [triggerKey, setTriggerKey] = useState<string | null>(null);
  const [triggerOp, setTriggerOp] = useState<ThresholdOp>(">=");
  const [triggerValueDraft, setTriggerValueDraft] = useState("80000");

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

  // Live nodes + phantom entries for completed nodes that have already
  // disappeared from `o.maneuverNodes` (e.g. user manually deleted before the
  // 10 s hold elapsed). The phantom is rendered inert — no Delete button
  // wiring beyond letting the timer drop it on schedule.
  const displayedNodes = useMemo<
    Array<{ node: ParsedManeuverNode; completed: boolean; phantom: boolean }>
  >(() => {
    const liveUts = new Set<number>();
    const live = nodes.map((n) => {
      liveUts.add(n.UT);
      return {
        node: n,
        completed: completedNodes.has(n.UT),
        phantom: false,
      };
    });
    const phantoms: Array<{
      node: ParsedManeuverNode;
      completed: boolean;
      phantom: boolean;
    }> = [];
    for (const [ut, entry] of completedNodes) {
      if (!liveUts.has(ut))
        phantoms.push({ node: entry.snapshot, completed: true, phantom: true });
    }
    return [...live, ...phantoms];
  }, [nodes, completedNodes]);

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

  const requiredDeltaV = plan
    ? isSequence(plan)
      ? plan.totalDeltaV
      : plan.requiredDeltaV
    : 0;
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

  // Fire-time live snapshot. The watcher's effect closes over an older
  // `handleFire`, so we read the freshest live values via a ref instead of
  // the closure to avoid firing against stale orbit data.
  const liveRef = useRef({
    currentOrbit,
    currentUT,
    mu,
    trueAnomaly,
    argPe,
    inclination,
    lan,
    targetInclinationLive,
    targetLanLive,
    targetSma,
    targetPeA,
    targetArgPe,
    targetTrueAnomaly,
    targetPeriod,
    bodyRadius: body?.radius,
  });
  useEffect(() => {
    liveRef.current = {
      currentOrbit,
      currentUT,
      mu,
      trueAnomaly,
      argPe,
      inclination,
      lan,
      targetInclinationLive,
      targetLanLive,
      targetSma,
      targetPeA,
      targetArgPe,
      targetTrueAnomaly,
      targetPeriod,
      bodyRadius: body?.radius,
    };
  });

  const dispatchPlanBurns = useCallback(
    async (toDispatch: PlanResult): Promise<void> => {
      const burns = isSequence(toDispatch) ? toDispatch.burns : [toDispatch];
      for (const b of burns) {
        const action = `o.addManeuverNode[${b.ut.toFixed(3)},${b.radial.toFixed(3)},${b.normal.toFixed(3)},${b.prograde.toFixed(3)}]`;
        await execute(action);
      }
    },
    [execute],
  );

  const handleFireTrigger = useCallback(
    (trigger: ArmedTrigger) => {
      const live = liveRef.current;
      const planInputs: PlanInputs = { ...trigger.inputs, ...live };
      const firedPlan = computePlan(planInputs);
      setArmedTriggers((prev) => prev.filter((t) => t.id !== trigger.id));
      if (!firedPlan) {
        setError(
          "Trigger fired but plan could not be computed — telemetry incomplete. Re-arm with current orbit.",
        );
        return;
      }
      dispatchPlanBurns(firedPlan).catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
    },
    [dispatchPlanBurns],
  );

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

  function handleArmTrigger() {
    if (!triggerKey || principia) return;
    const valueN = Number.parseFloat(triggerValueDraft);
    if (!Number.isFinite(valueN)) return;
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
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `arm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setArmedTriggers((prev) => [
      ...prev,
      { id, dataKey: triggerKey, op: triggerOp, value: valueN, inputs },
    ]);
    setTriggerEditorOpen(false);
    setError(null);
  }

  function handleCancelTrigger(id: string) {
    setArmedTriggers((prev) => prev.filter((t) => t.id !== id));
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
        {displayedNodes.length === 0 ? (
          <Empty>No maneuver nodes planned.</Empty>
        ) : (
          <NodeList>
            {displayedNodes.map((d) => (
              <NodeRow
                key={d.phantom ? `phantom-${d.node.UT}` : d.node.id}
                node={d.node}
                currentUT={currentUT}
                availableDv={vesselDeltaV.totalVac}
                completed={d.completed}
                onDelete={
                  d.phantom ? undefined : () => void handleDelete(d.node.id)
                }
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
    if (preset === "hohmann-to-altitude") {
      return (
        <CustomInputs>
          <LabeledInput
            label="Target alt"
            value={targetAltitudeKm}
            onChange={setTargetAltitudeKm}
            suffix="km"
          />
        </CustomInputs>
      );
    }
    if (preset === "hohmann-rendezvous-target") {
      return (
        <CustomInputs>
          <LabeledInput
            label="Standoff"
            value={standoffMeters}
            onChange={setStandoffMeters}
            suffix="m"
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
    if (preset === "hohmann-rendezvous-target") {
      if (!targetName) {
        return <PresetDesc>No target selected in-game.</PresetDesc>;
      }
      const planeMismatch = computeRelInc(
        inclination,
        lan,
        targetInclinationLive,
        targetLanLive,
      );
      return (
        <PresetDesc>
          Target: {targetName} — PeA{" "}
          {targetPeA !== undefined
            ? `${(targetPeA / 1000).toFixed(1)} km`
            : "—"}
          , i={(targetInclinationLive ?? 0).toFixed(1)}°, Δplane=
          {planeMismatch !== null ? `${planeMismatch.toFixed(1)}°` : "—"}
          {planeMismatch !== null && planeMismatch > 0.5
            ? " (plane match prepended)"
            : ""}
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
    if (isSequence(plan)) return renderSequencePreview(plan);
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

        {renderProjectedRows(plan.projected)}
      </PreviewGrid>
    );
  }

  function renderSequencePreview(seq: ManeuverSequence) {
    const burn1 = seq.burns[0];
    const burn2 = seq.burns[1];
    return (
      <>
        <PreviewGrid>
          <Label>Total ΔV</Label>
          <Value>{seq.totalDeltaV.toFixed(1)} m/s</Value>

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
        </PreviewGrid>

        <SectionTitle>Burn 1</SectionTitle>
        <PreviewGrid>
          <Label>ΔV</Label>
          <Value>{burn1.prograde.toFixed(1)} m/s prograde</Value>
          <Label>Burn in</Label>
          <Value>{formatDuration(burn1.ut - (currentUT ?? 0))}</Value>
          {renderProjectedRows(seq.transferEllipse, "Transfer")}
        </PreviewGrid>

        {burn2 && (
          <>
            <SectionTitle>Burn 2</SectionTitle>
            <PreviewGrid>
              <Label>ΔV</Label>
              <Value>{burn2.prograde.toFixed(1)} m/s prograde</Value>
              <Label>Burn in</Label>
              <Value>{formatDuration(burn2.ut - (currentUT ?? 0))}</Value>
              {renderProjectedRows(seq.finalProjected, "Final")}
            </PreviewGrid>
          </>
        )}
      </>
    );
  }

  function renderProjectedRows(
    projected: ManeuverPlan["projected"] | null | undefined,
    prefix = "New",
  ) {
    if (!projected) {
      return (
        <>
          <Label>Projection</Label>
          <Value>escape / invalid</Value>
        </>
      );
    }
    return (
      <>
        <Label>{prefix} Ap</Label>
        <Value $accent="ap">
          {formatDistance(projected.ApR - (body?.radius ?? 0))}
        </Value>
        <Label>{prefix} Pe</Label>
        <Value $accent="pe">
          {formatDistance(projected.PeR - (body?.radius ?? 0))}
        </Value>
        <Label>{prefix} Ecc</Label>
        <Value>{projected.eccentricity.toFixed(4)}</Value>
        <Label>{prefix} T</Label>
        <Value>{formatDuration(projected.period)}</Value>
        {projected.inclination !== undefined && (
          <>
            <Label>{prefix} Inc</Label>
            <Value>{projected.inclination.toFixed(2)}°</Value>
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
    // For sequences, draw the transfer ellipse dashed (`projected`) and
    // the final orbit solid (`secondaryProjected`). For single-burn
    // plans, just the post-burn ellipse goes in `projected`.
    const projected = isSequence(plan) ? plan.transferEllipse : plan.projected;
    const secondaryProjected = isSequence(plan) ? plan.finalProjected : null;
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
            projected
              ? {
                  sma: projected.sma,
                  ecc: projected.eccentricity,
                  apoapsis: projected.ApR,
                  periapsis: projected.PeR,
                }
              : null
          }
          secondaryProjected={
            secondaryProjected
              ? {
                  sma: secondaryProjected.sma,
                  ecc: secondaryProjected.eccentricity,
                  apoapsis: secondaryProjected.ApR,
                  periapsis: secondaryProjected.PeR,
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
          Required {requiredDeltaV.toFixed(0)} m/s · available{" "}
          {vesselDeltaV.totalVac.toFixed(0)} m/s ·{" "}
          {(requiredDeltaV - vesselDeltaV.totalVac).toFixed(0)} m/s short.
        </FeasibilityBannerBody>
      </FeasibilityBanner>
    );
  }

  function renderTriggerEditor() {
    if (!triggerEditorOpen) return null;
    const valueN = Number.parseFloat(triggerValueDraft);
    const armDisabled =
      !triggerKey || !Number.isFinite(valueN) || principia || !plan;
    return (
      <TriggerEditor>
        <TriggerEditorTitle>When this condition holds</TriggerEditorTitle>
        <TriggerField>
          <TriggerFieldLabel>Telemetry key</TriggerFieldLabel>
          <DataKeyPicker
            keys={numericKeys}
            value={triggerKey}
            onChange={setTriggerKey}
            placeholder="Search telemetry…"
            clearable
          />
        </TriggerField>
        <TriggerOpRow>
          <TriggerField>
            <TriggerFieldLabel htmlFor="mnv-trigger-op">
              Operator
            </TriggerFieldLabel>
            <OpSelect
              id="mnv-trigger-op"
              value={triggerOp}
              onChange={(e) => setTriggerOp(e.target.value as ThresholdOp)}
            >
              {THRESHOLD_OPS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </OpSelect>
          </TriggerField>
          <TriggerField>
            <TriggerFieldLabel htmlFor="mnv-trigger-value">
              Value
            </TriggerFieldLabel>
            <ValueInput
              id="mnv-trigger-value"
              type="number"
              step="any"
              value={triggerValueDraft}
              onChange={(e) => setTriggerValueDraft(e.target.value)}
            />
          </TriggerField>
        </TriggerOpRow>
        <TriggerActions>
          <GhostLink type="button" onClick={() => setTriggerEditorOpen(false)}>
            Cancel
          </GhostLink>
          <Button onClick={handleArmTrigger} disabled={armDisabled}>
            Arm
          </Button>
        </TriggerActions>
      </TriggerEditor>
    );
  }

  function renderArmedTriggersSection() {
    if (armedTriggers.length === 0) return null;
    return (
      <Section>
        <SectionTitle>Armed triggers</SectionTitle>
        <NodeList>
          {armedTriggers.map((t) => {
            const presetLabel =
              PRESETS.find((p) => p.id === t.inputs.preset)?.label ??
              t.inputs.preset;
            return (
              <ArmedRow key={t.id} role="status">
                <ArmedMain>
                  <ArmedPrimary>
                    {t.dataKey} {t.op} {t.value}
                  </ArmedPrimary>
                  <ArmedMeta>→ {presetLabel}</ArmedMeta>
                </ArmedMain>
                <CancelTriggerButton
                  type="button"
                  onClick={() => handleCancelTrigger(t.id)}
                  aria-label="Cancel armed trigger"
                >
                  ✕
                </CancelTriggerButton>
              </ArmedRow>
            );
          })}
        </NodeList>
      </Section>
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
          <GhostLink
            type="button"
            onClick={() => setTriggerEditorOpen((o) => !o)}
            disabled={committing || principia || !plan}
          >
            Add Node When…
          </GhostLink>
          <Button
            onClick={() => void handleCommit()}
            disabled={committing || principia || feasible === false}
          >
            {committing ? "Adding…" : "Add node"}
          </Button>
        </CommitRow>
        {renderTriggerEditor()}
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
        {renderArmedTriggersSection()}
        {renderNewManeuverSection()}
        {waiting ? renderWaitingPanel() : renderPreview()}
      </ScrollBody>
      {armedTriggers.map((t) => (
        <ArmedTriggerWatcher
          key={t.id}
          trigger={t}
          onFire={handleFireTrigger}
        />
      ))}
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
    "tar.o.sma",
    "tar.o.PeA",
    "tar.o.argumentOfPeriapsis",
    "tar.o.trueAnomaly",
    "tar.o.period",
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

const Empty = styled.div`
  color: var(--color-text-faint);
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
  text-align: center;
  color: ${({ $ok }) => ($ok ? "var(--color-accent-fg)" : "var(--color-text-muted)")};
  font-size: 11px;
`;

const StatusLabel = styled.span`
  font-size: 11px;
  color: var(--color-text-muted);
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
  color: var(--color-text-dim);
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline;
  &:hover {
    color: var(--color-text-primary);
  }
`;

const PresetDesc = styled.div`
  font-size: 11px;
  color: var(--color-text-dim);
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
  background: ${({ $active }) => ($active ? "var(--color-status-go-bg)" : "var(--color-surface-raised)")};
  border: 1px solid ${({ $active }) => ($active ? "var(--color-status-go-bg)" : "var(--color-border-subtle)")};
  color: ${({ $active }) => ($active ? "var(--color-status-go-fg)" : "var(--color-text-muted)")};
  font-size: var(--font-size-xs);
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

const PreviewGrid = styled.dl`
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 2px 8px;
  align-items: baseline;
  margin: 0;
`;

const Label = styled.dt`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const accentColor = {
  ap: "var(--color-status-warning-bg)",
  pe: "var(--color-tag-blue-fg)",
};

const Value = styled.dd<{ $accent?: "ap" | "pe" }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: ${({ $accent }) => ($accent ? accentColor[$accent] : "var(--color-text-primary)")};
  letter-spacing: 0.03em;
  margin: 0;
`;

const DiagramWrap = styled.div`
  height: 180px;
  flex-shrink: 0;
  display: flex;
`;

const Note = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-dim);
  font-style: italic;
`;

const ErrorLine = styled.div`
  font-size: 11px;
  color: var(--color-status-nogo-fg);
  background: var(--color-tag-dark-brown-bg);
  border: 1px solid var(--color-border-strong);
  padding: 4px 6px;
  border-radius: 2px;
`;

const CommitRow = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding-top: 4px;
`;

const TriggerEditor = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 8px;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: 2px;
`;

const TriggerEditorTitle = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

const TriggerField = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
`;

const TriggerFieldLabel = styled.label`
  font-size: 11px;
  color: var(--color-text-faint);
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

const TriggerOpRow = styled.div`
  display: flex;
  gap: 6px;
`;

const OpSelect = styled.select`
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-subtle);
  border-radius: 2px;
  padding: 3px 4px;
  font-size: 13px;
`;

const ValueInput = styled.input`
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-subtle);
  border-radius: 2px;
  padding: 3px 6px;
  font-size: 13px;
  font-family: inherit;
  width: 100%;
  min-width: 0;
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const TriggerActions = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding-top: 2px;
`;

const ArmedRow = styled.li`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 6px;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-status-warning-bg);
  border-radius: 2px;
`;

const ArmedMain = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
`;

const ArmedPrimary = styled.div`
  font-size: 13px;
  color: var(--color-status-warning-bg);
  font-weight: 600;
  letter-spacing: 0.02em;
`;

const ArmedMeta = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-dim);
  letter-spacing: 0.04em;
`;

const CancelTriggerButton = styled.button`
  background: transparent;
  border: 1px solid var(--color-status-alert-muted);
  color: var(--color-text-muted);
  font-size: 11px;
  width: 22px;
  height: 22px;
  border-radius: 2px;
  cursor: pointer;
  &:hover {
    background: var(--color-tag-dark-brown-bg);
    color: var(--color-tag-red-fg);
  }
`;
