import {
  type RailDirection,
  type RailTags,
  railTagsForCommand,
} from "./rail-tags";
import { LOSS_MARGIN } from "./spine/client";
import { type Value, value } from "./unit-system";
/*
 * Pure derivations that turn `system.uplink.pending` entries, and a transmission's crossing, into display-ready `InFlightCommand` rows for a view time.
 * Nothing here dispatches or fetches; own-dispatch memory and connectivity history live in the hooks that call these.
 */

/**
 * Where a command on the delay rail is expected to be now, from the time it
 * was sent and the signal delay. Useful for showing the operator whether a
 * command is still travelling to the vessel, waiting for its reply, or late.
 * Carried by {@link InFlightCommand} and shown by {@link InFlightList}. The
 * phases are:
 *
 * - `in-transit`: on its way to the craft
 * - `awaiting-reply`: arrived, with its reply on the way back
 * - `due`: the moment its reply is expected has come, and it is not yet late
 * - `overdue`: that moment has passed without a reply
 * - `lost`: the signal path broke while it was travelling, so no reply is coming
 *
 * @category Delay and vantage
 */
export type PredictedPhase =
  | "in-transit"
  | "awaiting-reply"
  | "due"
  | "overdue"
  | "lost";

/**
 * How a command sent now would travel from the command centre to the vessel:
 * `live` when the one-way delay is a second or less, `staged` when it is
 * longer, and `no-path` when there is no route. Useful for showing the operator
 * whether a control acts at once or waits. Returned by {@link currentMode} and
 * used by {@link useCommand}.
 *
 * @category Delay and vantage
 */
export type DelayMode = "live" | "staged" | "no-path";

/**
 * One command a command centre's queue reports refused by the game, failed,
 * or answered after its reply was overdue, an entry of
 * `system.uplink.pending`'s `settled` list. Useful for telling the
 * operator what became of a command another screen at the centre sent. Read by
 * {@link useCommand}, which lists another screen's outcome in its `refusals` or
 * `failures` as it lists its own.
 *
 * @category Delay and vantage
 */
export interface SettledEntry {
  /** The mod's id for the dispatch, as its queue entry had it. */
  id: string;
  /** The request id of the dispatch, as the sending client gave it. */
  clientRequestId: string;
  /** The command id. */
  command: string;
  /** The dispatch's description for the operator; empty when it carried none. */
  label: string;
  /** The part or route the command was addressed to. */
  topic: string;
  /** The command centre it was sent from. */
  vantage: string;
  /** When the outcome reached the command centre. */
  settledAt: Value<"ut">;
  /** `refused` when the game refused it, `failed` when the mod answered with a fault, `answered` when it ran with its reply late. */
  outcome: "refused" | "failed" | "answered";
  /** The refusal's root code, a `CommandErrorCode`, or the fault's code, a `FaultCode`; empty for `answered`. */
  code: string;
  /** The refinement's id, when a refusal was more specific than `code`; absent or null otherwise. */
  reason?: string | null;
  /** A refusal in the game's own words, when it gave any; absent or null otherwise. */
  detail?: string | null;
  /** What the mod said of a fault; absent or null otherwise. */
  message?: string | null;
}

/**
 * One command travelling from the command centre to a vessel, as the
 * `system.uplink.pending` Topic lists it. Useful for showing the operator which
 * of their commands have not yet reached the vessel. Taken by
 * {@link deriveInFlight}, {@link pendingCrossing} and {@link classifyRetained}.
 *
 * @category Delay and vantage
 */
