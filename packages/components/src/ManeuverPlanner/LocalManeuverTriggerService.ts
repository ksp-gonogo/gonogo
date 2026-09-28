import { safeRandomUuid } from "@ksp-gonogo/core";
import {
  bodyRadiusOf,
  getOrbitSolve,
  getSystemBodies,
  getValue,
  getVesselIdentity,
  getVesselOrbit,
  getVesselTarget,
  getViewUt,
  onActiveTimelineFrame,
  solveOrbit,
} from "@ksp-gonogo/sitrep-client";
import { buildCurrentOrbit } from "./planning";
import { fireTriggerPlan } from "./triggerDispatch";
import type {
  ArmTriggerInput,
  ManeuverTriggerService,
  TriggerSnapshot,
} from "./triggerService";
import type { ArmedTrigger, TriggerFailure } from "./triggerTypes";
import { compareThreshold } from "./triggerTypes";

/**
 * In-process trigger service, used when the widget renders without a
 * `<ManeuverTriggerProvider>`. It reads the active `TimelineStore` through the
 * non-hook sitrep-client accessors and re-evaluates on every frame; an armed
 * `dataKey` is one of the Value keys `getValue` can read. No persistence and no
 * peer broadcast: the app's host and client services are the cross-station
 * version.
 */
export class LocalManeuverTriggerService implements ManeuverTriggerService {
  private triggers: ArmedTrigger[] = [];
  private listeners = new Set<(snap: TriggerSnapshot) => void>();
  private fired = new Set<string>();
  private vesselUnsub: (() => void) | null = null;
  private readonly nowMs: () => number;

  constructor(opts: { nowMs?: () => number } = {}) {
    this.nowMs = opts.nowMs ?? (() => Date.now());
    // The frame subscription starts on the first arm: with no triggers there is nothing to evaluate.
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

  /** Drops fired ids that no longer name a listed trigger; ids are never reused, so those guard nothing. */
  private pruneFired(): void {
    if (this.fired.size === 0) return;
    const listed = new Set(this.triggers.map((t) => t.id));
    for (const id of this.fired) {
      if (!listed.has(id)) this.fired.delete(id);
    }
  }

  private evaluate(): void {
    if (this.triggers.length === 0) {
      this.fired.clear();
      return;
    }
    // Auto-clear triggers tied to a different vessel. A null live name is "no identity read yet", not a different vessel, so it clears nothing.
    const liveVesselName = this.readVesselName();
    let mutated = false;
    for (const t of [...this.triggers]) {
      if (
        t.vesselName !== null &&
        liveVesselName !== null &&
        liveVesselName !== t.vesselName
      ) {
        this.triggers = this.triggers.filter((x) => x.id !== t.id);
        mutated = true;
        continue;
      }
      if (this.fired.has(t.id) || t.failure) continue;
      const value = getValue(t.dataKey);
      if (value === undefined) continue;
      if (!compareThreshold(value, t.op, t.value)) continue;
      this.fired.add(t.id);
      // Off the list before firing, since a plan that cannot be computed lists it again at once.
      this.triggers = this.triggers.filter((x) => x.id !== t.id);
      this.fire(t);
      mutated = true;
    }
    this.pruneFired();
    if (mutated) this.emit();
  }

  private fire(trigger: ArmedTrigger): void {
    const live = this.readLiveOrbit();
    fireTriggerPlan(trigger.id, { ...trigger.inputs, ...live }, (failure) =>
      this.recordFailure(trigger, failure),
    );
  }

  /** Lists a fired trigger again, carrying what went wrong, so it stays in front of the operator until it is dismissed. */
  private recordFailure(trigger: ArmedTrigger, failure: TriggerFailure): void {
    this.triggers.push({ ...trigger, failure });
    this.emit();
  }

  private readLiveOrbit() {
    const orbit = getVesselOrbit();
    const target = getVesselTarget();
    const targetOrbit = target?.orbit;
    // The target's altitude needs the target's own reference body, not the craft's.
    const currentUT = getViewUt();
    const targetSolved =
      targetOrbit == null || currentUT === undefined
        ? undefined
        : solveOrbit(
            targetOrbit,
            currentUT,
            bodyRadiusOf(getSystemBodies(), targetOrbit.referenceBodyIndex),
          );
    // The model's refusal says whether these figures exist at all, which a payload read cannot.
    const solve = getOrbitSolve();
    return {
      currentOrbit: buildCurrentOrbit({
        sma: orbit?.sma?.magnitude,
        ecc: orbit?.ecc?.magnitude,
        ApR: solve?.apoapsisRadius ?? undefined,
        PeR: solve?.periapsisRadius ?? undefined,
        timeToAp: solve?.timeToAp ?? undefined,
        timeToPe: solve?.timeToPe ?? undefined,
      }),
      currentUT,
      // The parent body's GM as the orbit carries it; 0 is the planner's own "no mu" and plans nothing.
      mu: orbit?.mu?.magnitude ?? 0,
      trueAnomaly: solve?.trueAnomaly ?? undefined,
      argPe: orbit?.argPe?.magnitude,
      inclination: orbit?.inc?.magnitude,
      lan: orbit?.lan?.magnitude,
      targetInclinationLive: targetOrbit?.inc?.magnitude,
      targetLanLive: targetOrbit?.lan?.magnitude,
      targetSma: targetOrbit?.sma?.magnitude,
      targetPeA: targetSolved?.periapsisAlt ?? undefined,
      targetArgPe: targetOrbit?.argPe?.magnitude,
      targetTrueAnomaly: targetSolved?.trueAnomaly ?? undefined,
      targetPeriod: targetSolved?.period ?? undefined,
      bodyRadius: this.readBodyRadius(),
    };
  }

  /** By body index off the wire, never by name: the craft's parent body first, then the orbit's reference body, as the host twin reads them. */
  private readBodyRadius(): number | undefined {
    const bodies = getSystemBodies();
    return (
      bodyRadiusOf(bodies, getVesselIdentity()?.parentBodyIndex) ??
      bodyRadiusOf(bodies, getVesselOrbit()?.referenceBodyIndex) ??
      undefined
    );
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
