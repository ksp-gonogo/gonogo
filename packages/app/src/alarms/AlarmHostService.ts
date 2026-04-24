import { logger } from "@gonogo/core";
import type { BufferedDataSource } from "@gonogo/data";
import type { PeerHostService } from "../peer/PeerHostService";
import {
  type Alarm,
  type AlarmSnapshot,
  type AlarmWarpState,
  DEFAULT_LEAD_SECONDS,
} from "./types";

/**
 * Main-screen mission-alarm service.
 *
 * Responsibilities:
 *   - Maintain the canonical alarm list (persisted in localStorage).
 *   - Tick at 1 Hz using Telemachus's `t.universalTime` to advance alarm
 *     state (pending → arming → firing → fired).
 *   - When an alarm arms, drop KSP's warp to index 0 via `t.timeWarp[0]`.
 *   - Watch observed warp state for unscheduled changes (warp went up
 *     without an alarm commanding it or a station explicitly asking for
 *     it) — surface as `unscheduledWarp` in the snapshot.
 *   - Broadcast snapshots to connected peers via the host service.
 *   - Accept add / update / delete from peers via the host service.
 *
 * Intentionally minimal v1: the warp step-down is a single `t.timeWarp[0]`
 * command; KSP's own gradual-drop behaviour smooths the transition. More
 * elaborate step ladders can slot in later without changing the shape.
 */

const STORAGE_KEY = "gonogo.alarms.list";
/** Grace window around a station-initiated warp intent — any observed
 *  warp change within this window is attributed to the station. */
const WARP_INTENT_WINDOW_MS = 2_000;
/** Minimum interval between `t.timeWarp[0]` executes to avoid spamming. */
const WARP_COMMAND_COOLDOWN_MS = 1_500;

interface TelemetryReader {
  getLatestValue(key: string): unknown;
  execute(action: string): Promise<void>;
}

type SnapshotListener = (snapshot: AlarmSnapshot) => void;
type FireListener = (alarm: Alarm) => void;

export interface AlarmHostOptions {
  /** Override for tests — defaults to setInterval / Date.now. */
  nowMs?: () => number;
  /** ms between ticks. Default 1000. */
  tickIntervalMs?: number;
  /** Storage override for tests. */
  storage?: Storage;
}

export class AlarmHostService {
  private alarms: Alarm[] = [];
  private snapshotListeners = new Set<SnapshotListener>();
  private fireListeners = new Set<FireListener>();
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private lastWarpCommandAt = 0;
  private lastStationWarpIntentAt: number | null = null;
  private observedWarp: AlarmWarpState = {
    index: 0,
    rate: 1,
    mode: "UNKNOWN",
  };
  private observedUT: number | null = null;
  private unscheduledWarp: AlarmSnapshot["unscheduledWarp"] = null;
  private host: PeerHostService | null;
  private telemetry: TelemetryReader | null;
  private opts: Required<Pick<AlarmHostOptions, "nowMs" | "tickIntervalMs">>;
  private storage: Storage;

  constructor(
    host: PeerHostService | null,
    telemetry: TelemetryReader | null,
    opts: AlarmHostOptions = {},
  ) {
    this.host = host;
    this.telemetry = telemetry;
    this.opts = {
      nowMs: opts.nowMs ?? (() => Date.now()),
      tickIntervalMs: opts.tickIntervalMs ?? 1000,
    };
    this.storage = opts.storage ?? globalThis.localStorage;
    this.load();
    this.bindPeerListeners();
    this.start();
  }

  // ── Public API ────────────────────────────────────────────────────────

  snapshot(): AlarmSnapshot {
    return {
      alarms: [...this.alarms],
      ut: this.observedUT,
      warp: this.observedWarp,
      unscheduledWarp: this.unscheduledWarp,
    };
  }

  subscribe(cb: SnapshotListener): () => void {
    this.snapshotListeners.add(cb);
    return () => this.snapshotListeners.delete(cb);
  }

  onFire(cb: FireListener): () => void {
    this.fireListeners.add(cb);
    return () => this.fireListeners.delete(cb);
  }