export interface PendingEntry {
  /** The mod's id for the entry. To find a command you sent, match `clientRequestId` instead. */
  id: string;
  /** The request id of the dispatch, as the sending client gave it. */
  clientRequestId: string;
  /** The command id. */
  command: string;
  /** The dispatch's description for the operator. */
  label: string;
  /** The part or route the command is addressed to. */
  topic: string;
  /** The command centre it was sent from. */
  vantage: string;
  /** When it was sent. */
  dispatchedAt: Value<"ut">;
  /**
   * The one-way delay the command was sent under. Absent or `null` when the
   * sending centre knew no route to the craft, which is not a delay of zero.
   */
  oneWaySeconds?: Value<"s"> | null;
  /**
   * The value the command sets, when it sets a control channel such as the
   * throttle or declares the value it sets, such as a rotor's RPM cap. Absent
   * otherwise, and absent rather than zero when unknown.
   */
  commandedValue?: number;
  /** For a command held at a relay (a node on the route that stores it until a link opens), when it is predicted to reach the craft; absent or null otherwise. */
  predictedArrivalUt?: Value<"ut"> | null;
  /** For a held command, when its reply is predicted back, waits included; absent or null otherwise. */
  predictedReplyUt?: Value<"ut"> | null;
  /** Where the sending centre predicts the command first waits for a window, as a node id; absent or null when it is predicted to go straight through. */
  predictedHeldAt?: string | null;
  /**
   * What the sending centre told the sender when it accepted the command, as a
   * sentence to show the operator, such as a continuous input it will drop
   * where it would have to wait; absent when it said nothing.
   */
  warning?: string | null;
  /** When the command is predicted to leave `predictedHeldAt`; absent or null with it. */
  predictedHeldUntilUt?: Value<"ut"> | null;
  /** When the command is predicted to reach `predictedHeldAt`, where it waits; absent or null with it. */
  predictedHeldFromUt?: Value<"ut"> | null;
  /** For a held command, when it is deleted wherever it is if it has not run; absent or null otherwise. */
  expiresAtUt?: Value<"ut"> | null;
  /**
   * When the sending centre first found the reply overdue: it was predicted
   * home by then, no wait for a window was predicted, and nothing came. Absent
   * or null while the reply is not yet due or is predicted to wait.
   */
  replyOverdueUt?: Value<"ut"> | null;
  /** For a held command, its lane number: its place in the run of delayed commands this centre sends to the craft. Absent or null for a command on no lane. */
  laneSeq?: Value<"count"> | null;
  /**
   * The request ids of the commands the entry stands for. A group sent with
   * `sendTogether` is one entry that lists each member's request id, with the
   * first also in `clientRequestId`.
   */
  members?: readonly string[];
  /**
   * Every command the entry carries: its own `command` for a command sent
   * alone, and each member's command, in `members`' order, for a group, whose
   * `command` is the group's own. Absent from an entry that only gives
   * `command`.
   */
  memberCommands?: readonly string[];
}

/**
 * The one field of a `comms.delay` payload that {@link currentMode} reads.
 * Useful for passing a `comms.delay` reading, or a stand-in with the same
 * field, to {@link currentMode}.
 *
 * @category Delay and vantage
 */
export interface CommsDelayLike {
  /** The one-way signal delay, or `null` when there is no path to the craft. */
  oneWaySeconds: Value<"s"> | null;
}

/**
 * One row of the delay rail: a command on its way to a vessel, or a
 * transmission on its way home to the command centre. Useful for showing the
 * operator what is in transit and when it is expected to arrive. Made by
 * {@link deriveRailEntry} and listed by {@link InFlightList}.
 *
 * Unlike {@link PendingEntry}, whose times are `Value` objects, the times here
 * are plain numbers of seconds: `dispatchedAt` is the UT that
 * `PendingEntry.dispatchedAt` holds as a `Value`, as a number.
 *
 * @category Delay and vantage
 */
export interface InFlightCommand {
  /** The entry's id. */
  id: string;
  /** The description to show. */
  label: string;
  /** The command id, or for a transmission the subject it carries. */
  command: string;
  /** The part or route it is addressed to. */
  topic: string;
  /** Which way the entry travels: `command` up to the vessel, `telemetry` down from it. */
  direction: RailDirection;
  /** When it was sent, as a UT. */
  dispatchedAt: number;
  /** The one-way delay it was sent under, fixed at the moment of sending; `null` when no route was known. */
  oneWaySeconds: number | null;
  /** Seconds until the entry reaches the far end; `null` when no-path. */
  reachEtaSeconds: number | null;
  /** Seconds until the reply is expected back; `null` when no-path, and always for a fire-and-forget entry, which has no reply. */
  replyEtaSeconds: number | null;
  /** Where it is expected to be now. */
  predictedPhase: PredictedPhase;
  /** What the command was sent with, where this screen sent it; absent for a command another screen sent. */
  args?: unknown;
  /** True while the sending centre's route puts the command waiting at a relay for a link to open, so it has not left the command centre's side of the break. Absent otherwise. */
  held?: boolean;
  /** Where a command held on its way out is: present while it is on its way out with a wait known, absent otherwise. */
  hold?: CommandHold;
}

