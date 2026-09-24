import {
  actionGroupIdOf,
  actionGroupsFrom,
  buildToggleArgs,
  resolveGroupValue,
  safeRandomUuid,
  TOGGLE_INVALID,
  toggleCommandFor,
} from "@ksp-gonogo/core";
import { LocalStorageStore } from "@ksp-gonogo/data";
import { logger } from "@ksp-gonogo/logger";
import {
  type DispatchActiveCommandResult,
  dispatchActiveCommandTopic,
  getViewUt,
  sampleActiveTopic,
} from "@ksp-gonogo/sitrep-client";
import type { CommsDelay, VesselControl } from "@ksp-gonogo/sitrep-sdk";
import type { PeerHostService } from "../peer/PeerHostService";
import { AlarmPeerBridge } from "./AlarmPeerBridge";
import {
  AlarmStateMachine,
  type RevealedEventsReader,
} from "./AlarmStateMachine";
import { AlarmWarpPlanner } from "./AlarmWarpPlanner";
import { ScetAlarmBridge } from "./ScetAlarmBridge";
import {
  type Alarm,
  type AlarmSnapshot,
  type AlarmTrigger,
  DEFAULT_WARP_SAFETY_MARGIN_SECONDS,
  MAX_WARP_SAFETY_MARGIN_SECONDS,
  MIN_WARP_SAFETY_MARGIN_SECONDS,
  migrateAlarm,
  modOwnsLatch,
} from "./types";
import { WarpControl } from "./WarpControl";
import { WarpObserver } from "./WarpObserver";

/**
 * Trigger kinds that need match tracking via `matchSinceUT`. Time triggers
 * don't (they fire purely on UT comparison); threshold and contract-parameter
 * track a contiguous match, and event latches `matchSinceUT` on the first
 * matching occurrence.
 */
function requiresMatchTracking(trigger: AlarmTrigger): boolean {
  return (
    trigger.kind === "threshold" ||
    trigger.kind === "contract-parameter" ||
    trigger.kind === "event" ||
    // A mod-owned time alarm is latched from OUTSIDE, by the fire notice, the
    // same way an event alarm is latched by an occurrence. The client's own
    // clock never decides it, so it needs the latch field a plain time alarm
    // does not.
    modOwnsLatch(trigger)
  );
}

/**
 * Main-screen mission-alarm service.
 *
 * Responsibilities:
 *   - Maintain the canonical alarm list (persisted in localStorage).
 *   - Tick at 1 Hz using the SDK's view time (`getViewUt`) to advance alarm
 *     state (pending → arming → firing → fired).
 *   - When an alarm arms, drop KSP's warp to index 0 via `t.timeWarp[0]`.
 *   - Watch observed warp state for unscheduled changes (warp went up
 *     without an alarm commanding it or a station explicitly asking for
 *     it): surface as `unscheduledWarp` in the snapshot.
 *   - Broadcast snapshots to connected peers via the host service.
 *   - Accept add / update / delete from peers via the host service.
 *
 * The stateful pieces are extracted into collaborating modules:
 *   - `AlarmStateMachine`: `deriveState` and the match tracking behind it.
 *   - `AlarmWarpPlanner`: the slope-fit sample buffers, the ETA, and the
 *     closest/eligible-alarm queries `WarpControl` asks of them.
 *   - `WarpControl`: the warp-to controller and `stepWarpDown`.
 *   - `WarpObserver`: warp telemetry + unscheduled-warp detection.
 *   - `AlarmPeerBridge`: peer event wiring and broadcasts.
 */

const STORAGE_KEY = "gonogo.alarms.list";
const WARP_MARGIN_STORAGE_KEY = "gonogo.alarms.warpSafetyMargin";

type SnapshotListener = (snapshot: AlarmSnapshot) => void;
type FireListener = (alarm: Alarm) => void;

export interface AlarmHostOptions {
  nowMs?: () => number;
  tickIntervalMs?: number;
  storage?: Storage;
  /**
   * Reader for revealed `event`-topic occurrences, backing the `event`
   * trigger kind. Defaults to empty (no event alarm ever fires) when omitted;
   * the main screen passes one wired to the kerbcast Uplink's producer.
   */
  getRevealedEvents?: RevealedEventsReader;
  /**
   * One-way light time to the craft, seconds. Defaults to the live
   * `comms.delay` reading; a test injects its own.
   */
  getOwltSeconds?: () => number;
}

