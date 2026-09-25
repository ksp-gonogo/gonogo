import type { AlarmRequestedBy } from "@ksp-gonogo/components";
import { migrateValueKey } from "../telemetry/renamedValueKeys";

export type { AlarmRequestedBy };

export type AlarmState =
  /** Trigger condition not yet met. */
  | "pending"
  /** Time-based: UT is within the lead window, host has stepped warp down.
   *  Threshold-based: never used (no lead phase). */
  | "arming"
  /** Trigger condition just met: banner shows "FIRED", fade-out in a few seconds. */
  | "firing"
  /** Already-fired, kept briefly for visibility then removed. */
  | "fired";

export type ThresholdOp = ">" | ">=" | "<" | "<=" | "==" | "!=";

/**
 * Which clock an alarm's instant is on, and therefore who evaluates it.
 *
 * - `"command"`: the clock the operator is reading. The alarm fires when the
 *   VIEW time reaches it, which is one light-time after the craft passed it.
 *   Evaluated here, on the client, the way every alarm always has been.
 * - `"scet"`: the craft's own clock. The alarm fires when the GAME's time
 *   reaches it, and the mod stops the warp for everybody when it does.
 *   Evaluated on the mod, because a client holds only delayed readings.
 *
 * Absent means `"command"`, so every persisted alarm and every LAN session
 * keeps exactly the behaviour it had.
 */
export type AlarmVantage = "command" | "scet";

export interface TimeTrigger {
  kind: "time";
  /** KSP Universal Time at which the alarm fires, seconds. */
  ut: number;
  /**
   * Seconds before UT to step warp down. Default 10. Longer values give
   * the operator more time to pre-align; shorter ones minimise real-time
   * waste when timing isn't critical.
   */
  leadSeconds: number;
}

/**
 * Whether this trigger is read at its own subject's vantage: the craft's own
 * clock and the craft's own state, upstream of the reveal gate.
 *
 * Only the two arms that can carry a vantage can answer, and the question is
 * about WHERE the condition is compared, nothing else. It is not
 * {@link modOwnsLatch}: that asks who writes the latch, and the two coincided
 * until the mod began evaluating alarms at places other than their subject.
 */
export function isAtSubjectVantage(trigger: AlarmTrigger): boolean {
  // A time alarm names no craft and no place. A universal time is the same
  // instant wherever it is watched from, so it is always read at its own
  // subject, the game, and there is no vantage to carry.
  if (trigger.kind === "time") return true;
  return trigger.kind === "threshold" && trigger.vantage === "scet";
}

/**
 * Whether the MOD decides when this alarm fires, and so the client must not
 * write its latch.
 *
 * Two evaluators writing one latch field clear each other's, which is the
 * hazard `AlarmStateMachine.updateThresholdTracking` describes. This is the
 * one place that answers it: the body IS the migration table, so a kind moves
 * in one row and the whole state of the migration reads in ten lines.
 *
 * **Necessary, not sufficient.** A kind being mod-owned says the mod SHOULD
 * hold the alarm; it does not say the mod DOES. An arm can be refused, for a
 * vantage that names no place or a Topic with no reading behind it, and an
 * alarm nobody holds whose latch nobody writes never fires at all. A caller
 * suppressing client behaviour composes this with
 * `ScetAlarmBridge.holdsAlarm`, which is the mod's own statement of what it
 * took. This one stops a kind flipping too early; that one stops a flip
 * landing in a hole.
 *
 * Takes the TRIGGER rather than the alarm, because the kind is all it reads: a
 * caller holding only a trigger would otherwise have to assert a whole alarm
 * around it, and that assertion becomes a lie the moment this reads a second
 * field.
 */
export function modOwnsLatch(trigger: AlarmTrigger): boolean {
  switch (trigger.kind) {
    case "time":
      // Every time alarm, with no vantage test. The instant is the game's own
      // universal time and every clock agrees on it, so there is no second
      // opinion for this side to hold.
      return true;
    case "threshold":
      // Mod-owned wherever the mod can read it: at its own subject, and at a
      // command vantage when the trigger carries the Topic address the mod
      // resolves. An addressless threshold names a key no Topic stands behind,
      // so the mod is never asked to hold it and this side keeps the latch.
      return isAtSubjectVantage(trigger) || thresholdAddress(trigger) !== null;
    case "contract-parameter":
    case "event":
      // The mod cannot evaluate either yet. A contract parameter reads a
      // list-shaped Topic that a dotted path cannot index, and nothing
      // produces an event occurrence at all.
      return false;
  }
}