/**
 * The wait a command is predicted to make at a relay on its way out, as
 * {@link InFlightCommand} carries it. Useful for placing the command on the
 * delay rail at the relay it waits at, so the operator sees it stopped there.
 *
 * @category Delay and vantage
 */
export interface CommandHold {
  /**
   * How far along the way out to the vessel the command is, from 0 at the
   * command centre to 1 at the vessel, by light-time: the relay's share of
   * the way while it waits there, and more as it goes on.
   */
  outbound: number;
}

/**
 * A command or transmission in transit between the command centre and a vessel,
 * which {@link deriveRailEntry} places on the delay rail: sent at `sentAt`, it
 * arrives one delay later. An acked crossing
 * then waits one delay more for its reply; a fire-and-forget one ends when it
 * arrives. Set `tags` with {@link railTagsForCommand},
 * {@link railTagsForControlAxis} or {@link railTagsForTelemetry}. Useful for putting a transmission of your own,
 * such as a radio call, on the delay rail beside commands. Used by the push to
 * talk control and the transmissions list.
 *
 * @category Delay and vantage
 */
export interface RailCrossing {
  /** The entry's id. */
  id: string;
  /** The description to show. */
  label: string;
  /** The command id, or for a transmission the subject it carries. */
  command: string;
  /** The part or route it is addressed to. */
  topic: string;
  /** How it travels. */
  tags: RailTags;
  /** When it was sent. */
  sentAt: Value<"ut">;
  /** The one-way delay it was sent under; `null` when no route is known, so no arrival can be predicted. */
  oneWaySeconds: Value<"s"> | null;
  /** When it is predicted to arrive, where that is not one delay after `sentAt`, as for a command held at a relay. */
  predictedArrivalUt?: Value<"ut"> | null;
  /** When its reply is predicted back, where that is not two delays after `sentAt`. */
  predictedReplyUt?: Value<"ut"> | null;
}

const STAGED_THRESHOLD_SECONDS = 1;

/**
 * A one-way delay at or below this many seconds is drawn as no delay at all.
 * Delay switched off reads exactly 0. The margin, half a millisecond, is the
 * smallest delay the finest time rung any readout has can show as more than
 * zero, so a figure inside it would print as "0 ms" or "0 s" and read as delay
 * switched off.
 *
 * @category Delay and vantage
 */
export const ZERO_DELAY_DEAD_ZONE_SECONDS = 0.0005;

/**
 * Whether a delay readout is drawn, left out, or replaced by the no-path
 * state: `"shown"` for a one-way delay above the dead zone, `"hidden"` for one
 * at or inside it, and `"no-path"` when there is no route or no reading. A
 * delay switched off reads zero, and a measured delay inside the dead zone (a
 * craft on the pad beside its command centre) would print as zero too, so
 * both are hidden alike, whatever the delay's source. Useful for deciding in one
 * place whether the operator sees a delay figure, so no surface prints a bare
 * "0 s" for a craft that has no delay to report. Used by the delay readouts of
 * the dashboard header, the command rail and the vessel catalog.
 *
 * @category Delay and vantage
 */
export function delayVisibility(
  oneWaySeconds: number | Value<"s"> | null | undefined,
): "shown" | "hidden" | "no-path" {
  if (typeof oneWaySeconds === "object" && oneWaySeconds !== null) {
    if (!oneWaySeconds.isFinite()) return "no-path";
    return oneWaySeconds.greaterThan(value("s", ZERO_DELAY_DEAD_ZONE_SECONDS))
      ? "shown"
      : "hidden";
  }
  if (typeof oneWaySeconds !== "number" || !Number.isFinite(oneWaySeconds)) {
    return "no-path";
  }
  return oneWaySeconds > ZERO_DELAY_DEAD_ZONE_SECONDS ? "shown" : "hidden";
}

