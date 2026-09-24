import { logger } from "@ksp-gonogo/logger";
import {
  dispatchActiveCommandTopic,
  getActiveTelemetryClient,
  getVesselIdentity,
  subscribeActiveTelemetryClient,
} from "@ksp-gonogo/sitrep-client";
import {
  CommandErrorCode,
  KspParameterState,
  type ScetAlarmAction,
  ScetAlarmActionKind,
  ScetAlarmConditionKind,
  ScetAlarmState,
  ScetAlarmThresholdOp,
} from "@ksp-gonogo/sitrep-sdk";
import {
  type Alarm,
  type AlarmFireAction,
  actionsRunAboard,
  isAtSubjectVantage,
  modOwnsLatch,
  type ThresholdOp,
  thresholdAddress,
} from "./types";

/**
 * How long to leave an arm that could not be made yet before asking again: a
 * vantage the simulation could not check, or one this side could not name.
 * Long enough that sitting at the main menu is not a command per tick, short
 * enough that an alarm armed before a save loaded is live soon after it.
 */
const TRANSIENT_REARM_INTERVAL_MS = 10_000;

/**
 * `buildArmArgs`'s answer when the arm cannot be stated YET: no vantage has
 * been observed, or no vessel identity has arrived to name the craft. Distinct
 * from `null`, which is a condition the mod could never be asked about.
 */
const NOT_YET = Symbol("not-yet");

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
   * warp is already stopped. `actionsWithheld` says its onboard actions did not
   * run because the craft being flown was not the one they were for. Must be
   * idempotent: the notice is replayed to a reconnecting client on purpose.
   */
  onFired(id: string, firedAtUt: number, actionsWithheld: boolean): void;
  /**
   * The simulation decided a COMMAND-VANTAGE alarm was due, judged against what
   * `vantage` has been told rather than against the craft's true state.
   *
   * Shadow only. The client is still the authority for this alarm and keeps
   * evaluating it; this exists so the two verdicts can be compared. Latching
   * from it is the hazard `AlarmStateMachine.updateThresholdTracking` documents:
   * the latch the mod would write is the same field the client's own tracking
   * writes, so two authorities for it would clear each other's.
   */
  onShadowFired(id: string, firedAtUt: number, vantage: string): void;
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
  /** Wall clock, injected so the retry interval is drivable from a test. */
  nowMs(): number;
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
 * tick it was captured rather than a light-time later.
 *
 * The store honours the role (`warp-delay.characterise.test.ts` measures what
 * it buys), so the ordinary path would work. This still reads raw frames,
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
 *
 * ## What the SHADOW arm adds
 *
 * A command-vantage threshold carrying a Topic address is armed too, naming the
 * vantage this screen commands from. The mod then evaluates it against what that
 * place has been told, and publishes its verdict on the same fire channel tagged
 * with the vantage.
 *
 * Nothing latches from it. The client keeps evaluating the same alarm itself,
 * and the two answers are compared and logged. That is the only configuration
 * that produces evidence: two evaluators on two DIFFERENT alarms would say
 * nothing about whether they agree, and two evaluators on one alarm both
 * writing the latch would clear each other's.
 */
export class ScetAlarmBridge {
  private readonly ctx: ScetAlarmBridgeContext;
  private unsubscribeClient: (() => void) | null = null;
  private unsubscribeRoster: (() => void) | null = null;
  private unsubscribeFired: (() => void) | null = null;
  /** The ids the mod last said it held. Empty before any roster frame has arrived. */
  private rosterIds: readonly string[] = [];
  /** The ids the mod last said it holds onboard actions for. */
  private rosterActing: ReadonlySet<string> = new Set();
  /** The ids the mod last said can never come due, because their craft is gone. */
  private rosterUnreachable: ReadonlySet<string> = new Set();
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
  /**
   * Ids the mod is owed an arm for, against the earliest moment worth asking.
   *
   * An arm that is never answered moves nothing: it cannot reach the mod's
   * roster, so no roster frame arrives and `commandedSinceRoster` is never
   * cleared, and the first attempt would be the last word until the operator
   * edited the alarm. Three things leave an arm unanswered: one that could not
   * be stated yet, one that could not be routed, and a refusal for a reason
   * that resolves by waiting. A permanent refusal is an answer and clears the
   * debt, since re-asking a settled question is noise on every tick for ever.
   *
   * Also how an alarm is armed whatever state it has reached. A new or edited
   * alarm is owed one even if its condition already holds and it fired on the
   * tick that created it, which is exactly the alarm that must not be left
   * unwatched; and an edited one is owed one even though the mod holds its id,
   * because what the mod holds is the condition that was replaced.
   */
  private owed = new Map<string, number>();
  private disposed = false;