export interface ThresholdTrigger {
  kind: "threshold";
  /** Data key to read (e.g. `v.altitude`, `v.surfaceVelocity`). */
  dataKey: string;
  /** Comparison operator. */
  op: ThresholdOp;
  /** Threshold value (numeric only in v1). */
  value: number;
  /**
   * Minimum seconds the condition must be sustained before firing. Lets
   * users gate noisy signals (e.g. altitude bobbing across a threshold).
   * 0 fires immediately on first match.
   */
  sustainSeconds: number;
  /**
   * Which clock the comparison is made on. See {@link AlarmVantage}.
   *
   * This is the arm that genuinely cannot be done anywhere else. A time alarm
   * only needs a clock and the client has one; "is the craft above 100 km NOW"
   * needs the craft's state now, which reaches the ground a light-time late and
   * by then is the answer to a different question.
   */
  vantage?: AlarmVantage;
  /**
   * SCET only: the Topic whose payload carries the value, as the wire spells a
   * Topic (`"vessel.flight"`).
   *
   * The flat {@link dataKey} cannot stand in for it. It is `topic + "." +
   * fieldPath` with nothing marking the join, and a Topic can have two segments
   * or three (`vessel.orbit.truth`), so splitting one back apart is a guess.
   * The simulation addresses a reading as a Topic and a path into its payload,
   * and this is that address carried rather than reconstructed.
   */
  topic?: string;
  /** SCET only: the dotted path into {@link topic}'s payload (`"altitudeAsl"`). */
  fieldPath?: string;
}

/**
 * The Topic-and-path address a SCET threshold is armed against, or null when
 * the trigger is not one or carries no address.
 *
 * Null is a real answer rather than an impossible state: a key that came from a
 * live `DataSource` rather than from the contract's own field catalogue has no
 * Topic behind it, so there is nothing for the simulation to resolve.
 */
export function scetThresholdAddress(
  trigger: AlarmTrigger,
): { topic: string; fieldPath: string } | null {
  if (trigger.kind !== "threshold" || trigger.vantage !== "scet") return null;
  return thresholdAddress(trigger);
}

/**
 * The same address for a threshold on EITHER clock, or null when it carries
 * none.
 *
 * A command-vantage threshold does not need one to work: it is evaluated here,
 * against the flat {@link ThresholdTrigger.dataKey} this client already reads.
 * It carries one so the simulation can be asked the same question about what
 * this vantage has been told, which is the only way to find out whether the two
 * evaluators agree.
 */
export function thresholdAddress(
  trigger: AlarmTrigger,
): { topic: string; fieldPath: string } | null {
  if (trigger.kind !== "threshold") return null;
  const { topic, fieldPath } = trigger;
  if (!topic || !fieldPath) return null;
  return { topic, fieldPath };
}

/**
 * Whether this alarm's `onFire` actions are meant to run ABOARD: held by the
 * mod and run in the frame the alarm fires, with no delay. Otherwise this
 * screen sends them when it learns of the fire, and they reach the craft one
 * light-time later.
 *
 * Aboard only where the craft itself could have judged the condition in that
 * frame: a time, which a sequencer aboard keeps, or a SCET threshold on a
 * reading of the craft. A threshold judged against what the command centre
 * has been told fires a light-time after the craft passed it, and one on the
 * game's own state (a career's funds) is not aboard any craft, so acting on
 * the craft in the same frame as either would carry the decision there
 * faster than light.
 */
export function actionsRunAboard(trigger: AlarmTrigger): boolean {
  if (trigger.kind === "time") return true;
  if (trigger.kind !== "threshold" || !isAtSubjectVantage(trigger)) {
    return false;
  }
  return thresholdAddress(trigger)?.topic.startsWith("vessel.") ?? false;
}

export type ContractParameterTargetState = "Complete" | "Failed";

/**
 * Fires when a specific parameter on a specific contract reaches the
 * target state. Reads `contracts.active`; the parameter is identified
 * by its title (string-equal) within the contract whose `id` matches.
 *
 * The trigger ignores the underlying numeric value and works on a
 * discrete state transition: "Incomplete → Complete" is the canonical
 * use case ("ping me when this objective is met"). Picking a contract
 * that's no longer Active (e.g. the operator already accepted, or it
 * was cancelled) means the trigger sits perpetually pending; the host
 * doesn't auto-prune. Same shape as a parameterTitle-typo alarm,
 * fail safe rather than silently fire.
 */
