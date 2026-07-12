import { getBody, safeRandomUuid } from "@ksp-gonogo/core";
import {
  dispatchActiveCommand,
  getValue,
  getVesselIdentity,
  getVesselOrbit,
  getVesselState,
  getVesselTarget,
  getViewUt,
  onActiveTimelineFrame,
} from "@ksp-gonogo/sitrep-client";
import {
  buildCurrentOrbit,
  computeMu,
  computePlan,
  isSequence,
} from "./planning";
import type {
  ArmTriggerInput,
  ManeuverTriggerService,
  TriggerSnapshot,
} from "./triggerService";
import type { ArmedTrigger } from "./triggerTypes";
import { compareThreshold } from "./triggerTypes";

/**
 * In-process trigger service. Used when the widget is rendered without a
 * `<ManeuverTriggerProvider>` (legacy tests, standalone embeds). Every
 * fixed-field read (vessel/target orbit elements, apo/peri/time-to-apsis,
 * true anomaly, vessel name/body) rides the non-hook `getVesselOrbit()`/
 * `getVesselTarget()`/`getVesselIdentity()`/`getVesselState()`/`getViewUt()`
 * accessors (`@ksp-gonogo/sitrep-client`) — the same `TimelineStore` a
 * mounted widget's `useTelemetry` would read, sampled on demand and
 * re-evaluated on `onActiveTimelineFrame` instead of a per-key subscription.
 *
 * The ARMED TRIGGER's own `dataKey` is an operator-picked key too, but no
 * longer an ARBITRARY one: the widget's `DataKeyPicker` only offers keys
 * `@ksp-gonogo/data`'s `useValueKeys` resolves — the Value-restricted,
 * stream-mapped set (per the Uplink Domain/Topic/Value/Stream/Asset vocab).
 * That bounds `dataKey` to what `getValue` (the generic non-hook Value
 * accessor, `@ksp-gonogo/sitrep-client`) can actually read, so the threshold
 * read and the maneuver-node fire (`dispatchActiveCommand`) both ride the
 * stream now — no `getDataSource(this.sourceId)` dependency left.
 *
 * No persistence, no peer broadcast — see the host/client services in
 * @ksp-gonogo/app for the cross-station-aware version.
 */
export class LocalManeuverTriggerService implements ManeuverTriggerService {
  private triggers: ArmedTrigger[] = [];
  private listeners = new Set<(snap: TriggerSnapshot) => void>();
  private fired = new Set<string>();
  private vesselUnsub: (() => void) | null = null;
  private readonly nowMs: () => number;
  private readonly sourceId: string;

  constructor(opts: { sourceId?: string; nowMs?: () => number } = {}) {
    this.sourceId = opts.sourceId ?? "data";
    this.nowMs = opts.nowMs ?? (() => Date.now());
    // Deliberately NOT subscribing here: `onActiveTimelineFrame` reads
    // whichever `TelemetryProvider` is ALREADY mounted at call time and
    // never retroactively attaches (see its own doc comment) — but this
    // service is built via `useState(() => new LocalManeuverTriggerService())`,
    // whose lazy initializer runs during the FIRST render, before ANY
    // `useEffect` (including the enclosing `TelemetryProvider`'s own
    // store-registration effect) has fired. Subscribing here would silently
    // no-op for the service's entire lifetime. `arm()` establishes the
    // subscription instead — arming always happens well after mount
    // (a later user action or peer message), by which point the provider
    // (if any) has settled.
  }

  dispose(): void {
    this.vesselUnsub?.();
    this.vesselUnsub = null;
    this.listeners.clear();
  }

  snapshot(): TriggerSnapshot {
    return {
      triggers: [...this.triggers],
      vesselName: this.readVesselName(),
    };
  }