  constructor(ctx: ScetAlarmBridgeContext) {
    this.ctx = ctx;
  }

  /**
   * Subscribe to the mod's roster and fire notice. Separate from construction
   * because the notice is replayed synchronously on subscribe, and what it
   * calls back into must already hold this bridge.
   */
  start(): void {
    if (this.disposed || this.unsubscribeClient) return;
    this.unsubscribeClient = subscribeActiveTelemetryClient(() => this.bind());
    this.bind();
  }

  /** The mod is owed an arm for this alarm's current condition, as soon as it can be made. */
  owe(alarm: Alarm): void {
    if (!isAtSubjectVantage(alarm.trigger) && !isShadowable(alarm)) return;
    this.owed.set(alarm.id, 0);
    this.commandedSinceRoster.delete(alarm.id);
  }

  /**
   * Whether the MOD holds this alarm, and therefore whether it will stop the
   * warp when the alarm comes due.
   *
   * The mod's own statement rather than this side's inference, which is what
   * makes it safe to suppress a client warp command on. The two are not the
   * same set: a command-vantage TIME alarm and a threshold whose key has no
   * Topic behind it are both a kind the mod evaluates and neither is ever
   * armed, so a rule reading the trigger would strip their stop and leave them
   * stopping nothing. An arm the mod REFUSED is absent here too, which an
   * inference could not know.
   *
   * **UNDEFINED before the first roster frame**, which is a third answer and not
   * a shy `false`. The two callers want opposite things from "not known yet" and
   * only one of them is safe defaulting to false:
   *
   * - the WARP stop treats it as false and commands anyway. A second
   *   `setWarpIndex(0)` against warp already at zero is a no-op
   * - the LATCH must NOT treat it as false. Latching an alarm the mod is about
   *   to take moves it out of `pending`, an alarm out of `pending` is armed
   *   only while an arm is still owed for it, and the alarm is then never
   *   armed, never held, and never latched by anybody. The absence of a roster
   *   is the one moment that deadlock can start
   */
  holdsAlarm(id: string): boolean | undefined {
    if (!this.rosterSeen) return undefined;
    return this.rosterIds.includes(id);
  }

  /**
   * Whether the MOD holds this alarm's `onFire` actions and runs them itself in
   * the frame it fires. The mod's own statement off the roster, like
   * {@link holdsAlarm}: sending them from here as well would act on the craft
   * twice, the second time a light-time late.
   */
  actsAboard(id: string): boolean {
    return this.rosterActing.has(id);
  }

  /** The ids the mod holds as unreachable, off its roster. */
  unreachableIds(): readonly string[] {
    return [...this.rosterUnreachable];
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
      if (!isAtSubjectVantage(alarm.trigger) && !isShadowable(alarm)) continue;
      /* A PENDING alarm, or one still owed its arm. An alarm that fired after
         the mod was told must not be re-armed when a timeline reset drops the
         roster: its condition is in the past, so it would fire again at once. */
      if (alarm.state === "pending" || this.owed.has(alarm.id)) {
        wanted.set(alarm.id, alarm);
      }
    }
    for (const id of this.owed.keys()) {
      if (!wanted.has(id)) this.owed.delete(id);
    }

    for (const id of this.rosterIds) {
      if (!wanted.has(id) && !this.commandedSinceRoster.has(id)) {
        this.commandedSinceRoster.add(id);
        this.disarm(id);
      }
    }
    const held = new Set(this.rosterIds);
    for (const [id, alarm] of wanted) {
      if (this.commandedSinceRoster.has(id)) continue;
      const owedAt = this.owed.get(id);
      if (owedAt === undefined && held.has(id)) continue;
      if (owedAt !== undefined && this.ctx.nowMs() < owedAt) continue;
      this.commandedSinceRoster.add(id);
      this.arm(alarm);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribeClient?.();
    this.unsubscribeClient = null;
    this.unbindTopics();
  }

