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
} from "@gonogo/components";
import { getBody, safeRandomUuid } from "@gonogo/core";
import { LocalStorageStore } from "@gonogo/data";
import type { PeerHostService } from "../peer/PeerHostService";

/**
 * Main-screen owner of conditional maneuver triggers.
 *
 * Responsibilities:
 *   - Maintain the canonical trigger list (persisted in localStorage so a
 *     reload doesn't lose armed conditions, including ones armed by a
 *     station — which is the whole point of moving them off the widget).
 *   - Tick at 1 Hz (alarm-style) plus on every value emit for the watched
 *     keys, evaluating each trigger's condition and firing once when the
 *     comparison first holds.
 *   - On fire: recompute the plan from the trigger's frozen inputs against
 *     the *current* orbit, then dispatch each burn via execute.
 *   - Auto-clear triggers whose stored vesselName no longer matches the
 *     observed `v.name` — a circularize armed for vessel A shouldn't fire
 *     on vessel B.
 *   - Broadcast snapshots to connected peers; accept arm / cancel from
 *     them via the host service.
 */

const STORAGE_KEY = "gonogo.maneuverTriggers.list";

interface TelemetryReader {
  getLatestValue(key: string): unknown;
  execute(action: string): Promise<void>;
  subscribe(key: string, cb: (value: unknown) => void): () => void;
}

export interface ManeuverTriggerHostOptions {
  nowMs?: () => number;
  storage?: Storage;
}

export class ManeuverTriggerHostService implements ManeuverTriggerService {
  private triggers: ArmedTrigger[] = [];
  private listeners = new Set<(snap: TriggerSnapshot) => void>();
  private fired = new Set<string>();
  private unsubByKey = new Map<string, () => void>();
  private vesselUnsub: (() => void) | null = null;
  private host: PeerHostService | null;
  private telemetry: TelemetryReader | null;
  private store: LocalStorageStore<ArmedTrigger[]>;
  private readonly nowMs: () => number;

  constructor(
    host: PeerHostService | null,
    telemetry: TelemetryReader | null,
    opts: ManeuverTriggerHostOptions = {},
  ) {
    this.host = host;
    this.telemetry = telemetry;
    this.nowMs = opts.nowMs ?? (() => Date.now());
    this.store = new LocalStorageStore<ArmedTrigger[]>({
      key: STORAGE_KEY,
      defaults: [],
      storage: opts.storage ?? globalThis.localStorage,
    });
    this.load();
    this.bindPeerListeners();
    this.bindVesselWatcher();
    this.rebuildKeySubscriptions();
    // Evaluate once on startup so an already-true condition (rare but
    // possible: page reload after telemetry has crossed the threshold)
    // fires immediately rather than waiting for the next emit.
    this.evaluate();
  }

  dispose(): void {
    for (const unsub of this.unsubByKey.values()) unsub();
    this.unsubByKey.clear();
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
      this.rebuildKeySubscriptions();
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
    this.rebuildKeySubscriptions();
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
    if (!this.telemetry) return;
    this.vesselUnsub = this.telemetry.subscribe("v.name", () => {
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
        this.rebuildKeySubscriptions();
      }
      // Always emit so vesselName updates flow to peers + UI.
      this.emit();
      this.evaluate();
    });
  }

  private rebuildKeySubscriptions(): void {
    if (!this.telemetry) return;
    const wanted = new Set(this.triggers.map((t) => t.dataKey));
    // Drop subscriptions for keys we no longer care about.
    for (const [key, unsub] of this.unsubByKey) {
      if (!wanted.has(key)) {
        unsub();
        this.unsubByKey.delete(key);
      }
    }
    // Add subscriptions for any new keys.
    for (const key of wanted) {
      if (this.unsubByKey.has(key)) continue;
      const unsub = this.telemetry.subscribe(key, () => this.evaluate());
      this.unsubByKey.set(key, unsub);
    }
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
      const value = this.readNumber(t.dataKey);
      if (value === null) continue;
      if (!compareThreshold(value, t.op, t.value)) continue;
      this.fired.add(t.id);
      this.fire(t);
      this.triggers = this.triggers.filter((x) => x.id !== t.id);
      mutated = true;
    }
    if (mutated) {
      this.persist();
      this.rebuildKeySubscriptions();
      this.emit();
    }
  }

  private fire(trigger: ArmedTrigger): void {
    if (!this.telemetry) return;
    const live = this.readLiveOrbit();
    const planInputs = { ...trigger.inputs, ...live };
    const plan = computePlan(planInputs);
    if (!plan) return;
    const burns = isSequence(plan) ? plan.burns : [plan];
    for (const b of burns) {
      const action = `o.addManeuverNode[${b.ut.toFixed(3)},${b.radial.toFixed(3)},${b.normal.toFixed(3)},${b.prograde.toFixed(3)}]`;
      void this.telemetry.execute(action);
    }
  }

  private readLiveOrbit() {
    const sma = this.readNumber("o.sma") ?? undefined;
    const ecc = this.readNumber("o.eccentricity") ?? undefined;
    const ApR = this.readNumber("o.ApR") ?? undefined;
    const PeR = this.readNumber("o.PeR") ?? undefined;
    const timeToAp = this.readNumber("o.timeToAp") ?? undefined;
    const timeToPe = this.readNumber("o.timeToPe") ?? undefined;
    const currentUT = this.readNumber("t.universalTime") ?? undefined;
    const orbitalSpeed = this.readNumber("o.orbitalSpeed") ?? undefined;
    const radius = this.readNumber("o.radius") ?? undefined;
    const period = this.readNumber("o.period") ?? undefined;
    const bodyName = this.readString("v.body");
    const refBody = this.readString("o.referenceBody");
    return {
      currentOrbit: buildCurrentOrbit({
        sma,
        ecc,
        ApR,
        PeR,
        timeToAp,
        timeToPe,
      }),
      currentUT,
      mu: computeMu(orbitalSpeed, radius, sma, period),
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
      bodyRadius: getBody(bodyName ?? refBody ?? "")?.radius,
    };
  }

  private readVesselName(): string | null {
    return this.readString("v.name");
  }

  private readNumber(key: string): number | null {
    const v = this.telemetry?.getLatestValue(key);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }

  private readString(key: string): string | null {
    const v = this.telemetry?.getLatestValue(key);
    return typeof v === "string" ? v : null;
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
