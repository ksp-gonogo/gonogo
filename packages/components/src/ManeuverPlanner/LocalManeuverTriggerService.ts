import { getBody, getDataSource } from "@gonogo/core";
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
 * `<ManeuverTriggerProvider>` (legacy tests, standalone embeds). Reads
 * data via `getDataSource("data")`; fires by calling `source.execute(...)`
 * directly. No persistence, no peer broadcast — see the host/client
 * services in @gonogo/app for the cross-station-aware version.
 */
export class LocalManeuverTriggerService implements ManeuverTriggerService {
  private triggers: ArmedTrigger[] = [];
  private listeners = new Set<(snap: TriggerSnapshot) => void>();
  private fired = new Set<string>();
  /** Per-trigger data-source unsubscribe handles — clears on cancel/fire. */
  private unsubByTrigger = new Map<string, () => void>();
  private vesselUnsub: (() => void) | null = null;
  private readonly nowMs: () => number;
  private readonly sourceId: string;

  constructor(opts: { sourceId?: string; nowMs?: () => number } = {}) {
    this.sourceId = opts.sourceId ?? "data";
    this.nowMs = opts.nowMs ?? (() => Date.now());
    const source = getDataSource(this.sourceId);
    if (source) {
      this.vesselUnsub = source.subscribe("v.name", () => this.evaluate());
    }
  }

  dispose(): void {
    for (const u of this.unsubByTrigger.values()) u();
    this.unsubByTrigger.clear();
    this.vesselUnsub?.();
    this.vesselUnsub = null;
    this.listeners.clear();
  }

  snapshot(): TriggerSnapshot {
    const vesselName = this.readValue("v.name");
    return {
      triggers: [...this.triggers],
      vesselName: typeof vesselName === "string" ? vesselName : null,
    };
  }

  subscribe(cb: (snap: TriggerSnapshot) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  arm(input: ArmTriggerInput): void {
    const id = generateId();
    const vesselName = this.readValue("v.name");
    const trigger: ArmedTrigger = {
      id,
      dataKey: input.dataKey,
      op: input.op,
      value: input.value,
      inputs: input.inputs,
      vesselName: typeof vesselName === "string" ? vesselName : null,
      createdAt: this.nowMs(),
      createdBy: "main",
    };
    this.triggers.push(trigger);
    // Subscribe so the trigger re-evaluates on every value emit, not just
    // on the next polling tick. Already-true conditions fire on the first
    // emit (or the synchronous evaluate() below, whichever comes first).
    const source = getDataSource(this.sourceId);
    if (source) {
      const unsub = source.subscribe(trigger.dataKey, () => this.evaluate());
      this.unsubByTrigger.set(id, unsub);
    }
    this.emit();
    // Evaluate immediately so an already-true condition fires synchronously.
    this.evaluate();
  }

  cancel(id: string): void {
    const before = this.triggers.length;
    this.triggers = this.triggers.filter((t) => t.id !== id);
    this.fired.delete(id);
    const unsub = this.unsubByTrigger.get(id);
    if (unsub) {
      unsub();
      this.unsubByTrigger.delete(id);
    }
    if (this.triggers.length !== before) this.emit();
  }

  private evaluate(): void {
    if (this.triggers.length === 0) return;
    // Auto-clear triggers tied to a different vessel.
    const liveVessel = this.readValue("v.name");
    const liveVesselName = typeof liveVessel === "string" ? liveVessel : null;
    let mutated = false;
    for (const t of [...this.triggers]) {
      if (t.vesselName !== null && liveVesselName !== t.vesselName) {
        this.triggers = this.triggers.filter((x) => x.id !== t.id);
        this.unsubByTrigger.get(t.id)?.();
        this.unsubByTrigger.delete(t.id);
        mutated = true;
        continue;
      }
      if (this.fired.has(t.id)) continue;
      const value = this.readValue(t.dataKey);
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      if (!compareThreshold(value, t.op, t.value)) continue;
      this.fired.add(t.id);
      this.fire(t);
      this.triggers = this.triggers.filter((x) => x.id !== t.id);
      this.unsubByTrigger.get(t.id)?.();
      this.unsubByTrigger.delete(t.id);
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
    const source = getDataSource(this.sourceId);
    if (!source) return;
    for (const b of burns) {
      const action = `o.addManeuverNode[${b.ut.toFixed(3)},${b.radial.toFixed(3)},${b.normal.toFixed(3)},${b.prograde.toFixed(3)}]`;
      void source.execute(action);
    }
  }

  private readLiveOrbit() {
    const sma = this.readNumber("o.sma");
    const ecc = this.readNumber("o.eccentricity");
    const ApR = this.readNumber("o.ApR");
    const PeR = this.readNumber("o.PeR");
    const timeToAp = this.readNumber("o.timeToAp");
    const timeToPe = this.readNumber("o.timeToPe");
    const currentUT = this.readNumber("t.universalTime") ?? undefined;
    const orbitalSpeed = this.readNumber("o.orbitalSpeed") ?? undefined;
    const radius = this.readNumber("o.radius") ?? undefined;
    const period = this.readNumber("o.period") ?? undefined;
    return {
      currentOrbit: buildCurrentOrbit({
        sma: sma ?? undefined,
        ecc: ecc ?? undefined,
        ApR: ApR ?? undefined,
        PeR: PeR ?? undefined,
        timeToAp: timeToAp ?? undefined,
        timeToPe: timeToPe ?? undefined,
      }),
      currentUT,
      mu: computeMu(orbitalSpeed, radius, sma ?? undefined, period),
      trueAnomaly: this.readNumber("o.trueAnomaly") ?? undefined,
      argPe: this.readNumber("o.argumentOfPeriapsis") ?? undefined,
      inclination: this.readNumber("o.inclination") ?? undefined,
      lan: this.readNumber("o.lan") ?? undefined,
      targetInclinationLive: this.readNumber("tar.o.inclination") ?? undefined,
      targetLanLive: this.readNumber("tar.o.lan") ?? undefined,
      targetSma: this.readNumber("tar.o.sma") ?? undefined,
      targetPeA: this.readNumber("tar.o.PeA") ?? undefined,
      targetArgPe: this.readNumber("tar.o.argumentOfPeriapsis") ?? undefined,
      targetTrueAnomaly: this.readNumber("tar.o.trueAnomaly") ?? undefined,
      targetPeriod: this.readNumber("tar.o.period") ?? undefined,
      bodyRadius: this.readBodyRadius(),
    };
  }

  private readBodyRadius(): number | undefined {
    const bodyName = this.readValue("v.body");
    const refBody = this.readValue("o.referenceBody");
    const name =
      (typeof bodyName === "string" ? bodyName : null) ??
      (typeof refBody === "string" ? refBody : "");
    return getBody(name)?.radius;
  }

  private readValue(key: string): unknown {
    const source = getDataSource(this.sourceId);
    type WithLatest = {
      getLatestValue?: (k: string) => unknown;
    };
    const reader = source as WithLatest | null;
    return reader?.getLatestValue?.(key);
  }

  private readNumber(key: string): number | null {
    const v = this.readValue(key);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const cb of this.listeners) cb(snap);
  }
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `trigger_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