export interface ContractParameterTrigger {
  kind: "contract-parameter";
  contractId: number;
  /** Parameter title as emitted on `contracts.active[].parameters[].title`. */
  parameterTitle: string;
  /** State the parameter must reach. Default "Complete". */
  targetState: ContractParameterTargetState;
  /** Sustain seconds: typically 0 since the state is already discrete. */
  sustainSeconds: number;
}

/**
 * Fires on the arrival of a discrete occurrence on an `event` stream topic
 * (the discrete-occurrence primitive: see `EventTimeline` in
 * `@ksp-gonogo/sitrep-client`). Unlike threshold / contract-parameter, which
 * are level-triggered (a condition that holds), an event trigger is
 * edge-triggered: it latches the moment a matching occurrence is *revealed*,
 * then fires and stays fired: an occurrence is a fact of the past, it never
 * "un-happens".
 *
 * Only occurrences revealed *after* the alarm begins watching count, so
 * creating an alarm never replays an event already in the buffer (mirrors
 * `useStreamEvent`, which skips the sticky replay). No `sustainSeconds`: a
 * discrete edge has nothing to sustain.
 *
 * Scaffold note: no producer topic is wired yet. The host reads revealed
 * occurrences through an injected reader on `AlarmStateMachine` that currently
 * defaults to empty: so an `event` alarm sits perpetually pending until a
 * producer is wired. Fail-safe, same posture as a typo'd contract-parameter.
 */
export interface EventTrigger {
  kind: "event";
  /** Event-stream topic id whose occurrences drive this alarm. */
  topic: string;
  /**
   * Optional occurrence-kind filter. When set, only occurrences whose `kind`
   * string-equals this fire the alarm; unset fires on any occurrence on the
   * topic.
   */
  eventKind?: string;
}

export type AlarmTrigger =
  | TimeTrigger
  | ThresholdTrigger
  | ContractParameterTrigger
  | EventTrigger;

/**
 * Side-effect to dispatch when the alarm fires. Currently action-group only:
 * the operator picks a group and the host resolves it to that group's own
 * command at fire time. Lives alongside the visual fire event so the central
 * alarm pipeline (warp dewarp ramp, cross-screen acknowledge) covers the
 * action-group dispatch automatically: see
 * `project_central_alarm_pipeline.md`.
 *
 * Discriminated union from the start so future trigger-style side
 * effects (kOS RUN, log-and-move-on, emit-peer-message etc.) can be
 * added without churning consumers.
 */
export type AlarmFireAction = {
  kind: "action-group";
  /**
   * Which group to fire, as `actionGroupIdOf` spells it: a stock singleton's
   * name (`"SAS"`, `"Stage"`) or `AG<index>` for a custom.
   *
   * The index rather than the name on the custom half, for the reason that
   * function's own doc gives: two AGX groups can share a display name, and a
   * player naming one "Stage" would otherwise resolve to the stock Stage and
   * drop a stage off the vessel.
   */
  action: string;
};

export interface Alarm {
  id: string;
  name: string;
  notes?: string;
  trigger: AlarmTrigger;
  state: AlarmState;
  /** Source of the alarm: "main" or a peer id. */
  createdBy: string;
  /**
   * The Uplink that asked for this alarm, when one did.
   *
   * Orthogonal to {@link createdBy}, which answers "which screen made it" and
   * is a peer id for anything a station added. An Uplink widget on a station
   * produces both: the station's peer id here, and the Uplink there.
   */
  requestedBy?: AlarmRequestedBy;
  /** Wall-clock `Date.now()` when created. */
  createdAt: number;
  /**
   * Threshold alarms only: UT seconds when the condition first matched
   * in the current run. Reset to null whenever the condition becomes
   * false, so the sustain timer always measures contiguous match.
   */
  matchSinceUT?: number | null;
  /**
   * The UT at which the thing that fired this alarm actually HAPPENED, as
   * distinct from `matchSinceUT`, which is the UT it was revealed at. Under
   * signal delay the two are far apart, and "when did it happen" is the number
   * the operator wants; the reveal UT cannot stand in for it, and it has to
   * keep being the reveal UT because that is what opens the firing window.
   * Undefined until something latches.
   *
   * Set by the two arms whose firing instant is not the client's own clock:
   * an `event` trigger latches the occurrence's own UT, and a SCET time
   * trigger latches the instant the mod reported stopping the warp at. Both
   * are on the craft's clock, and both render with the SCET qualifier.
   */
  eventUT?: number;
  /**
   * Optional side effects fired in order when the alarm transitions to
   * `firing`. Errors are swallowed at the host boundary so one failed
   * action doesn't block the alarm itself or the rest of the list.
   */
  onFire?: AlarmFireAction[];
  /**
   * Set when this alarm fired without its `onFire` actions being dispatched,
   * because the fire was discovered rather than watched: found already due on
   * the first evaluation after a reload, or made due by an edit. A command sent
   * now for a condition met arbitrarily long ago is not a late action but the
   * wrong one. Cleared when the alarm goes back to waiting.
   */
  actionsWithheld?: true;
}