  /**
   * Arm one alarm on the mod. Arming an id the mod already holds replaces it,
   * so an edit needs no disarm-then-arm to race.
   */
  private arm(alarm: Alarm): void {
    const armed = this.buildArmArgs(alarm);
    if (armed === null) {
      this.owed.delete(alarm.id);
      return;
    }
    if (armed === NOT_YET) {
      this.askAgainLater(alarm.id);
      return;
    }
    const outcome = dispatchActiveCommandTopic(SCET_ARM_COMMAND, armed);
    if (!outcome.routed) {
      logger.warn("alarm-host: SCET arm not routed", { id: alarm.id });
      this.askAgainLater(alarm.id);
      return;
    }
    /* Held off while the command is in flight: the roster frame that shows it
       held can arrive before the answer does, and a debt still due then would
       send it again. */
    if (this.owed.has(alarm.id)) {
      this.owed.set(alarm.id, this.ctx.nowMs() + TRANSIENT_REARM_INTERVAL_MS);
    }
    void outcome.settled.then((refusal) => {
      if (this.disposed) return;
      if (refusal === undefined) {
        this.owed.delete(alarm.id);
        this.ctx.onArmAccepted(alarm.id);
        return;
      }
      /* The mod's own words when it quoted the game, which name the Topic or
         the vantage the operator picked. `message` is built from the code and
         names only the command, so it reads identically for every refusal of
         the arm and tells an operator nothing about their alarm. */
      const reason = refusal.detail ?? refusal.message;
      if (refusal.errorCode === CommandErrorCode.NotClearToProceed) {
        /* Nothing about the alarm is wrong: the simulation has not been told
           what places exist yet, which is the main menu and the ticks before
           the first capture. Asked again on a slow cadence rather than every
           tick, because that window lasts as long as the operator leaves it.

           Decided BEFORE the shadow branch below, because whether a refusal can
           be re-asked is a different question from whether it is worth telling
           anyone about. Only an arm naming a place other than its own subject
           can be refused this way, and every one of those is a shadow arm, so
           deciding it after that branch would retry nothing at all. */
        this.askAgainLater(alarm.id);
      } else {
        this.owed.delete(alarm.id);
      }
      /* A shadow arm that the mod cannot read costs the operator nothing: the
         alarm they are watching is the client's own and is unaffected. So the
         refusal is logged and NOT surfaced, which a SCET refusal must be,
         because there the refusal is the whole reason the alarm will never
         fire. */
      if (!modOwnsLatch(alarm.trigger)) {
        logger.debug("alarm-host: shadow arm refused", {
          id: alarm.id,
          code: refusal.errorCode,
          reason,
        });
        return;
      }
      /* The mod is the authority on what it can read, and this is the first
         moment this side could have known. Reported with the mod's own words
         rather than a sentence of ours: the message names the Topic the
         operator chose, and a paraphrase would have to keep a second copy of a
         table we deliberately do not hold. */
      logger.warn("alarm-host: SCET arm refused", {
        id: alarm.id,
        code: refusal.errorCode,
        reason,
      });
      this.ctx.onArmRefused(alarm.id, reason);
    });
  }