/**
 * Returns how a command sent now would travel, from a `comms.delay` payload:
 * `"live"` for a one-way delay of a second or less, `"staged"` for a longer
 * one, and `"no-path"` when `oneWaySeconds` is `null`, not a finite number, or there is no payload.
 * Useful for showing the operator whether a control acts at once or waits. Used
 * by {@link InFlightList}.
 *
 * @category Delay and vantage
 */
export function currentMode(commsDelay: CommsDelayLike | undefined): DelayMode {
  const d = commsDelay?.oneWaySeconds;
  if (d == null || !d.isFinite()) return "no-path";
  return d.lessThanOrEqual(STAGED_THRESHOLD_SECONDS) ? "live" : "staged";
}

/**
 * The live one-way delay a `comms.delay` reading states, in seconds, or `null`
 * when it states none: no route to the vessel, a malformed or non-finite value,
 * or no reading at all. Never 0 for those, since a 0 says the entry arrives
 * now. Useful for fixing the delay a command was sent under. Used by
 * {@link useCommand}.
 */
export function liveOneWaySeconds(
  commsDelay: CommsDelayLike | undefined,
): number | null {
  const raw = commsDelay?.oneWaySeconds?.magnitude;
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.max(0, raw)
    : null;
}

/**
 * Returns the delay rail row for a crossing at `nowUt`, in UT seconds. A
 * fire-and-forget crossing returns `undefined` once it has arrived, since
 * nothing more will happen to it. Useful for showing the operator where a
 * command or transmission is expected to be now.
 *
 * @category Delay and vantage
 */
export function deriveRailEntry(
  crossing: RailCrossing,
  nowUt: number,
): InFlightCommand | undefined {
  const now = value("ut", nowUt);
  const oneWay = crossing.oneWaySeconds;
  const reachUt =
    crossing.predictedArrivalUt ??
    (oneWay ? crossing.sentAt.plus(oneWay) : null);
  const row = {
    id: crossing.id,
    label: crossing.label,
    command: crossing.command,
    topic: crossing.topic,
    direction: crossing.tags.direction,
    dispatchedAt: crossing.sentAt.magnitude,
    oneWaySeconds: oneWay ? oneWay.magnitude : null,
    reachEtaSeconds: reachUt ? reachUt.minus(now).magnitude : null,
  };
  // No arrival predicted: it is waiting to be sent, which is still on its way out.
  if (reachUt === null) {
    return { ...row, replyEtaSeconds: null, predictedPhase: "in-transit" };
  }
  if (crossing.tags.delivery === "fire-and-forget") {
    if (!now.lessThan(reachUt)) return undefined;
    return { ...row, replyEtaSeconds: null, predictedPhase: "in-transit" };
  }
  const replyUt =
    crossing.predictedReplyUt ??
    (oneWay ? crossing.sentAt.plus(oneWay.times(2)) : null);
  if (replyUt === null) {
    return {
      ...row,
      replyEtaSeconds: null,
      predictedPhase: now.lessThan(reachUt) ? "in-transit" : "awaiting-reply",
    };
  }
  return {
    ...row,
    replyEtaSeconds: replyUt.minus(now).magnitude,
    predictedPhase: ackedPhase(now, reachUt, replyUt),
  };
}

function ackedPhase(
  now: Value<"ut">,
  reachUt: Value<"ut">,
  replyUt: Value<"ut">,
): PredictedPhase {
  if (now.lessThan(reachUt)) return "in-transit";
  if (now.lessThan(replyUt)) return "awaiting-reply";
  return "due";
}

/**
 * The row marked held while the sending centre's route has the command waiting
 * at a relay: a hold is predicted, its departure is still ahead, and the
 * command has not reached the craft.
 */