  addAlarm(input: {
    ut: number;
    name: string;
    notes?: string;
    leadSeconds?: number;
    createdBy?: string;
  }): Alarm {
    const alarm: Alarm = {
      id: generateId(),
      ut: input.ut,
      name: input.name.trim() || "Alarm",
      notes: input.notes?.trim() || undefined,
      leadSeconds: input.leadSeconds ?? DEFAULT_LEAD_SECONDS,
      // Always start "pending" — the next tick() transitions to arming /
      // firing with the usual side effects (warp step-down etc.), so the
      // state machine stays driven from a single place.
      state: "pending",
      createdBy: input.createdBy ?? "main",
      createdAt: this.opts.nowMs(),
    };
    this.alarms.push(alarm);
    this.persist();
    // Reconcile immediately so the banner doesn't show "pending" for a
    // second after adding an already-arming alarm, and so the warp
    // step-down fires without waiting for the next interval.
    this.tick();
    return alarm;
  }

  updateAlarm(
    id: string,
    patch: Partial<Pick<Alarm, "ut" | "name" | "notes" | "leadSeconds">>,
  ): void {
    const idx = this.alarms.findIndex((a) => a.id === id);
    if (idx < 0) return;
    const prev = this.alarms[idx];
    const next: Alarm = {
      ...prev,
      ...(patch.ut !== undefined ? { ut: patch.ut } : {}),
      ...(patch.name !== undefined
        ? { name: patch.name.trim() || prev.name }
        : {}),
      ...(patch.notes !== undefined
        ? { notes: patch.notes.trim() || undefined }
        : {}),
      ...(patch.leadSeconds !== undefined
        ? { leadSeconds: patch.leadSeconds }
        : {}),
    };
    next.state = this.deriveState(next.ut, next.leadSeconds);
    this.alarms[idx] = next;
    this.persist();
    this.emit();
  }

  deleteAlarm(id: string): void {
    const before = this.alarms.length;
    this.alarms = this.alarms.filter((a) => a.id !== id);
    if (this.alarms.length !== before) {
      this.persist();
      this.emit();
    }
  }

  acknowledgeUnscheduledWarp(): void {
    if (!this.unscheduledWarp) return;
    this.unscheduledWarp = null;
    this.emit();
  }

  /** Station said "I just asked KSP to change warp". Remember so the
   *  unscheduled-warp detector doesn't flag that change. */
  registerStationWarpIntent(): void {
    this.lastStationWarpIntentAt = this.opts.nowMs();
  }

