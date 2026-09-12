import { logger } from "@ksp-gonogo/logger";
import {
  dispatchActiveCommandTopic,
  getActiveTelemetryClient,
  getVesselIdentity,
  subscribeActiveTelemetryClient,
} from "@ksp-gonogo/sitrep-client";
import {
  ScetAlarmConditionKind,
  ScetAlarmThresholdOp,
} from "@ksp-gonogo/sitrep-sdk";
import {
  type Alarm,
  isScetTrigger,
  scetThresholdAddress,
  type ThresholdOp,
} from "./types";

export const SCET_ROSTER_TOPIC = "alarm.scet";
export const SCET_FIRED_TOPIC = "alarm.scet.fired";
export const SCET_ARM_COMMAND = "alarm.scet.arm";
export const SCET_DISARM_COMMAND = "alarm.scet.disarm";

/**
 * The operator's comparison word as the contract's own member.
 *
 * The two lists are deliberately the same six, so an alarm armed on the command
 * vantage and the same alarm armed on the craft's clock mean the same thing and
 * can be checked against each other at zero delay. This is the one place they
 * have to meet.
 */
const THRESHOLD_OP_MEMBER: Readonly<Record<ThresholdOp, ScetAlarmThresholdOp>> =
  {
    ">": ScetAlarmThresholdOp.GreaterThan,
    ">=": ScetAlarmThresholdOp.GreaterThanOrEqual,
    "<": ScetAlarmThresholdOp.LessThan,
    "<=": ScetAlarmThresholdOp.LessThanOrEqual,
    "==": ScetAlarmThresholdOp.Equal,
    "!=": ScetAlarmThresholdOp.NotEqual,
  };

export interface ScetAlarmBridgeContext {
  /** The host's current alarm list, read live so the bridge never holds a stale copy. */
  getAlarms(): readonly Alarm[];
  /**
   * A SCET alarm fired on the mod at `firedAtUt` (the craft's clock) and the
   * warp is already stopped. Must be idempotent: the notice is replayed to a
   * reconnecting client on purpose.
   */
  onFired(id: string, firedAtUt: number): void;
  /**
   * The simulation refused to arm this alarm, and said why in its own words.
   *
   * The refusal is the only way a client learns that a Topic is not addressable
   * there: the table of what a threshold can be read from lives in the mod and
   * is not published anywhere the picker could consult first. Carrying the
   * message rather than a flag is deliberate: it names the Topic, and the
   * operator picked the Topic.
   */
  onArmRefused(id: string, reason: string): void;
  /** The arm went through, so any refusal recorded against this id is stale. */
  onArmAccepted(id: string): void;
}

