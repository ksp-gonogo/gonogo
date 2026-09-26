import { safeRandomUuid } from "@ksp-gonogo/core";
import {
  bodyRadiusOf,
  dispatchActiveCommandTopic,
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
import { buildCurrentOrbit, computePlan, isSequence } from "./planning";
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
 * `getVesselTarget()`/`getVesselIdentity()`/`getViewUt()` accessors
 * (`@ksp-gonogo/sitrep-client`): the same `TimelineStore` a mounted widget's
 * `useTelemetry` would read, sampled on demand and re-evaluated on
 * `onActiveTimelineFrame` instead of a per-key subscription.
 *
 * The ARMED TRIGGER's own `dataKey` is an operator-picked key too, but no
 * longer an ARBITRARY one: the widget's `DataKeyPicker` only offers keys
 * `@ksp-gonogo/data`'s `useValueKeys` resolves: the Value-restricted,
 * stream-mapped set (per the Uplink Domain/Topic/Value/Stream/Asset vocab).
 * That bounds `dataKey` to what `getValue` (the generic non-hook Value
 * accessor, `@ksp-gonogo/sitrep-client`) can actually read, so the threshold
 * read and the maneuver-node fire (`dispatchActiveCommand`) both ride the
 * stream now: no `getDataSource(this.sourceId)` dependency left.
 *
 * No persistence, no peer broadcast: see the host/client services in
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
    // No frame subscription here: a service holding no triggers has nothing
    // to re-evaluate, so `arm()` takes it out on the first one.
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
    // Re-evaluates every armed trigger's dataKey threshold, plus the
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

  /**
   * Drops every `fired` id that no longer names a listed trigger.
   *
   * The guard only has to stop a second fire while its trigger is still
   * listed, which is only the case when a dispatch left it there. Ids are
   * minted per arm and never reused, so anything else in the set is dead
   * weight held for as long as the widget is mounted.
   */
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
      if (this.fired.has(t.id)) continue;
      const value = getValue(this.sourceId, t.dataKey);
      if (value === undefined) continue;
      if (!compareThreshold(value, t.op, t.value)) continue;
      this.fired.add(t.id);
      this.fire(t);
      this.triggers = this.triggers.filter((x) => x.id !== t.id);
      mutated = true;
    }
    this.pruneFired();
    if (mutated) this.emit();
  }

  private fire(trigger: ArmedTrigger): void {
    const live = this.readLiveOrbit();
    const planInputs = { ...trigger.inputs, ...live };
    const plan = computePlan(planInputs);
    if (!plan) return;
    const burns = isSequence(plan) ? plan.burns : [plan];
    for (const b of burns) {
      // Named directly, with the burn's own numbers as arguments, so the full
      // precision reaches the command rather than being rounded into a key
      // string for something downstream to parse back out.
      const outcome = dispatchActiveCommandTopic("vessel.maneuver.add", {
        ut: b.ut,
        prograde: b.prograde,
        normal: b.normal,
        radialOut: b.radial,
      });
      if (outcome.routed) void outcome.settled;
    }
  }

  private readLiveOrbit() {
    const orbit = getVesselOrbit();
    const target = getVesselTarget();
    const targetOrbit = target?.orbit;
    /*
     * The target's own orbit, solved here: the same `solveOrbit` the craft's
     * orbit goes through, on the target's elements at the same view time. The altitude
     * needs the TARGET's reference body, not the craft's, which is why the
     * radius is resolved from its own `referenceBodyIndex`.
     */
    const currentUT = getViewUt();
    const targetSolved =
      targetOrbit == null || currentUT === undefined
        ? undefined
        : solveOrbit(
            targetOrbit,
            currentUT,
            bodyRadiusOf(getSystemBodies(), targetOrbit.referenceBodyIndex),
          );
    /*
     * The craft's own orbit through the same `solveOrbit` the target's goes
     * through, reached here by the non-hook `getOrbitSolve` because the model's
     * refusal is what says whether these figures exist at all, and a payload
     * read carries no model. `null` from it leaves every figure below
     * `undefined`, which `buildCurrentOrbit` already treats as nothing to plan
     * against.
     */
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
      // Not a data-source key: `t.universalTime` was DROPPED, this is the
      // SDK's own view time (`getViewUt`, the non-hook `useViewUt`
      // equivalent plain classes need), never a legacy `"data"` read.
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

  /**
   * Off the wire, by index, never by name against the bundled stock bodies:
   * under a planet pack the names do not match, the lookup misses, and a
   * transfer that needs a radius quietly plans nothing. The craft's parent
   * body answers first and the orbit's reference body behind it, which is the
   * same order the host-side twin (`ManeuverTriggerHostService`) reads them.
   */
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