  /** Owe this arm again after the transient interval, and let the reconcile send it. */
  private askAgainLater(id: string): void {
    this.owed.set(id, this.ctx.nowMs() + TRANSIENT_REARM_INTERVAL_MS);
    this.commandedSinceRoster.delete(id);
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
   * The `alarm.scet.arm` arguments for one alarm, `NOT_YET` when they cannot be
   * stated honestly yet, or null when they never can.
   *
   * Every one of those is a refusal to GUESS: an arm carrying the wrong subject
   * or place is accepted and then never fires, which is the one outcome an
   * alarm must not have.
   *
   * - null: a threshold key with no Topic behind it, one from a live
   *   `DataSource` rather than the contract's field catalogue, which the mod
   *   has no way to interpret
   * - `NOT_YET`: a command-vantage alarm before any frame has named the place
   *   this screen commands from, or a craft-scoped Topic before any vessel
   *   identity has arrived. Both are the first moments of a connection
   */
  private buildArmArgs(
    alarm: Alarm,
  ): Record<string, unknown> | null | typeof NOT_YET {
    const trigger = alarm.trigger;
    /* Where the simulation reads this alarm. Empty is sent for a SCET alarm and
       the mod resolves it to the alarm's own subject, which is what a SCET alarm
       has always been read at. A command-vantage alarm names the place this
       screen is commanding from, so the mod compares against the readings that
       place has actually been sent: the centre it chose, or until it chooses,
       the one the mod stamped its frames with. */
    const client = getActiveTelemetryClient();
    const vantage = isAtSubjectVantage(trigger)
      ? ""
      : (client?.selectedVantage ?? client?.observedVantage ?? "");
    if (!isAtSubjectVantage(trigger) && vantage === "") return NOT_YET;
    if (trigger.kind === "time") {
      const craft = getVesselIdentity()?.vesselId;
      return {
        id: alarm.id,
        name: alarm.name,
        vantage,
        // A time condition is about the game's own clock, so it names no craft.
        subject: "game",
        condition: {
          kind: ScetAlarmConditionKind.Time,
          ut: trigger.ut,
          leadSeconds: trigger.leadSeconds,
        },
        /* Its actions name the craft being flown as it is armed, so a switch
           before the fire withholds them rather than landing them elsewhere.
           With no craft to name they stay on this screen, which sends them from
           the ground; the alarm itself is armed either way. */
        ...(craft ? aboard(alarm, `vessel:${craft}`) : {}),
      };
    }
    if (trigger.kind === "contract-parameter") {
      /* Career bookkeeping belongs to the save rather than to any craft, so it
         is read at the game's own subject, the same way funds are. */
      return {
        id: alarm.id,
        name: alarm.name,
        vantage,
        subject: "game",
        condition: {
          kind: ScetAlarmConditionKind.ContractParameter,
          contractId: String(trigger.contractId),
          parameterTitle: trigger.parameterTitle,
          targetState:
            trigger.targetState === "Failed"
              ? KspParameterState.Failed
              : KspParameterState.Complete,
          sustainSeconds: trigger.sustainSeconds,
        },
      };
    }
    const address = thresholdAddress(trigger);
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
      return NOT_YET;
    }
    return {
      id: alarm.id,
      name: alarm.name,
      vantage,
      subject,
      ...aboard(alarm, subject),
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
      this.rosterActing = readActingIds(payload);
      this.rosterUnreachable = readUnreachableIds(payload);
      this.rosterSeen = true;
      this.commandedSinceRoster.clear();
      this.reconcile();
    });
    this.unsubscribeFired = client.subscribe(SCET_FIRED_TOPIC, (payload) => {
      const notice = readFiredNotice(payload);
      if (!notice) return;
      /* Which notices this side latches from is the same question as which
         alarms it delegated, so it is asked the same way the arm asks it. The
         vantage on the notice cannot answer it: the mod resolves an empty one to
         the alarm's own subject, and a command centre commanding its own crewed
         craft names that subject too. An id this side does not hold falls to the
         shadow arm, which says so. */
      const armed = this.ctx
        .getAlarms()
        .find((alarm) => alarm.id === notice.id);
      if (armed && modOwnsLatch(armed.trigger)) {
        this.ctx.onFired(notice.id, notice.firedAtUt, notice.actionsWithheld);
      } else {
        this.ctx.onShadowFired(notice.id, notice.firedAtUt, notice.vantage);
      }
    });
  }

  private unbindTopics(): void {
    this.unsubscribeRoster?.();
    this.unsubscribeRoster = null;
    this.unsubscribeFired?.();
    this.unsubscribeFired = null;
    this.rosterIds = [];
    this.rosterActing = new Set();
    this.rosterUnreachable = new Set();
    this.rosterSeen = false;
    this.commandedSinceRoster.clear();
    /* A new connection is a new simulation to ask, so every debt is due now. */
    for (const id of this.owed.keys()) this.owed.set(id, 0);
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
 * An operator's saved group id as the contract's typed action, or null for one
 * that has no onboard form. A custom group is `AG<index>` and crosses as its
 * index; a stock singleton crosses as its own kind, so no name reaches the wire
 * and a custom group a player called "Stage" cannot be read as staging.
 */
const STOCK_ONBOARD: Readonly<Record<string, ScetAlarmActionKind>> = {
  Stage: ScetAlarmActionKind.Stage,
  SAS: ScetAlarmActionKind.Sas,
  RCS: ScetAlarmActionKind.Rcs,
  Light: ScetAlarmActionKind.Lights,
  Gear: ScetAlarmActionKind.Gear,
  Brake: ScetAlarmActionKind.Brakes,
  Abort: ScetAlarmActionKind.Abort,
};

function onboardAction(fx: AlarmFireAction): ScetAlarmAction | null {
  const custom = /^AG(\d+)$/.exec(fx.action);
  if (custom) {
    const group = Number(custom[1]);
    return group >= 1 ? { kind: ScetAlarmActionKind.ActionGroup, group } : null;
  }
  const kind = STOCK_ONBOARD[fx.action];
  return kind === undefined ? null : { kind, group: 0 };
}

/**
 * The `onFire` and `actsOn` arm fields for an alarm whose actions run aboard,
 * or nothing. All or none: a list the craft can run only part of stays with
 * this screen whole, so the operator's order is never split across two places
 * a light-time apart.
 */
function aboard(
  alarm: Alarm,
  actsOn: string,
): { onFire: ScetAlarmAction[]; actsOn: string } | Record<string, never> {
  if (!alarm.onFire?.length || !actionsRunAboard(alarm.trigger)) return {};
  const onFire: ScetAlarmAction[] = [];
  for (const fx of alarm.onFire) {
    const action = onboardAction(fx);
    if (action === null) return {};
    onFire.push(action);
  }
  return { onFire, actsOn };
}

/** The ids of the roster rows whose craft is gone, so they can never come due. */
function readUnreachableIds(payload: unknown): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!Array.isArray(payload)) return ids;
  for (const row of payload) {
    const id = readId(row);
    if (
      id !== null &&
      typeof row === "object" &&
      row !== null &&
      "state" in row &&
      row.state === ScetAlarmState.Unreachable
    ) {
      ids.add(id);
    }
  }
  return ids;
}

