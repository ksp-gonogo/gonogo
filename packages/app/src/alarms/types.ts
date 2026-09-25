import type { AlarmRequestedBy } from "@ksp-gonogo/components";

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
 * Where a threshold is judged. The simulation judges every alarm; this picks
 * which readings it judges against.
 *
 * - `"command"`: what the command centre this screen commands from has been
 *   told, so the alarm fires when that place learns the condition holds, one
 *   light-time after the craft passed it
 * - `"scet"`: the craft's own state, so the alarm fires when the craft reaches
 *   the condition
 *
 * Absent means `"command"`.
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
 */
export function isAtSubjectVantage(trigger: AlarmTrigger): boolean {
  // A time alarm names no craft and no place. A universal time is the same
  // instant wherever it is watched from, so it is always read at its own
  // subject, the game, and there is no vantage to carry.
  if (trigger.kind === "time") return true;
  return trigger.kind === "threshold" && trigger.vantage === "scet";
}

export interface ThresholdTrigger {
  kind: "threshold";
  /** The value key the operator picked, as the picker and the row name it. */
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
  /** Where the comparison is judged. See {@link AlarmVantage}. */
  vantage?: AlarmVantage;
  /**
   * The Topic whose payload carries the value, as the wire spells a Topic
   * (`"vessel.flight"`). Required: the simulation judges every threshold, and
   * it addresses a reading as a Topic and a path into its payload.
   *
   * The flat {@link dataKey} cannot stand in for it. It is `topic + "." +
   * fieldPath` with nothing marking the join, and a Topic can have two segments
   * or three (`vessel.orbit.truth`), so splitting one back apart is a guess.
   */
  topic: string;
  /** The dotted path into {@link topic}'s payload (`"altitudeAsl"`). */
  fieldPath: string;
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
  return trigger.topic.startsWith("vessel.");
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

export type AlarmTrigger =
  | TimeTrigger
  | ThresholdTrigger
  | ContractParameterTrigger;

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
   * The view-clock UT at which this screen learned the simulation fired the
   * alarm, which opens the banner's firing window. Null until then.
   */
  matchSinceUT?: number | null;
  /**
   * The UT the simulation fired the alarm at, as distinct from
   * {@link matchSinceUT}, the UT this screen learned of it. Under signal delay
   * the two are far apart, and "when did it happen" is the number the operator
   * wants. Undefined until the alarm fires.
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
   * because the fire was discovered rather than watched: a notice replayed to
   * a screen that was not running when the alarm fired. A command sent now for
   * a condition met arbitrarily long ago is not a late action but the wrong
   * one.
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
  /**
   * How many of this list's alarms the simulation cancelled because the player
   * switched to another craft, counted until the operator acknowledges it.
   * Absent when there is nothing to tell. A cancelled alarm leaves the list
   * with no row, so this is the only place the operator learns of it.
   */
  alarmsCancelled?: { count: number };
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

const THRESHOLD_OPS: readonly ThresholdOp[] = [
  ">",
  ">=",
  "<",
  "<=",
  "==",
  "!=",
];

/**
 * A saved alarm in today's shape, or null for anything else, which is dropped
 * rather than converted.
 */
export function parseAlarm(raw: unknown): Alarm | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.name !== "string") return null;
  if (typeof r.createdBy !== "string" || typeof r.createdAt !== "number") {
    return null;
  }
  const state = ALARM_STATES.find((known) => known === r.state);
  const trigger = parseTrigger(r.trigger);
  if (state === undefined || trigger === null) return null;
  return {
    id: r.id,
    name: r.name,
    notes: typeof r.notes === "string" ? r.notes : undefined,
    trigger,
    state,
    createdBy: r.createdBy,
    requestedBy: parseRequestedBy(r.requestedBy),
    createdAt: r.createdAt,
    matchSinceUT: typeof r.matchSinceUT === "number" ? r.matchSinceUT : null,
    eventUT: typeof r.eventUT === "number" ? r.eventUT : undefined,
    onFire: parseOnFire(r.onFire),
    ...(r.actionsWithheld === true ? { actionsWithheld: true } : {}),
  };
}

/**
 * A trigger the simulation can be asked to watch, or null for one it cannot:
 * an unknown kind, a missing field, or a threshold with no Topic address.
 *
 * Also the check on a trigger arriving from a station, which this code did not
 * construct.
 */
export function parseTrigger(raw: unknown): AlarmTrigger | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (t.kind === "time") {
    if (typeof t.ut !== "number" || typeof t.leadSeconds !== "number") {
      return null;
    }
    return { kind: "time", ut: t.ut, leadSeconds: t.leadSeconds };
  }
  if (t.kind === "threshold") {
    const op = THRESHOLD_OPS.find((known) => known === t.op);
    if (
      op === undefined ||
      typeof t.dataKey !== "string" ||
      typeof t.value !== "number" ||
      typeof t.sustainSeconds !== "number" ||
      typeof t.topic !== "string" ||
      t.topic === "" ||
      typeof t.fieldPath !== "string" ||
      t.fieldPath === ""
    ) {
      return null;
    }
    return {
      kind: "threshold",
      dataKey: t.dataKey,
      op,
      value: t.value,
      sustainSeconds: t.sustainSeconds,
      vantage: t.vantage === "scet" ? "scet" : "command",
      topic: t.topic,
      fieldPath: t.fieldPath,
    };
  }
  if (t.kind === "contract-parameter") {
    if (
      typeof t.contractId !== "number" ||
      typeof t.parameterTitle !== "string" ||
      (t.targetState !== "Complete" && t.targetState !== "Failed") ||
      typeof t.sustainSeconds !== "number"
    ) {
      return null;
    }
    return {
      kind: "contract-parameter",
      contractId: t.contractId,
      parameterTitle: t.parameterTitle,
      targetState: t.targetState,
      sustainSeconds: t.sustainSeconds,
    };
  }
  return null;
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
