import { logger } from "@ksp-gonogo/logger";
import {
  dispatchActiveCommandTopic,
  getActiveTelemetryClient,
  subscribeActiveTelemetryClient,
} from "@ksp-gonogo/sitrep-client";
import { type Alarm, isScetTrigger } from "./types";

export const SCET_ROSTER_TOPIC = "alarm.scet";
export const SCET_FIRED_TOPIC = "alarm.scet.fired";
export const SCET_ARM_COMMAND = "alarm.scet.arm";
export const SCET_DISARM_COMMAND = "alarm.scet.disarm";

/** One row of the mod's `alarm.scet` roster, as much of it as this side reads. */
interface RosterRow {
  id?: unknown;
}

/** The `alarm.scet.fired` payload: an id and an instant, and deliberately nothing else. */
interface FiredNotice {
  id?: unknown;
  firedAtUt?: unknown;
}

export interface ScetAlarmBridgeContext {
  /** The host's current alarm list, read live so the bridge never holds a stale copy. */
  getAlarms(): readonly Alarm[];
  /**
   * A SCET alarm fired on the mod at `firedAtUt` (the craft's clock) and the
   * warp is already stopped. Must be idempotent: the notice is replayed to a
   * reconnecting client on purpose.
   */
  onFired(id: string, firedAtUt: number): void;
}

/**
 * The client half of the SCET alarm arm: arms and disarms over the stream, and
 * turns the mod's fire notice into a local alarm transition.
 *
 * ## Why this reads raw frames rather than `useTelemetry`
 *
 * The notice is `DelayRole.TrueNow` on the mod, so it reaches the wire on the
 * tick it was captured rather than a light-time later. That buys a client
 * nothing through the ordinary read path: `TimelineStore.sample` reads every
 * topic at the frame's frozen view time, and view time trails true time by the
 * whole one-way delay whatever a channel's role is
 * (`warp-delay.characterise.test.ts` pins exactly that, on both wire shapes).
 * A notice read that way would arrive one light-time after the warp stopped,
 * which is the failure the TrueNow classification exists to prevent.
 *
 * `TelemetryClient.subscribe` delivers on ARRIVAL instead, with no view clock in
 * the way, which is the right shape for a one-shot event anyway. So this arm
 * does not depend on the delay-role read gap being closed, and closing it later
 * changes nothing here.
 *
 * ## Reconciliation, not a handshake
 *
 * The client stays the authority: alarms live in its own localStorage list and
 * only the SCET-armed subset crosses. On every roster frame the bridge arms
 * what the mod does not hold and disarms what it holds that no pending SCET
 * alarm of ours accounts for. That is the only shape that survives a
 * disconnect without leaving arms in the mod that nothing remembers making,
 * and it is self-healing: after a quickload the mod publishes an empty roster
 * and the next reconcile re-arms everything.
 */
export class ScetAlarmBridge {
  private readonly ctx: ScetAlarmBridgeContext;
  private unsubscribeClient: (() => void) | null = null;
  private unsubscribeRoster: (() => void) | null = null;
  private unsubscribeFired: (() => void) | null = null;
  /** The ids the mod last said it held. Empty before any roster frame has arrived. */
  private rosterIds: readonly string[] = [];
  private rosterSeen = false;
  /**
   * Ids already commanded since the last roster frame, so a reconcile running
   * between frames does not re-send what is already in flight.
   *
   * Cleared on every roster frame rather than on the dispatch's own promise,
   * which makes the retry exactly one per frame: an arm the mod did receive is
   * on the next roster and drops out of the wanted diff, and one it did not is
   * re-sent once. A promise-keyed guard would instead retry forever on a
   * command that resolved but changed nothing.
   */
  private commandedSinceRoster = new Set<string>();
  private disposed = false;

  constructor(ctx: ScetAlarmBridgeContext) {
    this.ctx = ctx;
    this.unsubscribeClient = subscribeActiveTelemetryClient(() => this.bind());
    this.bind();
  }