  dispose(): void {
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  // ── Tick loop ─────────────────────────────────────────────────────────

  private start(): void {
    if (this.tickHandle !== null) return;
    this.tickHandle = setInterval(() => this.tick(), this.opts.tickIntervalMs);
    // Do an immediate pass so the first snapshot reflects persisted state.
    this.tick();
  }

  private tick(): void {
    const ut = this.readTelemetryNumber("t.universalTime");
    this.observedUT = ut ?? this.observedUT;
    this.observeWarp();

    if (ut !== null) {
      let changed = false;
      for (const alarm of this.alarms) {
        const nextState = this.deriveState(alarm.ut, alarm.leadSeconds, ut);
        if (nextState !== alarm.state) {
          if (alarm.state !== "arming" && nextState === "arming") {
            this.stepWarpDown();
          }
          if (alarm.state !== "firing" && nextState === "firing") {
            this.notifyFire(alarm);
            // Also force warp to 0 one more time — in case the warp
            // recovered between `arming` and `firing`.
            this.stepWarpDown();
          }
          alarm.state = nextState;
          changed = true;
        }
      }
      // Drop fired alarms after a few seconds of visibility.
      const beforeLen = this.alarms.length;
      this.alarms = this.alarms.filter(
        (a) => !(a.state === "fired" && ut - a.ut > 5),
      );
      if (this.alarms.length !== beforeLen) changed = true;

      if (changed) this.persist();
    }

    this.detectUnscheduledWarp();
    this.emit();
  }

  private deriveState(
    ut: number,
    leadSeconds: number,
    now: number = this.observedUT ?? ut,
  ): Alarm["state"] {
    if (now === null) return "pending";
    if (now >= ut && now - ut < 2) return "firing";
    if (now >= ut) return "fired";
    if (ut - now <= leadSeconds) return "arming";
    return "pending";
  }

  // ── Warp observation + detection ──────────────────────────────────────

  private observeWarp(): void {
    const index = this.readTelemetryNumber("t.currentRateIndex");
    const rate = this.readTelemetryNumber("t.currentRate");
    const rawMode = this.telemetry?.getLatestValue("t.warpMode");
    const mode: AlarmWarpState["mode"] =
      rawMode === "HIGH" || rawMode === "LOW" ? rawMode : "UNKNOWN";
    this.observedWarp = {
      index: index ?? this.observedWarp.index,
      rate: rate ?? this.observedWarp.rate,
      mode,
    };
  }

  private detectUnscheduledWarp(): void {
    // Warp at rate 0 is normal — clear any previous flag.
    if (this.observedWarp.index <= 0) {
      this.unscheduledWarp = null;
      return;
    }

    const ut = this.observedUT;
    if (ut === null) return;

    // Any alarm currently arming/firing accounts for elevated warp.
    const anyArming = this.alarms.some(
      (a) => a.state === "arming" || a.state === "firing",
    );
    if (anyArming) {
      this.unscheduledWarp = null;
      return;
    }

    // A recent station-initiated change accounts for it, too.
    const now = this.opts.nowMs();
    if (
      this.lastStationWarpIntentAt !== null &&
      now - this.lastStationWarpIntentAt < WARP_INTENT_WINDOW_MS
    ) {
      return;
    }

    // Only flag once per episode — while warp stays elevated, keep the
    // same detection UT so the banner shows a stable "since X" clock.
    if (!this.unscheduledWarp) {
      this.unscheduledWarp = {
        index: this.observedWarp.index,
        detectedAtUT: ut,
      };
    } else {
      this.unscheduledWarp.index = this.observedWarp.index;
    }
  }

  private stepWarpDown(): void {
    const now = this.opts.nowMs();
    if (now - this.lastWarpCommandAt < WARP_COMMAND_COOLDOWN_MS) return;
    this.lastWarpCommandAt = now;
    if (!this.telemetry) return;
    void this.telemetry.execute("t.timeWarp[0]").catch((err) => {
      logger.warn("alarm-host: warp-down command failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // ── Peer wiring ───────────────────────────────────────────────────────

  private bindPeerListeners(): void {
    if (!this.host) return;
    this.host.onAlarmAdd((peerId, msg) => {
      this.addAlarm({
        ut: msg.ut,
        name: msg.name,
        notes: msg.notes,
        leadSeconds: msg.leadSeconds,
        createdBy: peerId,
      });
    });
    this.host.onAlarmUpdate((_peerId, msg) => {
      this.updateAlarm(msg.id, msg.patch);
    });
    this.host.onAlarmDelete((_peerId, id) => {
      this.deleteAlarm(id);
    });
    this.host.onAlarmAckUnscheduledWarp(() => {
      this.acknowledgeUnscheduledWarp();
    });
    this.host.onAlarmWarpIntent(() => {
      this.registerStationWarpIntent();
    });
  }

  private notifyFire(alarm: Alarm): void {
    for (const cb of this.fireListeners) cb(alarm);
    this.host?.broadcast({
      type: "alarm-fired",
      id: alarm.id,
      name: alarm.name,
      ut: alarm.ut,
    });
  }

  // ── Listeners + persistence ──────────────────────────────────────────

  private emit(): void {
    const snap = this.snapshot();
    for (const cb of this.snapshotListeners) cb(snap);
    this.host?.broadcast({ type: "alarm-snapshot", snapshot: snap });
  }

  private load(): void {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Alarm[];
      if (Array.isArray(parsed)) {
        this.alarms = parsed.filter(
          (a): a is Alarm =>
            typeof a?.id === "string" &&
            typeof a?.name === "string" &&
            typeof a?.ut === "number",
        );
      }
    } catch {
      // Corrupt — nuke and start fresh.
      this.storage.removeItem(STORAGE_KEY);
    }
  }

  private persist(): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(this.alarms));
  }

  private readTelemetryNumber(key: string): number | null {
    const v = this.telemetry?.getLatestValue(key);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
}

export function createAlarmHost(
  host: PeerHostService | null,
  getTelemetry: () => BufferedDataSource | null,
  opts?: AlarmHostOptions,
): AlarmHostService {
  // BufferedDataSource implements both getLatestValue and execute.
  const telemetry: TelemetryReader = {
    getLatestValue(key: string): unknown {
      return getTelemetry()?.getLatestValue(key);
    },
    execute(action: string): Promise<void> {
      const src = getTelemetry();
      if (!src) return Promise.resolve();
      return src.execute(action);
    },
  };
  return new AlarmHostService(host, telemetry, opts);
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `alarm_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}