/**
 * The current one-way delay off the wire, or 0 where there is none.
 *
 * Read through `sampleActiveTopic` because this is a headless service with no
 * widget to hang a hook on, the same way it reads `vessel.control` to resolve
 * an action group. A null `oneWaySeconds` means NO PATH rather than a measured
 * zero, but for the one thing this feeds (how much room to leave at the end of
 * a warp) an unmeasurable link and a LAN link both come back to the operator's
 * own configured margin, so both collapse to 0 here.
 */
function readOwltSeconds(): number {
  const seconds =
    sampleActiveTopic<CommsDelay>("comms.delay")?.oneWaySeconds?.magnitude;
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
    ? seconds
    : 0;
}

/**
 * Fire one action group, named by the id a save spells it with.
 *
 * Resolves the id against the LIVE registry, because the custom half of it is
 * whatever the elected backend reports: an id naming a group this vessel does
 * not have resolves to nothing and dispatches nothing, which is the honest
 * answer for a saved action whose group is gone.
 *
 * The toggle-to-absolute bridge needs the group's current state to invert, and
 * this is a headless caller with no widget of its own, so it samples
 * `vessel.control` directly. A group whose state has not arrived yields
 * `TOGGLE_INVALID` and dispatches nothing rather than a blind set: an alarm
 * that guesses which way to flip a group is worse than one that does not fire.
 */
function dispatchActionGroup(
  actionGroupId: string,
): DispatchActiveCommandResult {
  const control = sampleActiveTopic<VesselControl>("vessel.control");
  const group = actionGroupsFrom(control?.actionGroups).find(
    (g) => actionGroupIdOf(g) === actionGroupId,
  );
  if (!group) return { routed: false };
  const command = toggleCommandFor(group);
  if (command === null) return { routed: false };
  const args = buildToggleArgs(group, resolveGroupValue(group, control));
  if (args === TOGGLE_INVALID) return { routed: false };
  return dispatchActiveCommandTopic(command, args);
}

export class AlarmHostService {
  private alarms: Alarm[] = [];
  private snapshotListeners = new Set<SnapshotListener>();
  private fireListeners = new Set<FireListener>();
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private observedUT: number | null = null;
  /**
   * The UT of the PREVIOUS tick, so an unreadable read can slide a sustain
   * latch past the seconds nobody watched rather than let them pay into it.
   */
  private lastTickUt: number | null = null;
  private opts: Required<
    Pick<AlarmHostOptions, "nowMs" | "tickIntervalMs" | "getOwltSeconds">
  >;
  private storage: Storage;
  private alarmStore: LocalStorageStore<Alarm[]>;
  private stateMachine: AlarmStateMachine;
  private warpPlanner: AlarmWarpPlanner;
  private warp: WarpControl;
  private warpObserver: WarpObserver;
  private peerBridge: AlarmPeerBridge;
  private scetBridge: ScetAlarmBridge;
  /**
   * Why the simulation would not arm an alarm, by alarm id.
   *
   * Not persisted: it is a fact about the mod this client is talking to right
   * now, and the next one may address a different set of Topics. An entry is
   * dropped the moment the same alarm arms successfully or its trigger is
   * edited, so it can never outlive the condition it describes.
   */
  private scetArmRefusals = new Map<string, string>();

  /**
   * Alarms read from storage that no tick has evaluated yet. A fire found on
   * that first evaluation was reconstructed from what was persisted, not
   * watched happening, so it is a late fire.
   */
  private unevaluated = new Set<string>();

  /**
   * What the SIMULATION decided about a command-vantage alarm, by alarm id.
   *
   * SHADOW ONLY: nothing reads this to decide anything, and it must not. The
   * client stays the authority for an alarm on its own clock; this is here so
   * the two verdicts on one alarm can be compared, in both directions, as they
   * land. Not persisted and not emitted, because it is evidence about this
   * session's agreement rather than state anything renders.
   */
  private shadowVerdicts = new Map<
    string,
    { firedAtUt: number; vantage: string }
  >();