export interface AlarmWarpState {
  /** KSP warp-rate index. 0 = realtime. */
  index: number;
  /** Numeric multiplier corresponding to the index. */
  rate: number;
  /** "HIGH" | "LOW": matches the wire's warp mode when known. */
  mode: "HIGH" | "LOW" | "UNKNOWN";
}

export interface AlarmSnapshot {
  alarms: Alarm[];
  /**
   * Latest KSP universal time we've observed on the wire, seconds.
   * Stations use this to render the T-minus countdown against an
   * authoritative source without subscribing to t.universalTime themselves.
   */
  ut: number | null;
  warp: AlarmWarpState;
  /**
   * Non-null when warp is elevated and no alarm or recent user-initiated
   * warp-change explains it. `detectedAtUT` is the UT at detection, so the
   * banner can age it out. Cleared when warp returns to 0 or the user
   * explicitly acks.
   */
  unscheduledWarp: { index: number; detectedAtUT: number } | null;
  /**
   * Active "warp to next alarm" session. The host steps the warp ladder
   * up/down each tick so that game-time-remaining never falls below
   * `warpSafetyMarginSeconds` of real-time, guaranteeing the alarm's
   * arming window is reachable. Null when no session is active.
   *
   * `targetRate` is what that rung runs at on THIS install, or null while
   * nothing has said. It rides the snapshot so a station never looks a rung up
   * in a ladder of its own: the rung numbers are shared, the rates behind them
   * belong to whichever game the host is connected to.
   */
  warpTo: {
    alarmId: string;
    targetIndex: number;
    targetRate: number | null;
  } | null;
  /**
   * Real-time buffer (seconds) the warp-to controller leaves between the
   * current rate and the alarm's lead window. Higher = more pessimistic /
   * earlier step-down. Configurable from the banner.
   *
   * The FLOOR, not the whole margin: on a delayed craft the controller uses
   * `max(this, owlt)`, because the operator's view is one light-time behind
   * and a warp window cannot be aborted from inside. See
   * `WarpControl.computeWarpToIndex`.
   */
  warpSafetyMarginSeconds: number;
  /**
   * One-way light time to the craft, seconds, when the controller is holding
   * open more room than the setting above asks for. Absent on a LAN session,
   * and absent from a snapshot minted by a host that predates it.
   *
   * Reported so the banner can say why the ladder is running slower than the
   * number in the operator's own box: a control that is silently overridden
   * reads as a broken control.
   */
  owltSeconds?: number;
  /**
   * Why the simulation would not arm a SCET alarm, keyed by alarm id, in the
   * mod's own words. Absent when nothing has been refused.
   *
   * The refusal is the ONLY way a client learns a Topic cannot be read
   * pre-reveal: what a SCET threshold may be armed against is a table inside
   * the mod and nothing publishes it, so the picker can offer a Topic the
   * simulation turns down. Carried on the snapshot so the row can say so,
   * rather than sitting armed-looking and never firing, which an operator
   * cannot tell apart from a condition that simply has not come due.
   */
  scetArmRefusals?: Record<string, string>;
  /**
   * Why an alarm's `onFire` list did not all reach the wire the last time it
   * fired, keyed by alarm id. Absent when nothing has been refused.
   *
   * An action group is toggled by sending its INVERSE as an absolute set, so a
   * fire whose `vessel.control` reading is stale has nothing current to invert
   * and sends nothing. Without this the alarm reads `fired` while the gear sits
   * exactly where it was, and the row gives the operator no way to connect the
   * two.
   */
  onFireRefusals?: Record<string, string>;
  /**
   * The ids of alarms the simulation holds as UNREACHABLE: the craft the
   * condition watches no longer exists, so they can never come due. Absent when
   * there are none.
   *
   * Only the simulation knows a craft is gone. Without this the row reads
   * `pending` for ever, like an alarm whose condition has not come due yet.
   */
  scetUnreachable?: string[];
  /**
   * Alarms the simulation holds that this list does not: armed by another
   * screen, or by an Uplink for itself. Absent when there are none.
   */
  scetForeign?: ForeignScetAlarm[];
}

