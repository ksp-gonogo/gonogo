import {
  type ArmedTrigger,
  type ArmTriggerInput,
  buildCurrentOrbit,
  compareThreshold,
  computeMu,
  computePlan,
  EMPTY_TRIGGER_SNAPSHOT,
  type FrozenPlanInputs,
  isSequence,
  type ManeuverTriggerService,
  type ThresholdOp,
  type TriggerSnapshot,
} from "@ksp-gonogo/components";
import { getBody, safeRandomUuid } from "@ksp-gonogo/core";
import { LocalStorageStore } from "@ksp-gonogo/data";
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
import type { PeerHostService } from "../peer/PeerHostService";

/**
 * Main-screen owner of conditional maneuver triggers.
 *
 * Responsibilities:
 *   - Maintain the canonical trigger list (persisted in localStorage so a
 *     reload doesn't lose armed conditions, including ones armed by a
 *     station — which is the whole point of moving them off the widget).
 *   - Tick at 1 Hz (alarm-style) plus on every stream frame, evaluating each
 *     trigger's condition and firing once when the comparison first holds.
 *   - On fire: recompute the plan from the trigger's frozen inputs against
 *     the *current* orbit, then dispatch each burn via the stream.
 *   - Auto-clear triggers whose observed vessel identity no longer matches
 *     the one it was armed against — a circularize armed for vessel A
 *     shouldn't fire on vessel B.
 *   - Broadcast snapshots to connected peers; accept arm / cancel from
 *     them via the host service.
 *
 * `readLiveOrbit()`/`readVesselName()` read the vessel's own orbit, the
 * current target's orbit, and vessel identity off the non-hook
 * `getVesselOrbit()`/`getVesselTarget()`/`getVesselIdentity()`/
 * `getVesselState()` accessors (`@ksp-gonogo/sitrep-client`) — the same
 * `TimelineStore` a mounted widget's `useTelemetry` would read. An armed
 * TRIGGER's own `dataKey` is an operator-picked key too, but no longer an
 * ARBITRARY one: the widget's `DataKeyPicker` only offers keys
 * `@ksp-gonogo/data`'s `useValueKeys` resolves — the Value-restricted,
 * stream-mapped set — so the threshold read (`getValue`) and the
 * maneuver-node fire (`dispatchActiveCommand`) both ride the stream now, the
 * same way `LocalManeuverTriggerService` does.
 */

const STORAGE_KEY = "gonogo.maneuverTriggers.list";

export interface ManeuverTriggerHostOptions {
  nowMs?: () => number;
  storage?: Storage;
}

export class ManeuverTriggerHostService implements ManeuverTriggerService {
  private triggers: ArmedTrigger[] = [];
  private listeners = new Set<(snap: TriggerSnapshot) => void>();
  private fired = new Set<string>();
  private vesselUnsub: (() => void) | null = null;
  private host: PeerHostService | null;
  private store: LocalStorageStore<ArmedTrigger[]>;
  private readonly nowMs: () => number;

  constructor(
    host: PeerHostService | null,
    opts: ManeuverTriggerHostOptions = {},
  ) {
    this.host = host;
    this.nowMs = opts.nowMs ?? (() => Date.now());
    this.store = new LocalStorageStore<ArmedTrigger[]>({
      key: STORAGE_KEY,
      defaults: [],
      storage: opts.storage ?? globalThis.localStorage,
    });
    this.load();
    this.bindPeerListeners();
    this.bindVesselWatcher();
    // Evaluate once on startup so an already-true condition (rare but
    // possible: page reload after telemetry has crossed the threshold)
    // fires immediately rather than waiting for the next stream frame.
    this.evaluate();
  }

  dispose(): void {
    this.vesselUnsub?.();
    this.vesselUnsub = null;
    this.listeners.clear();
  }