  constructor(host: PeerHostService | null, opts: AlarmHostOptions = {}) {
    this.opts = {
      nowMs: opts.nowMs ?? (() => Date.now()),
      tickIntervalMs: opts.tickIntervalMs ?? 1000,
      getOwltSeconds: opts.getOwltSeconds ?? readOwltSeconds,
    };
    this.storage = opts.storage ?? globalThis.localStorage;
    this.alarmStore = new LocalStorageStore<Alarm[]>({
      key: STORAGE_KEY,
      defaults: [],
      storage: this.storage,
    });

    this.stateMachine = new AlarmStateMachine(
      () => this.observedUT,
      opts.getRevealedEvents,
      undefined,
      (alarm) => this.scetArmRefusals.has(alarm.id),
    );
    this.warpPlanner = new AlarmWarpPlanner(
      () => this.alarms,
      () => this.observedUT,
      () => this.opts.getOwltSeconds(),
    );

    const initialMargin = this.loadMargin();
    this.warpObserver = new WarpObserver(
      {
        getAlarms: () => this.alarms,
        getObservedUT: () => this.observedUT,
        isWarpToActive: () => this.warp.isActive(),
      },
      this.opts.nowMs,
    );

    this.warp = new WarpControl(
      this.warpPlanner,
      {
        getObservedIndex: () => this.warpObserver.getWarp().index,
        getRateTable: () => this.warpObserver.getRateTable(),
        registerOwnWarpIntent: () => this.warpObserver.registerIntent(),
        getOwltSeconds: () => this.opts.getOwltSeconds(),
      },
      this.opts.nowMs,
      initialMargin,
    );

    this.peerBridge = new AlarmPeerBridge(host, {
      addAlarm: (input) => {
        this.addAlarm(input);
      },
      updateAlarm: (id, patch) => this.updateAlarm(id, patch),
      deleteAlarm: (id) => this.deleteAlarm(id),
      acknowledgeAlarm: (id) => this.acknowledgeAlarm(id),
      acknowledgeUnscheduledWarp: () => this.acknowledgeUnscheduledWarp(),
      registerStationWarpIntent: () => this.registerStationWarpIntent(),
      getSnapshot: () => this.snapshot(),
    });

    /* AFTER the list is loaded, and that ordering is load-bearing: binding
       subscribes to the fire notice, and `TelemetryClient.subscribe` replays
       the sticky last value SYNCHRONOUSLY. Built first, the replayed notice for
       an alarm that fired while this client was away would arrive before the
       alarm it names had been read out of storage, and be dropped. */
    this.loadAlarms();
    this.scetBridge = new ScetAlarmBridge({
      getAlarms: () => this.alarms,
      onFired: (id, firedAtUt, actionsWithheld) =>
        this.onScetFired(id, firedAtUt, actionsWithheld),
      onShadowFired: (id, firedAtUt, vantage) =>
        this.onShadowFired(id, firedAtUt, vantage),
      onArmRefused: (id, reason) => {
        if (this.scetArmRefusals.get(id) === reason) return;
        this.scetArmRefusals.set(id, reason);
        this.emit();
      },
      onArmAccepted: (id) => {
        if (this.scetArmRefusals.delete(id)) this.emit();
      },
      nowMs: () => this.opts.nowMs(),
    });
    /* Bound only once assigned: a replayed fire notice ticks the host, and the
       tick asks the bridge what the mod holds. */
    this.scetBridge.start();
    this.start();
  }

  // ── Public API ────────────────────────────────────────────────────────