/**
 * An alarm on the simulation's roster that this list does not hold, as the
 * roster states it. Removing one disarms it; nothing else here can change it.
 */
export interface ForeignScetAlarm {
  id: string;
  name: string;
  /** The vantage it was armed from, in the `"ground:<name>"` / `"vessel:<guid>"` vocabulary. */
  armedBy: string;
  state: "armed" | "fired" | "unreachable";
  /** What it watches, or null when the row carried a condition this side cannot read. */
  condition: ForeignScetCondition | null;
}

export type ForeignScetCondition =
  | { kind: "time"; ut: number }
  | {
      kind: "threshold";
      topic: string;
      fieldPath: string;
      op: ThresholdOp;
      value: number;
    }
  | { kind: "contract-parameter"; parameterTitle: string };

export const DEFAULT_LEAD_SECONDS = 10;
export const DEFAULT_SUSTAIN_SECONDS = 0;
export const DEFAULT_WARP_SAFETY_MARGIN_SECONDS = 10;
export const MIN_WARP_SAFETY_MARGIN_SECONDS = 1;
export const MAX_WARP_SAFETY_MARGIN_SECONDS = 120;

const ALARM_STATES: readonly AlarmState[] = [
  "pending",
  "arming",
  "firing",
  "fired",
];

/** A persisted `state` when it is one this build knows, and `undefined` for a
 *  record written by a build that named a state this one has never had. */
function asAlarmState(value: unknown): AlarmState | undefined {
  return ALARM_STATES.find((state) => state === value);
}

/** Migrate v1 persisted alarms (top-level `ut` / `leadSeconds`) into the
 *  v2 `trigger` shape. Idempotent: already-v2 records pass through. */
export function migrateAlarm(raw: unknown): Alarm | null {
  const alarm = migrateAlarmShape(raw);
  if (
    alarm &&
    typeof raw === "object" &&
    raw !== null &&
    "actionsWithheld" in raw &&
    raw.actionsWithheld === true
  ) {
    alarm.actionsWithheld = true;
  }
  return alarm;
}