  subscribe(cb: (snap: TriggerSnapshot) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  arm(input: ArmTriggerInput): void {
    // Lazily established (not in the constructor — see its doc comment):
    // re-evaluates every armed trigger's dataKey threshold, plus the
    // vessel-swap auto-clear check, on every subsequent stream frame.
    this.vesselUnsub ??= onActiveTimelineFrame(() => this.evaluate());
    const id = generateId();
    const trigger: ArmedTrigger = {
      id,
      dataKey: input.dataKey,
      op: input.op,
      value: input.value,
      inputs: input.inputs,
      vesselName: this.readVesselName(),
      createdAt: this.nowMs(),
      createdBy: "main",
    };
    this.triggers.push(trigger);
    this.emit();
    // Evaluate immediately so an already-true condition fires synchronously.
    this.evaluate();
  }

  cancel(id: string): void {
    const before = this.triggers.length;
    this.triggers = this.triggers.filter((t) => t.id !== id);
    this.fired.delete(id);
    if (this.triggers.length !== before) this.emit();
  }

  private evaluate(): void {
    if (this.triggers.length === 0) return;
    // Auto-clear triggers tied to a different vessel.
    const liveVesselName = this.readVesselName();
    let mutated = false;
    for (const t of [...this.triggers]) {
      if (t.vesselName !== null && liveVesselName !== t.vesselName) {
        this.triggers = this.triggers.filter((x) => x.id !== t.id);
        mutated = true;
        continue;
      }
      if (this.fired.has(t.id)) continue;
      const value = getValue(this.sourceId, t.dataKey);
      if (value === undefined) continue;
      if (!compareThreshold(value, t.op, t.value)) continue;
      this.fired.add(t.id);
      this.fire(t);
      this.triggers = this.triggers.filter((x) => x.id !== t.id);
      mutated = true;
    }
    if (mutated) this.emit();
  }

  private fire(trigger: ArmedTrigger): void {
    const live = this.readLiveOrbit();
    const planInputs = { ...trigger.inputs, ...live };
    const plan = computePlan(planInputs);
    if (!plan) return;
    const burns = isSequence(plan) ? plan.burns : [plan];
    for (const b of burns) {
      const action = `o.addManeuverNode[${b.ut.toFixed(3)},${b.radial.toFixed(3)},${b.normal.toFixed(3)},${b.prograde.toFixed(3)}]`;
      const outcome = dispatchActiveCommand(this.sourceId, action);
      if (outcome.routed) void outcome.settled;
    }
  }

  private readLiveOrbit() {
    const orbit = getVesselOrbit();
    const state = getVesselState();
    const target = getVesselTarget();
    const targetOrbit = target?.orbit;
    const sma = orbit?.sma;
    const orbitalSpeed = state?.orbitalSpeed ?? undefined;
    const radius = state?.orbitalRadius ?? undefined;
    const period = state?.period ?? undefined;
    return {
      currentOrbit: buildCurrentOrbit({
        sma,
        ecc: orbit?.ecc,
        ApR: state?.apoapsisRadius ?? undefined,
        PeR: state?.periapsisRadius ?? undefined,
        timeToAp: state?.timeToAp ?? undefined,
        timeToPe: state?.timeToPe ?? undefined,
      }),
      // Not a data-source key: `t.universalTime` was DROPPED — this is the
      // SDK's own view time (`getViewUt`, the non-hook `useViewUt`
      // equivalent plain classes need), never a legacy `"data"` read.
      currentUT: getViewUt(),
      mu: computeMu(orbitalSpeed, radius, sma, period),
      trueAnomaly: state?.trueAnomaly ?? undefined,
      argPe: orbit?.argPe,
      inclination: orbit?.inc,
      lan: orbit?.lan,
      targetInclinationLive: targetOrbit?.inc,
      targetLanLive: targetOrbit?.lan,
      targetSma: targetOrbit?.sma,
      targetPeA: state?.targetPeriapsisAlt ?? undefined,
      targetArgPe: targetOrbit?.argPe,
      targetTrueAnomaly: state?.targetTrueAnomaly ?? undefined,
      targetPeriod: state?.targetPeriod ?? undefined,
      bodyRadius: this.readBodyRadius(state),
    };
  }

  private readBodyRadius(
    state: ReturnType<typeof getVesselState>,
  ): number | undefined {
    const name = state?.parentBodyName ?? state?.referenceBodyName ?? "";
    return getBody(name)?.radius;
  }

  private readVesselName(): string | null {
    return getVesselIdentity()?.name ?? null;
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const cb of this.listeners) cb(snap);
  }
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return safeRandomUuid();
  }
  return `trigger_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