  snapshot(): AlarmSnapshot {
    return {
      alarms: [...this.alarms],
      ut: this.observedUT,
      warp: this.warpObserver.getWarp(),
      unscheduledWarp: this.warpObserver.getUnscheduled(),
      warpTo: this.warp.snapshot(),
      warpSafetyMarginSeconds: this.warp.getMarginSeconds(),
      owltSeconds: this.warp.getOverridingOwltSeconds(),
      scetArmRefusals:
        this.scetArmRefusals.size > 0
          ? Object.fromEntries(this.scetArmRefusals)
          : undefined,
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

  /**
   * Create an alarm and own it.
   *
   * `requestedBy` marks one an Uplink asked for, and makes the call idempotent
   * for that Uplink: `(uplinkId, key)` identifies one alarm, so a repeat
   * request RETARGETS the existing row rather than adding a second. Without
   * that a widget whose button fires the request twice, or one re-issuing it
   * after a reconnect, would grow the operator a pile of near-identical rows
   * they never asked for and would have to delete one at a time.
   *
   * The retarget keeps the alarm's id, so anything already holding it (a warp-to
   * session, a SCET arm on the mod) follows the change instead of being orphaned
   * by a delete-and-recreate.
   */
  addAlarm(input: {
    name: string;
    notes?: string;
    trigger: AlarmTrigger;
    createdBy?: string;
    requestedBy?: import("./types").AlarmRequestedBy;
    onFire?: import("./types").AlarmFireAction[];
  }): Alarm {
    const existing = input.requestedBy
      ? this.findRequested(input.requestedBy)
      : undefined;
    if (existing) {
      // `onFire` is deliberately not in the patch. A request carries no side
      // effects, so anything attached to this row was attached by the operator,
      // and a retarget moves the condition without discarding their work.
      this.updateAlarm(existing.id, {
        name: input.name,
        notes: input.notes,
        trigger: input.trigger,
      });
      return this.alarms.find((a) => a.id === existing.id) ?? existing;
    }
    const alarm: Alarm = {
      id: generateId(),
      name: input.name.trim() || "Alarm",
      notes: input.notes?.trim() || undefined,
      trigger: input.trigger,
      // Always start "pending": the next tick() transitions to arming /
      // firing with the usual side effects, so the state machine stays
      // driven from a single place.
      state: "pending",
      createdBy: input.createdBy ?? "main",
      requestedBy: input.requestedBy,
      createdAt: this.opts.nowMs(),
      matchSinceUT: requiresMatchTracking(input.trigger) ? null : undefined,
      onFire:
        input.onFire && input.onFire.length > 0 ? input.onFire : undefined,
    };
    this.alarms.push(alarm);
    this.persist();
    // Before the tick, which may fire it at once: an alarm whose condition
    // already holds is owed an arm like any other.
    this.scetBridge.owe(alarm);
    this.tick();
    return alarm;
  }

  /**
   * The alarm this Uplink already has under this key, if any. The key is scoped
   * to the Uplink, so two Uplinks may both call theirs `"burn"` without one
   * retargeting the other's row.
   */
  private findRequested(
    requestedBy: import("./types").AlarmRequestedBy,
  ): Alarm | undefined {
    return this.alarms.find(
      (a) =>
        a.requestedBy?.uplinkId === requestedBy.uplinkId &&
        a.requestedBy?.key === requestedBy.key,
    );
  }

  updateAlarm(
    id: string,
    patch: Partial<Pick<Alarm, "name" | "notes" | "trigger" | "onFire">>,
  ): void {
    const idx = this.alarms.findIndex((a) => a.id === id);
    if (idx < 0) return;
    const prev = this.alarms[idx];
    const next: Alarm = {
      ...prev,
      ...(patch.name !== undefined
        ? { name: patch.name.trim() || prev.name }
        : {}),
      ...(patch.notes !== undefined
        ? { notes: patch.notes.trim() || undefined }
        : {}),
      ...(patch.trigger !== undefined ? { trigger: patch.trigger } : {}),
      // Empty array is the explicit "clear" sentinel, same convention as
      // addAlarm, which normalises [] to undefined so an alarm without
      // side effects always stores `onFire: undefined`.
      ...(patch.onFire !== undefined
        ? { onFire: patch.onFire.length > 0 ? patch.onFire : undefined }
        : {}),
    };
    const reset = patch.trigger && patch.trigger.kind !== prev.trigger.kind;
    if (reset) {
      next.matchSinceUT = requiresMatchTracking(next.trigger)
        ? null
        : undefined;
      // The latched occurrence belonged to the trigger being replaced.
      next.eventUT = undefined;
      next.state = "pending";
    }
    if (patch.trigger) {
      this.stateMachine.forget(id);
      this.warpPlanner.forget(id);
    }
    if (reset) next.actionsWithheld = undefined;
    this.alarms[idx] = next;
    if (!reset) {
      this.commitState(next, this.stateMachine.deriveState(next), true);
    }
    if (patch.trigger) {
      // A refusal, and a mod verdict, describe the condition that was replaced.
      this.scetArmRefusals.delete(id);
      this.shadowVerdicts.delete(id);
    }
    /* Owed an arm whatever state the edit left it in, since the mod already
       holds this id: the diff against its roster sees it as armed, and the
       simulation would go on with the condition, or the onboard actions, that
       were replaced. An alarm that had already fired before the edit is not
       live any more and is left alone. */
    if ((patch.trigger || patch.onFire) && (reset || !hasFired(prev.state))) {
      this.scetBridge.owe(next);
      this.scetBridge.reconcile();
    }
    this.persist();
    this.emit();
  }

  deleteAlarm(id: string): void {
    const before = this.alarms.length;
    this.alarms = this.alarms.filter((a) => a.id !== id);
    if (this.alarms.length !== before) {
      this.forgetAlarm(id);
      this.persist();
      this.emit();
    }
  }

  acknowledgeUnscheduledWarp(): void {
    if (this.warpObserver.acknowledgeUnscheduled()) this.emit();
  }

  /**
   * Dismiss a fired alarm. Threshold and time alarms both stay in the
   * `fired` state until the user (or a peer) acks, the original "auto
   * purge after 5s" behaviour silently swallowed alarms before the
   * operator noticed them.
   */
  acknowledgeAlarm(id: string): void {
    const idx = this.alarms.findIndex((a) => a.id === id);
    if (idx < 0) return;
    if (this.alarms[idx].state !== "fired") return;
    this.alarms.splice(idx, 1);
    this.forgetAlarm(id);
    this.persist();
    this.emit();
  }

  /** Everything held per alarm id, dropped when the alarm itself goes. */
  private forgetAlarm(id: string): void {
    this.unevaluated.delete(id);
    this.stateMachine.forget(id);
    this.warpPlanner.forget(id);
    this.scetArmRefusals.delete(id);
    this.shadowVerdicts.delete(id);
  }

  /**
   * "A screen on this service meant the warp it is about to command."
   *
   * Suppresses this observer's unscheduled-warp alert for the next couple of
   * seconds and nothing else. Every other screen keeps its own observer, so a
   * pilot announcing here does not quiet the command centre's banner, which is
   * the point: the ground would not otherwise know a pilot was warping.
   */
  announceWarpIntent(): void {
    this.warpObserver.registerIntent();
  }

  /** The peer-mesh entry point for the same announcement. */
  registerStationWarpIntent(): void {
    this.announceWarpIntent();
  }

  /**
   * Begin a "warp to next alarm" session. The controller targets the
   * closest pending alarm: time alarms by their UT, threshold alarms by
   * a least-squares slope projected to the threshold value, and
   * re-targets each tick.
   */
  beginWarpTo(): void {
    if (!this.warp.begin()) return;
    this.tick();
  }

  cancelWarpTo(): void {
    if (this.warp.cancel()) this.emit();
  }

  setWarpSafetyMargin(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    const clamped = Math.max(
      MIN_WARP_SAFETY_MARGIN_SECONDS,
      Math.min(MAX_WARP_SAFETY_MARGIN_SECONDS, seconds),
    );
    if (clamped === this.warp.getMarginSeconds()) return;
    this.warp.setMarginSeconds(clamped);
    this.persistWarpMargin();
    this.emit();
  }

  dispose(): void {
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
    this.scetBridge.dispose();
  }

  /**
   * The mod fired a SCET alarm and has already stopped the warp.
   *
   * Latches the alarm the way a revealed occurrence latches an `event` one, and
   * records the instant the mod reported on `eventUT`, which is that field's
   * whole purpose: the UT the thing HAPPENED on the craft's clock, as opposed
   * to the reveal UT that opened the banner window.
   *
   * Idempotent, because the notice is deliberately replayed to a client that
   * reconnects after the fire: an alarm that is not still pending has already
   * been told.
   */
  private onScetFired(
    id: string,
    firedAtUt: number,
    actionsWithheld: boolean,
  ): void {
    const alarm = this.alarms.find((a) => a.id === id);
    if (!alarm || !modOwnsLatch(alarm.trigger)) return;
    if (alarm.state !== "pending" || alarm.matchSinceUT != null) return;
    if (actionsWithheld) alarm.actionsWithheld = true;
    // The reveal UT, which is this client's own now: the banner window runs on
    // the clock the operator is watching, while the instant it NAMES is the
    // craft's. Read live rather than off `observedUT`, which is as of the last
    // tick and would put the latch up to a tick in the past. Falling back to
    // the mod's instant only matters before any frame has anchored the view
    // clock, and an alarm cannot be armed before then.
    alarm.matchSinceUT = getViewUt() ?? this.observedUT ?? firedAtUt;
    alarm.eventUT = firedAtUt;
    // Any warp-to session is over: the thing it was warping towards has
    // happened and the game is already at zero. Left running it would keep
    // reporting a target for the whole light-time it takes the stop to show up
    // in `time.warp`.
    this.warp.endOnExternalStop();
    this.persist();
    /* Straight to a tick so the transition to `firing` is this moment rather
       than up to a second away: the whole argument for the notice being
       TrueNow is that the operator learns WITH the stop. No warp command on
       the way through, here or in the tick that follows: the mod already
       stopped it, and a second authority for one piece of state is a race. */
    this.tick();
  }

  /**
   * The simulation's verdict on a COMMAND-VANTAGE alarm, judged against what
   * `vantage` has been told. Recorded and compared, never acted on.
   *
   * <p>Mutating anything from here is the hazard
   * `AlarmStateMachine.updateThresholdTracking` documents: the latch the mod
   * would set is the same field this side's own tracking writes, so the two
   * would clear each other's. Until there is evidence the two agree, the
   * client's answer is the only one that counts for an alarm on the client's
   * clock.</p>
   */
  private onShadowFired(id: string, firedAtUt: number, vantage: string): void {
    this.shadowVerdicts.set(id, { firedAtUt, vantage });
    const alarm = this.alarms.find((a) => a.id === id);
    if (!alarm) {
      logger.warn(
        "alarm-shadow: mod fired an alarm this client does not hold",
        {
          id,
          vantage,
          firedAtUt,
          warpRate: this.warpObserver.rateBefore(firedAtUt),
        },
      );
      return;
    }
    if (alarm.state === "pending") {
      logger.warn("alarm-shadow: mod fired first, client still pending", {
        id,
        vantage,
        firedAtUt,
        clientUt: this.observedUT,
        warpRate: this.warpObserver.rateBefore(firedAtUt),
      });
      return;
    }
    logger.info("alarm-shadow: mod agrees, client had already fired", {
      id,
      vantage,
      firedAtUt,
      clientEventUt: alarm.eventUT ?? null,
      warpRate: this.warpObserver.rateBefore(firedAtUt),
    });
  }

  /**
   * The other direction: this client has just fired a command-vantage alarm,
   * so say whether the simulation had reached the same verdict. Silence from
   * the mod is the divergence worth seeing, and it can only be noticed from
   * here.
   */
  private compareShadowAtClientFire(alarm: Alarm): void {
    if (modOwnsLatch(alarm.trigger)) return;
    const verdict = this.shadowVerdicts.get(alarm.id);
    if (!verdict) {
      logger.warn("alarm-shadow: client fired, mod has not", {
        id: alarm.id,
        clientUt: this.observedUT,
        warpRate: this.clientFireWarpRate(),
      });
      return;
    }
    logger.info("alarm-shadow: client fired, mod had already agreed", {
      id: alarm.id,
      vantage: verdict.vantage,
      modFiredAtUt: verdict.firedAtUt,
      clientUt: this.observedUT,
      warpRate: this.clientFireWarpRate(),
    });
  }

  /**
   * The rate the game reported in force as this client's fire came due, for
   * the shadow record: the reading from before the fire's own tick, `null`
   * when there is none.
   */
  private clientFireWarpRate(): number | null {
    return this.observedUT === null
      ? null
      : this.warpObserver.rateBefore(this.observedUT);
  }

  // ── Tick loop ─────────────────────────────────────────────────────────

  private start(): void {
    if (this.tickHandle !== null) return;
    this.tickHandle = setInterval(() => this.tick(), this.opts.tickIntervalMs);
    this.tick();
  }

  private tick(): void {
    // Not a data-source key: `t.universalTime` was DROPPED, this is the
    // SDK's own view time, read via the non-hook `getViewUt` accessor rather
    // than the legacy telemetry reader.
    const ut = getViewUt() ?? null;
    this.observedUT = ut ?? this.observedUT;
    this.warpObserver.observeWarp();

    if (ut !== null) {
      let changed = false;
      for (const alarm of this.alarms) {
        /* Don't reorder these three. Match tracking writes the latch, the
           warp-to sample reads that latch plus last-tick's `alarm.state` to
           decide whether to keep the rolling buffer, and `deriveState` below
           commits the new state the sample must not have seen yet. */
        if (alarm.trigger.kind === "threshold") {
          if (
            this.stateMachine.updateThresholdTracking(
              alarm,
              ut,
              this.lastTickUt,
            )
          ) {
            changed = true;
          }
          this.warpPlanner.recordThresholdSample(alarm, ut);
        }
        // Contract-parameter tracking has the same shape (matchSinceUT
        // + sustain) but no rolling sample buffer, the underlying
        // condition is a discrete state-string match, not a numeric
        // approach.
        if (alarm.trigger.kind === "contract-parameter") {
          if (
            this.stateMachine.updateContractParameterTracking(
              alarm,
              ut,
              this.lastTickUt,
            )
          ) {
            changed = true;
          }
        }
        // Event triggers latch on the first matching occurrence revealed
        // after the alarm began watching: edge-triggered, no sustain.
        if (alarm.trigger.kind === "event") {
          if (this.stateMachine.updateEventTracking(alarm, ut)) {
            changed = true;
          }
        }

        const late = this.unevaluated.delete(alarm.id);
        if (
          this.commitState(
            alarm,
            this.stateMachine.deriveState(alarm, ut),
            late,
          )
        ) {
          changed = true;
        }
      }
      if (changed) this.persist();
      /* AFTER the loop, so every alarm this tick measures the unobserved gap
         against the same previous clock rather than one that depends on
         iteration order. */
      this.lastTickUt = ut;
    }

    this.warp.reconcile(this.observedUT);
    this.warpObserver.detectUnscheduled();
    // Every tick, not only on an edit: the mod's roster is what this reconciles
    // against, and it moves for reasons this side never hears about (a
    // quickload clears it, a fire retires a row).
    this.scetBridge.reconcile();
    this.emit();
  }

  /**
   * Move an alarm to `nextState` and pay whatever the move owes. Returns
   * whether the state changed.
   *
   * A fire is a fact, and every route into it owes the operator the same
   * notice. The tick, an edit, and the first evaluation after a reload all
   * arrive here, and the fire is keyed on entering `firing` OR `fired` from a
   * state that had not fired, so no route can leave an alarm fired without the
   * operator having been told.
   *
   * `late` marks a fire discovered rather than watched: on an edit, or on an
   * alarm's first evaluation after a reload. The notice still goes out, and the
   * `onFire` actions do not: dispatched now, they would act on a condition met
   * arbitrarily long ago, and the row records that they were withheld.
   */
  private commitState(
    alarm: Alarm,
    nextState: Alarm["state"],
    late = false,
  ): boolean {
    if (nextState === alarm.state) return false;
    if (!hasFired(nextState)) alarm.actionsWithheld = undefined;
    /* TWO stop sites, and they take the same rule. The mod sets its own stop
       at BOTH instants (the step-down at `ut - lead`, and the fire), so an
       alarm it holds must not be commanded from here at either: that is the
       round trip the arm exists to remove. An alarm it does not hold keeps
       both, or it would come due and halt nothing. */
    const modStops = this.scetBridge.holdsAlarm(alarm.id);
    if (alarm.state !== "arming" && nextState === "arming" && !modStops) {
      this.warp.stepWarpDown();
    }
    if (!hasFired(alarm.state) && hasFired(nextState)) {
      const withhold = late && (alarm.onFire?.length ?? 0) > 0;
      if (withhold) alarm.actionsWithheld = true;
      this.notifyFire(alarm, !withhold);
      this.compareShadowAtClientFire(alarm);
      // Again at the fire: the warp may have recovered since `arming`, and most alarms have no `arming` phase at all.
      if (!modStops) this.warp.stepWarpDown();
    }
    alarm.state = nextState;
    return true;
  }

  // ── Listeners + persistence ──────────────────────────────────────────

  private emit(): void {
    const snap = this.snapshot();
    for (const cb of this.snapshotListeners) cb(snap);
    this.peerBridge.broadcastSnapshot(snap);
  }

  private notifyFire(alarm: Alarm, runActions: boolean): void {
    for (const cb of this.fireListeners) cb(alarm);
    this.peerBridge.broadcastFire(alarm, this.observedUT);
    // Actions the mod holds ran aboard in the fire's own frame, or were withheld there, and sending them from here too would act on the craft a second time a light-time later.
    if (
      runActions &&
      !this.scetBridge.actsAboard(alarm.id) &&
      alarm.onFire &&
      alarm.onFire.length > 0
    ) {
      void this.dispatchOnFire(alarm);
    }
  }

  private async dispatchOnFire(alarm: Alarm): Promise<void> {
    if (!alarm.onFire) return;
    for (const fx of alarm.onFire) {
      switch (fx.kind) {
        case "action-group": {
          const outcome = dispatchActionGroup(fx.action);
          if (outcome.routed) {
            try {
              await outcome.settled;
            } catch {
              // Swallow individual action failures so one missing action
              // group (e.g. `f.ag5` not bound on this vessel) doesn't
              // block the rest of the list. The visible alarm fire still
              // shows up regardless.
            }
          }
          break;
        }
      }
    }
  }

  private loadAlarms(): void {
    const stored = this.alarmStore.get();
    if (Array.isArray(stored) && stored.length > 0) {
      this.alarms = stored
        .map(migrateAlarm)
        .filter((a): a is Alarm => a !== null);
      this.unevaluated = new Set(this.alarms.map((a) => a.id));
    }
  }

  private loadMargin(): number {
    const rawMargin = this.storage.getItem(WARP_MARGIN_STORAGE_KEY);
    if (rawMargin === null) return DEFAULT_WARP_SAFETY_MARGIN_SECONDS;
    const parsed = Number.parseFloat(rawMargin);
    if (!Number.isFinite(parsed)) return DEFAULT_WARP_SAFETY_MARGIN_SECONDS;
    return Math.max(
      MIN_WARP_SAFETY_MARGIN_SECONDS,
      Math.min(MAX_WARP_SAFETY_MARGIN_SECONDS, parsed),
    );
  }

  private persist(): void {
    this.alarmStore.set(this.alarms);
  }

  private persistWarpMargin(): void {
    this.storage.setItem(
      WARP_MARGIN_STORAGE_KEY,
      String(this.warp.getMarginSeconds()),
    );
  }
}

/**
 * Convenience factory. Historically wrapped a live `BufferedDataSource`
 * lookup so the host could be constructed at MainScreen-mount time even
 * before the legacy `"data"` source was registered, now that every
 * telemetry read/command dispatch inside `AlarmHostService` rides the
 * stream (`getWarpState`/`getContractsActive`/`getValue`/
 * `dispatchActiveCommand`), there's nothing left to wrap; kept as a thin
 * pass-through so call sites (and `createManeuverTriggerHost`'s identical
 * shape) don't need to change.
 */
export function createAlarmHost(
  host: PeerHostService | null,
  opts?: AlarmHostOptions,
): AlarmHostService {
  return new AlarmHostService(host, opts);
}

function hasFired(state: Alarm["state"]): boolean {
  return state === "firing" || state === "fired";
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return safeRandomUuid();
  }
  return `alarm_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}