function migrateAlarmShape(raw: unknown): Alarm | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.name !== "string") return null;
  const state = asAlarmState(r.state);
  const createdBy = typeof r.createdBy === "string" ? r.createdBy : "main";
  const createdAt = typeof r.createdAt === "number" ? r.createdAt : Date.now();
  const notes = typeof r.notes === "string" ? r.notes : undefined;
  const matchSinceUT =
    typeof r.matchSinceUT === "number" ? r.matchSinceUT : null;
  const onFire = parseOnFire(r.onFire);
  const requestedBy = parseRequestedBy(r.requestedBy);

  if (r.trigger && typeof r.trigger === "object") {
    const t = r.trigger as Record<string, unknown>;
    if (t.kind === "time" && typeof t.ut === "number") {
      return {
        id: r.id,
        name: r.name,
        notes,
        trigger: {
          kind: "time",
          ut: t.ut,
          leadSeconds:
            typeof t.leadSeconds === "number"
              ? t.leadSeconds
              : DEFAULT_LEAD_SECONDS,
          /* `t.vantage` is deliberately dropped. A time alarm is compared
             against the game's own universal time, which every clock agrees on,
             so a persisted vantage names a choice the system can no longer
             honour and carrying it forward would suggest one exists. */
        },
        state: state ?? "pending",
        createdBy,
        requestedBy,
        createdAt,
        onFire,
      };
    }
    if (
      t.kind === "threshold" &&
      typeof t.dataKey === "string" &&
      typeof t.value === "number" &&
      typeof t.op === "string"
    ) {
      /* A SCET threshold is only a SCET threshold if it carries the address the
         simulation resolves. Without one there is nothing to arm, and an alarm
         that can never be armed would sit pending forever with nothing on
         screen saying why; demoted to the command vantage it is at least the
         alarm the operator can watch working. Anything that is not the literal
         "scet" is the command vantage for the same reason the time arm gives:
         the absent field has to mean the behaviour every persisted alarm
         already had. */
      const topic = typeof t.topic === "string" ? t.topic : "";
      const fieldPath = typeof t.fieldPath === "string" ? t.fieldPath : "";
      const addressed = topic !== "" && fieldPath !== "";
      return {
        id: r.id,
        name: r.name,
        notes,
        trigger: {
          kind: "threshold",
          dataKey: migrateValueKey(t.dataKey),
          op: t.op as ThresholdOp,
          value: t.value,
          sustainSeconds:
            typeof t.sustainSeconds === "number"
              ? t.sustainSeconds
              : DEFAULT_SUSTAIN_SECONDS,
          vantage: t.vantage === "scet" && addressed ? "scet" : "command",
          ...(addressed ? { topic, fieldPath } : {}),
        },
        state: state ?? "pending",
        createdBy,
        requestedBy,
        createdAt,
        matchSinceUT,
        onFire,
      };
    }
    if (
      t.kind === "contract-parameter" &&
      typeof t.contractId === "number" &&
      typeof t.parameterTitle === "string"
    ) {
      const targetState = t.targetState === "Failed" ? "Failed" : "Complete";
      return {
        id: r.id,
        name: r.name,
        notes,
        trigger: {
          kind: "contract-parameter",
          contractId: t.contractId,
          parameterTitle: t.parameterTitle,
          targetState,
          sustainSeconds:
            typeof t.sustainSeconds === "number" ? t.sustainSeconds : 0,
        },
        state: state ?? "pending",
        createdBy,
        requestedBy,
        createdAt,
        matchSinceUT,
        onFire,
      };
    }
    if (t.kind === "event" && typeof t.topic === "string") {
      return {
        id: r.id,
        name: r.name,
        notes,
        trigger: {
          kind: "event",
          topic: t.topic,
          eventKind: typeof t.eventKind === "string" ? t.eventKind : undefined,
        },
        state: state ?? "pending",
        createdBy,
        requestedBy,
        createdAt,
        matchSinceUT,
        eventUT: typeof r.eventUT === "number" ? r.eventUT : undefined,
        onFire,
      };
    }
    return null;
  }

  // Pre-v2: top-level ut + leadSeconds
  if (typeof r.ut !== "number") return null;
  return {
    id: r.id,
    name: r.name,
    notes,
    trigger: {
      kind: "time",
      ut: r.ut,
      leadSeconds:
        typeof r.leadSeconds === "number"
          ? r.leadSeconds
          : DEFAULT_LEAD_SECONDS,
    },
    state: state ?? "pending",
    createdBy,
    requestedBy,
    createdAt,
    onFire,
  };
}

/**
 * The Uplink provenance off a persisted or wire record, or undefined for an
 * alarm nobody asked for on the operator's behalf.
 *
 * Checked field by field rather than asserted, the same posture `readFiredNotice`
 * takes in `ScetAlarmBridge`: what arrives here is localStorage or a peer
 * message, neither of which this code wrote. A record missing any of the three
 * is dropped whole rather than half-kept, because a row that says "requested by"
 * and cannot say by whom is worse than one that says nothing.
 */
function parseRequestedBy(raw: unknown): AlarmRequestedBy | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.uplinkId !== "string" || r.uplinkId === "") return undefined;
  if (typeof r.uplinkName !== "string" || r.uplinkName === "") return undefined;
  if (typeof r.key !== "string" || r.key === "") return undefined;
  return { uplinkId: r.uplinkId, uplinkName: r.uplinkName, key: r.key };
}

function parseOnFire(raw: unknown): AlarmFireAction[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const items: unknown[] = raw;
  const out: AlarmFireAction[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    if (Reflect.get(item, "kind") !== "action-group") continue;
    const action: unknown = Reflect.get(item, "action");
    if (typeof action === "string") out.push({ kind: "action-group", action });
  }
  return out.length > 0 ? out : undefined;
}