function withHeld(
  row: InFlightCommand,
  entry: PendingEntry,
  nowUt: number,
): InFlightCommand {
  if (entry.predictedHeldAt == null || row.predictedPhase !== "in-transit") {
    return row;
  }
  const placed = withHold(row, entry, nowUt);
  const until = entry.predictedHeldUntilUt;
  if (until != null && !until.greaterThan(value("ut", nowUt))) return placed;
  return { ...placed, held: true };
}

/** The row with how far out its wait is, when the entry has every time that places it. */
function withHold(
  row: InFlightCommand,
  entry: PendingEntry,
  nowUt: number,
): InFlightCommand {
  const from = entry.predictedHeldFromUt;
  const until = entry.predictedHeldUntilUt;
  const arrival = entry.predictedArrivalUt;
  if (from == null || until == null || arrival == null) return row;
  const now = value("ut", nowUt);
  const toRelay = from.minus(entry.dispatchedAt).max(0);
  const onward = arrival.minus(until).max(0);
  const way = toRelay.plus(onward);
  // The relay's share of the way out, by light-time; then, once it has left, how much of the rest is behind it.
  const share = way.isPositive() ? toRelay.per(way) : value("1", 0);
  const left = !now.lessThan(until) && onward.isPositive();
  const outbound = left
    ? share.plus(
        value("1", 1).minus(share).times(now.minus(until).per(onward).min(1)),
      )
    : share;
  return { ...row, hold: { outbound: outbound.min(1).magnitude } };
}

/** The row moved to a settled phase, which a command is no longer held in. */
function phased(row: InFlightCommand, phase: PredictedPhase): InFlightCommand {
  const { held: _held, hold: _hold, ...rest } = row;
  return { ...rest, predictedPhase: phase };
}

/**
 * Returns a {@link PendingEntry} as a {@link RailCrossing}, sent when it was
 * dispatched. Useful for placing a pending command on the delay rail with
 * {@link deriveRailEntry}.
 *
 * @category Delay and vantage
 */
export function pendingCrossing(entry: PendingEntry): RailCrossing {
  return {
    id: entry.id,
    label: entry.label,
    command: entry.command,
    topic: entry.topic,
    tags: railTagsForCommand(entry.command),
    sentAt: entry.dispatchedAt,
    oneWaySeconds: entry.oneWaySeconds ?? null,
    predictedArrivalUt: entry.predictedArrivalUt ?? null,
    predictedReplyUt: entry.predictedReplyUt ?? null,
  };
}

/**
 * Returns the delay rail row of each pending entry at `nowUt`, in UT seconds.
 * It knows nothing of whether a reply came back or the signal path broke; use
 * {@link classifyRetained} for that. Useful for listing for the operator every
 * command still on its way to the vessel.
 *
 * @category Delay and vantage
 */
export function deriveInFlight(
  entries: PendingEntry[],
  nowUt: number,
): InFlightCommand[] {
  return entries.flatMap((e) => {
    const row = deriveRailEntry(pendingCrossing(e), nowUt);
    return row === undefined ? [] : withHeld(row, e, nowUt);
  });
}

/**
 * Returns whether the signal path from the command centre to the vessel was up
 * for the whole of `fromUt` to `toUt`, both in UT seconds. You supply it from
 * your own record of connectivity. Taken by {@link classifyRetained} to decide
 * whether a command is lost.
 * Useful for deciding whether a command that got no reply was lost or is only
 * delayed.
 *
 * @category Delay and vantage
 */
export type PathConnectedDuring = (fromUt: number, toUt: number) => boolean;

/**
 * Returns the delay rail row for a command you sent, including whether it is
 * `"overdue"` or `"lost"`, which {@link deriveRailEntry} cannot say. Useful for
 * showing the operator a command after it has left `system.uplink.pending`.
 * Used by {@link useCommand}.
 *
 * - `present`: whether the entry is still in `system.uplink.pending`
 * - `acknowledged`: whether a reply came back. Defaults to `!present`
 * - `overdueMarginSeconds`: how long past the expected reply before it is
 *   overdue
 * - `pathConnectedDuring`: your record of connectivity. Defaults to a signal
 *   path that never broke. A command whose signal path broke while it travelled
 *   is lost, except one held at a relay, which waits there
 *
 * Returns `undefined` for a fire-and-forget command that has arrived.
 *
 * @category Delay and vantage
 */