  /**
   * Push the mod's roster towards the client's list.
   *
   * Called on every roster frame and after any change to the alarm list. Does
   * nothing until a roster frame has arrived: before that the mod's holdings
   * are unknown, and arming against an unknown roster would re-send every alarm
   * on every tick.
   */
  reconcile(): void {
    if (this.disposed || !this.rosterSeen) return;

    const wanted = new Map<string, Alarm>();
    for (const alarm of this.ctx.getAlarms()) {
      // Only a PENDING SCET alarm wants arming. One that already fired must not
      // be re-armed after a timeline reset dropped the roster: its instant is in
      // the past, so it would fire again immediately.
      if (isScetTrigger(alarm.trigger) && alarm.state === "pending") {
        wanted.set(alarm.id, alarm);
      }
    }

    for (const id of this.rosterIds) {
      if (!wanted.has(id) && !this.commandedSinceRoster.has(id)) {
        this.commandedSinceRoster.add(id);
        this.disarm(id);
      }
    }
    const held = new Set(this.rosterIds);
    for (const [id, alarm] of wanted) {
      if (!held.has(id) && !this.commandedSinceRoster.has(id)) {
        this.commandedSinceRoster.add(id);
        this.arm(alarm);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribeClient?.();
    this.unsubscribeClient = null;
    this.unbindTopics();
  }

  /**
   * Arm one alarm on the mod. Also used on an edit: arming an id the mod
   * already holds replaces it, so there is no disarm-then-arm to race.
   */
  arm(alarm: Alarm): void {
    if (alarm.trigger.kind !== "time" || !isScetTrigger(alarm.trigger)) return;
    const outcome = dispatchActiveCommandTopic(SCET_ARM_COMMAND, {
      id: alarm.id,
      name: alarm.name,
      // A time condition is about the game's own clock, so it names no craft.
      subject: "game",
      condition: {
        kind: 0,
        ut: alarm.trigger.ut,
        leadSeconds: alarm.trigger.leadSeconds,
      },
    });
    if (!outcome.routed) {
      logger.warn("alarm-host: SCET arm not routed", { id: alarm.id });
      return;
    }
    void outcome.settled;
  }

  /** Disarm one alarm on the mod. Harmless for an id it does not hold. */
  disarm(id: string): void {
    const outcome = dispatchActiveCommandTopic(SCET_DISARM_COMMAND, { id });
    if (!outcome.routed) {
      logger.warn("alarm-host: SCET disarm not routed", { id });
      return;
    }
    void outcome.settled;
  }

  /**
   * Point the topic subscriptions at whichever `TelemetryProvider` is mounted
   * now. The roster is forgotten across the swap: a new connection's roster is
   * a fact about the mod behind it, not about the one that went away.
   */
  private bind(): void {
    if (this.disposed) return;
    this.unbindTopics();
    const client = getActiveTelemetryClient();
    if (!client) return;
    this.unsubscribeRoster = client.subscribe(SCET_ROSTER_TOPIC, (payload) => {
      this.rosterIds = readRosterIds(payload);
      this.rosterSeen = true;
      this.commandedSinceRoster.clear();
      this.reconcile();
    });
    this.unsubscribeFired = client.subscribe(SCET_FIRED_TOPIC, (payload) => {
      const notice = payload as FiredNotice | undefined;
      if (!notice || typeof notice.id !== "string") return;
      const firedAtUt =
        typeof notice.firedAtUt === "number" && Number.isFinite(notice.firedAtUt)
          ? notice.firedAtUt
          : null;
      if (firedAtUt === null) return;
      this.ctx.onFired(notice.id, firedAtUt);
    });
  }

  private unbindTopics(): void {
    this.unsubscribeRoster?.();
    this.unsubscribeRoster = null;
    this.unsubscribeFired?.();
    this.unsubscribeFired = null;
    this.rosterIds = [];
    this.rosterSeen = false;
    this.commandedSinceRoster.clear();
  }
}

/**
 * The ids on a roster frame. Only the ids: everything else on a row is for a
 * readout, and this side's job is deciding what to arm and what to drop.
 */
function readRosterIds(payload: unknown): readonly string[] {
  if (!Array.isArray(payload)) return [];
  const ids: string[] = [];
  for (const row of payload as RosterRow[]) {
    if (row && typeof row.id === "string" && row.id !== "") ids.push(row.id);
  }
  return ids;
}