  // ── Public API ──────────────────────────────────────────────────────

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
    this.armFor(input, "main");
  }

  cancel(id: string): void {
    const before = this.triggers.length;
    this.triggers = this.triggers.filter((t) => t.id !== id);
    this.fired.delete(id);
    if (this.triggers.length !== before) {
      this.persist();
      this.emit();
    }
  }

  // ── Internals ───────────────────────────────────────────────────────

  private armFor(input: ArmTriggerInput, createdBy: string): void {
    const trigger: ArmedTrigger = {
      id: generateId(),
      dataKey: input.dataKey,
      op: input.op,
      value: input.value,
      inputs: input.inputs,
      vesselName: this.readVesselName(),
      createdAt: this.nowMs(),
      createdBy,
    };
    this.triggers.push(trigger);
    this.persist();
    this.emit();
    this.evaluate();
  }

  private bindPeerListeners(): void {
    if (!this.host) return;
    this.host.onTriggerArm((peerId, msg) => {
      this.armFor(
        {
          dataKey: msg.dataKey,
          op: msg.op as ThresholdOp,
          value: msg.value,
          inputs: msg.inputs as FrozenPlanInputs,
        },
        peerId,
      );
    });
    this.host.onTriggerCancel((_peerId, id) => {
      this.cancel(id);
    });
  }

  private bindVesselWatcher(): void {
    // Vessel-identity/orbit reads ride the stream (`getVesselIdentity()` et
    // al, sampled on demand — see `readLiveOrbit`/`readVesselName`), so this
    // watches for a new stream FRAME rather than a legacy `v.name` value
    // emit. The same frame tick re-evaluates every armed trigger's
    // `dataKey` threshold below (`evaluate()`) — no more per-key data-source
    // subscription.
    this.vesselUnsub = onActiveTimelineFrame(() => {
      // Vessel changed — drop triggers for the old one.
      const live = this.readVesselName();
      const before = this.triggers.length;
      this.triggers = this.triggers.filter(
        (t) => t.vesselName === null || t.vesselName === live,
      );
      const removedIds = this.triggers
        .filter((t) => !this.triggers.includes(t))
        .map((t) => t.id);
      for (const id of removedIds) this.fired.delete(id);
      if (this.triggers.length !== before) {
        this.persist();
      }
      // Always emit so vesselName updates flow to peers + UI.
      this.emit();
      this.evaluate();
    });
  }

  private evaluate(): void {
    if (this.triggers.length === 0) return;
    const live = this.readVesselName();
    let mutated = false;
    for (const t of [...this.triggers]) {
      // Vessel mismatch — drop.
      if (t.vesselName !== null && t.vesselName !== live) {
        this.triggers = this.triggers.filter((x) => x.id !== t.id);
        mutated = true;
        continue;
      }
      if (this.fired.has(t.id)) continue;
      const value = getValue("data", t.dataKey);
      if (value === undefined) continue;
      if (!compareThreshold(value, t.op, t.value)) continue;
      this.fired.add(t.id);
      this.fire(t);
      this.triggers = this.triggers.filter((x) => x.id !== t.id);
      mutated = true;
    }
    if (mutated) {
      this.persist();
      this.emit();
    }
  }

  private fire(trigger: ArmedTrigger): void {
    const live = this.readLiveOrbit();
    const planInputs = { ...trigger.inputs, ...live };
    const plan = computePlan(planInputs);
    if (!plan) return;
    const burns = isSequence(plan) ? plan.burns : [plan];
    for (const b of burns) {
      const action = `o.addManeuverNode[${b.ut.toFixed(3)},${b.radial.toFixed(3)},${b.normal.toFixed(3)},${b.prograde.toFixed(3)}]`;
      const outcome = dispatchActiveCommand("data", action);
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
      // SDK's own view time, read via the non-hook `getViewUt` accessor rather
      // than the legacy telemetry reader.
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
      bodyRadius: getBody(
        state?.parentBodyName ?? state?.referenceBodyName ?? "",
      )?.radius,
    };
  }

  private readVesselName(): string | null {
    return getVesselIdentity()?.name ?? null;
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const cb of this.listeners) cb(snap);
    this.host?.broadcast({ type: "trigger-snapshot", snapshot: snap });
  }

  private persist(): void {
    this.store.set(this.triggers);
  }

  private load(): void {
    const parsed = this.store.get();
    if (Array.isArray(parsed)) {
      this.triggers = parsed
        .map(migrateTrigger)
        .filter((t): t is ArmedTrigger => t !== null);
    }
  }
}

function migrateTrigger(raw: unknown): ArmedTrigger | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.id !== "string" ||
    typeof r.dataKey !== "string" ||
    typeof r.value !== "number" ||
    typeof r.op !== "string"
  ) {
    return null;
  }
  return {
    id: r.id,
    dataKey: r.dataKey,
    op: r.op as ThresholdOp,
    value: r.value,
    inputs: r.inputs as FrozenPlanInputs,
    vesselName: typeof r.vesselName === "string" ? r.vesselName : null,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
    createdBy: typeof r.createdBy === "string" ? r.createdBy : "main",
  };
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return safeRandomUuid();
  }
  return `trigger_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export { EMPTY_TRIGGER_SNAPSHOT };