export function classifyRetained(args: {
  entry: PendingEntry;
  nowUt: number;
  present: boolean;
  /*
   * Asked apart from `present`: the mod drops an entry from the queue when its reply is due, answered or not,
   * so without it a command can never read as overdue.
   */
  acknowledged?: boolean;
  overdueMarginSeconds?: number;
  pathConnectedDuring?: PathConnectedDuring;
}): InFlightCommand | undefined {
  const {
    entry,
    nowUt,
    present,
    acknowledged = !present,
    overdueMarginSeconds = LOSS_MARGIN,
    pathConnectedDuring = () => true,
  } = args;
  const row = deriveRailEntry(pendingCrossing(entry), nowUt);
  // A command nothing answers has nothing to be late for once it arrives.
  if (row === undefined) return undefined;
  const base = withHeld(row, entry, nowUt);
  // Out and back: the dispatch instant offset by two one-way legs. An instant
  // plus a duration, so the algebra does it rather than `+` on two bare
  // numbers that happen to be seconds apart in meaning.
  const held = entry.laneSeq != null;
  const replyUt =
    entry.predictedReplyUt ??
    (held && entry.expiresAtUt
      ? entry.expiresAtUt
      : entry.oneWaySeconds
        ? entry.dispatchedAt.plus(entry.oneWaySeconds.times(2))
        : null);
  // The centre's own finding, once it has made one, stands over the local sum.
  const centreOverdueUt = entry.replyOverdueUt;
  if (
    !acknowledged &&
    centreOverdueUt != null &&
    !value("ut", nowUt).lessThan(centreOverdueUt)
  ) {
    return phased(base, "overdue");
  }
  // No reply is predicted and nothing says when it expires: there is nothing to be late against yet.
  if (replyUt === null) return base;
  // 'lost': path was not continuously up across the in-flight window. Not for
  // a held command: a break leaves it waiting at a node, not lost. Not for one
  // already answered either: a reply proves it arrived.
  if (
    !held &&
    args.acknowledged !== true &&
    !pathConnectedDuring(entry.dispatchedAt.magnitude, replyUt.magnitude)
  ) {
    return phased(base, "lost");
  }
  // 'overdue': past reply + margin and nothing has come back.
  const overdueAfter = replyUt.plus(value("s", overdueMarginSeconds));
  if (!acknowledged && value("ut", nowUt).greaterThan(overdueAfter)) {
    return phased(base, "overdue");
  }
  return base;
}

/** Ordinal used only to detect a backward phase move (a transient judder), never to sort. */
const PHASE_ORDER: Record<PredictedPhase, number> = {
  "in-transit": 0,
  "awaiting-reply": 1,
  due: 2,
  overdue: 3,
  lost: 3,
};

/**
 * Returns `items` with each `predictedPhase` kept from moving backwards since
 * the last call, so a row does not switch back to an earlier phase when the
 * view time steps back slightly for one frame. Useful for keeping the
 * operator's delay rail steady.
 * Used by the stream's route commands hook.
 *
 * `memory` holds each row's last phase between calls, usually in a `useRef`.
 * It is updated in place, and rows no longer in `items` are removed from it.
 *
 * @category Delay and vantage
 */
export function latchForward(
  items: InFlightCommand[],
  memory: Map<string, InFlightCommand>,
): InFlightCommand[] {
  const currentIds = new Set(items.map((item) => item.id));
  for (const id of memory.keys()) {
    if (!currentIds.has(id)) memory.delete(id);
  }
  return items.map((item) => {
    const prev = memory.get(item.id);
    const latched =
      prev &&
      PHASE_ORDER[prev.predictedPhase] > PHASE_ORDER[item.predictedPhase]
        ? { ...item, predictedPhase: prev.predictedPhase }
        : item;
    memory.set(item.id, latched);
    return latched;
  });
}