/** The ids of the roster rows that hold onboard actions. */
function readActingIds(payload: unknown): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!Array.isArray(payload)) return ids;
  for (const row of payload) {
    const id = readId(row);
    if (
      id !== null &&
      typeof row === "object" &&
      row !== null &&
      "onFire" in row &&
      Array.isArray(row.onFire) &&
      row.onFire.length > 0
    ) {
      ids.add(id);
    }
  }
  return ids;
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
function readFiredNotice(payload: unknown): {
  id: string;
  firedAtUt: number;
  vantage: string;
  actionsWithheld: boolean;
} | null {
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
  /* Absent reads as unstated rather than as a place. Nothing routes on it, so a
     host that does not send one is understood rather than ignored. */
  const vantage =
    "vantage" in payload && typeof payload.vantage === "string"
      ? payload.vantage
      : "";
  return {
    id,
    firedAtUt: magnitude,
    vantage,
    actionsWithheld:
      "actionsWithheld" in payload && payload.actionsWithheld === true,
  };
}

/**
 * Whether this alarm is one the simulation can be asked to shadow: a
 * command-vantage THRESHOLD carrying the Topic-and-path address, or a contract
 * objective, which the simulation reads off the career it already builds.
 *
 * Never a time alarm, and that exclusion is not an oversight. The
 * mod judges a command vantage's conditions against the readings that place
 * has been told, but against the GAME's clock, because there is no one clock a
 * vantage keeps: how far behind it sits depends on which craft it is listening
 * to. A command-vantage time alarm evaluated there would fire at the SCET
 * instant, which is a different alarm rather than a second opinion on this one.
 */
function isShadowable(alarm: Alarm): boolean {
  if (alarm.trigger.kind === "contract-parameter") return true;
  return (
    !isAtSubjectVantage(alarm.trigger) &&
    thresholdAddress(alarm.trigger) !== null
  );
}

/** A non-empty `id` off an arbitrary wire object, or null. */
function readId(row: unknown): string | null {
  if (typeof row !== "object" || row === null) return null;
  if (!("id" in row)) return null;
  return typeof row.id === "string" && row.id !== "" ? row.id : null;
}