/**
 * The client half of the SCET alarm arm: arms and disarms over the stream, and
 * turns the mod's fire notice into a local alarm transition.
 *
 * ## Why this reads raw frames rather than `useTelemetry`
 *
 * The notice is `DelayRole.TrueNow` on the mod, so it reaches the wire on the
 * tick it was captured rather than a light-time later. That used to buy a
 * client nothing through the ordinary read path, because `TimelineStore.sample`
 * read every topic at the delayed view time whatever its role was, and a notice
 * read that way arrived one light-time after the warp stopped, which is the
 * failure the TrueNow classification exists to prevent.
 *
 * The store honours the role now (`warp-delay.characterise.test.ts` measures
 * what it buys), so the ordinary path would work. This still reads raw frames,
 * because `TelemetryClient.subscribe` delivers on ARRIVAL with no view clock in
 * the way, which is the right shape for a one-shot event: a fire notice is an
 * edge, and a view-time read of an edge can only ever miss one that fell
 * between two frames.
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
    if (!isScetTrigger(alarm.trigger)) return;
    const armed = this.buildArmArgs(alarm);
    if (armed === null) return;
    const outcome = dispatchActiveCommandTopic(SCET_ARM_COMMAND, armed);
    if (!outcome.routed) {
      logger.warn("alarm-host: SCET arm not routed", { id: alarm.id });
      return;
    }
    void outcome.settled.then((refusal) => {
      if (this.disposed) return;
      if (refusal === undefined) {
        this.ctx.onArmAccepted(alarm.id);
        return;
      }
      /* The mod is the authority on what it can read, and this is the first
         moment this side could have known. Reported with the mod's own words
         rather than a sentence of ours: the message names the Topic the
         operator chose, and a paraphrase would have to keep a second copy of a
         table we deliberately do not hold. */
      logger.warn("alarm-host: SCET arm refused", {
        id: alarm.id,
        code: refusal.code,
        reason: refusal.message,
      });
      this.ctx.onArmRefused(alarm.id, refusal.message);
    });
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
   * The `alarm.scet.arm` arguments for one alarm, or null when this side cannot
   * state the condition honestly.
   *
   * Null is only ever reached by a threshold, and only for the two things the
   * mod would have no way to interpret: a key with no Topic behind it (one from
   * a live `DataSource` rather than from the contract's field catalogue), and a
   * craft-scoped Topic at a moment when no vessel identity has arrived. Both
   * are refusals to GUESS: an arm carrying the wrong subject is accepted and
   * then never fires, which is the one outcome an alarm must not have.
   */
  private buildArmArgs(alarm: Alarm): Record<string, unknown> | null {
    const trigger = alarm.trigger;
    if (trigger.kind === "time") {
      return {
        id: alarm.id,
        name: alarm.name,
        // A time condition is about the game's own clock, so it names no craft.
        subject: "game",
        condition: {
          kind: ScetAlarmConditionKind.Time,
          ut: trigger.ut,
          leadSeconds: trigger.leadSeconds,
        },
      };
    }
    const address = scetThresholdAddress(trigger);
    if (address === null || trigger.kind !== "threshold") {
      logger.warn("alarm-host: SCET threshold has no Topic to read", {
        id: alarm.id,
      });
      return null;
    }
    const subject = subjectFor(address.topic);
    if (subject === null) {
      logger.warn("alarm-host: SCET threshold has no subject yet", {
        id: alarm.id,
        topic: address.topic,
      });
      return null;
    }
    return {
      id: alarm.id,
      name: alarm.name,
      subject,
      condition: {
        kind: ScetAlarmConditionKind.Threshold,
        topic: address.topic,
        fieldPath: address.fieldPath,
        op: THRESHOLD_OP_MEMBER[trigger.op],
        threshold: trigger.value,
        sustainSeconds: trigger.sustainSeconds,
      },
    };
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
      const notice = readFiredNotice(payload);
      if (notice) this.ctx.onFired(notice.id, notice.firedAtUt);
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
 * What a threshold on `topic` is ABOUT, in the vocabulary `meta.source` uses:
 * `"vessel:<guid>"` for a craft, `"game"` for the simulation as a whole. Null
 * when it is about a craft and no identity has arrived to name one.
 *
 * Decided from the Topic's own namespace rather than from a list of which
 * Topics are craft-scoped. A list would be a second copy of something the mod
 * already knows, and the namespace is not a proxy for the answer: a Topic under
 * `vessel.` is a reading OF a vessel, which is exactly what the stamp records.
 * The guid is the one the contract points at for this. `VesselIdentity
 * .vesselId` is documented as the currency of the `"vessel:<guid>"` stamp.
 *
 * The identity read is a light-time old, and that is right rather than a
 * compromise: the craft the operator is looking at is the craft they mean.
 */
function subjectFor(topic: string): string | null {
  if (!topic.startsWith("vessel.")) return "game";
  const vesselId = getVesselIdentity()?.vesselId;
  return vesselId ? `vessel:${vesselId}` : null;
}

/**
 * The ids on a roster frame. Only the ids: everything else on a row is for a
 * readout, and this side's job is deciding what to arm and what to drop.
 */
function readRosterIds(payload: unknown): readonly string[] {
  if (!Array.isArray(payload)) return [];
  const ids: string[] = [];
  for (const row of payload) {
    const id = readId(row);
    if (id !== null) ids.push(id);
  }
  return ids;
}

/**
 * The `alarm.scet.fired` payload as this side needs it, or null for anything
 * that is not one.
 *
 * Checked field by field rather than asserted into a shape. The two fields ARE
 * the whole channel, so there is nothing an assertion would buy that a check
 * does not, and what arrives here is raw wire rather than anything this code
 * constructed.
 *
 * Both shapes of the instant are accepted. `firedAtUt` is declared as a
 * universal time on the contract, so the unit wrap applied in
 * `parseServerMessage` delivers it as a `Value`; a topic outside the wrap's
 * keying would deliver the bare number, and a reader of raw frames has to take
 * either.
 */
function readFiredNotice(
  payload: unknown,
): { id: string; firedAtUt: number } | null {
  const id = readId(payload);
  if (id === null) return null;
  if (typeof payload !== "object" || payload === null) return null;
  if (!("firedAtUt" in payload)) return null;
  const raw = payload.firedAtUt;
  const magnitude =
    typeof raw === "object" && raw !== null && "magnitude" in raw
      ? raw.magnitude
      : raw;
  if (typeof magnitude !== "number" || !Number.isFinite(magnitude)) return null;
  return { id, firedAtUt: magnitude };
}

/** A non-empty `id` off an arbitrary wire object, or null. */
function readId(row: unknown): string | null {
  if (typeof row !== "object" || row === null) return null;
  if (!("id" in row)) return null;
  return typeof row.id === "string" && row.id !== "" ? row.id : null;
}
