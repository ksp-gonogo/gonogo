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
 * was sent and the signal delay:
 *
 * - `in-transit`: on its way to the craft
 * - `awaiting-reply`: arrived, with its reply on the way back
 * - `due`: its reply is expected now
 * - `overdue`: its reply is late
 * - `lost`: the link broke while it was travelling, so no reply is coming
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
 * How a command sent now would travel: `live` when the one-way delay is a second
 * or less, `staged` when it is longer, and `no-path` when there is no path home.
 *
 * @category Delay and vantage
 */
export type DelayMode = "live" | "staged" | "no-path";

/**
 * One command travelling to a craft, as the `system.uplink.pending` Topic
 * lists it.
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
   * throttle. Absent otherwise, and absent rather than zero when unknown.
   */
  commandedValue?: number;
  /** For a command held at a relay until a link opens, when it is predicted to reach the craft; absent or null otherwise. */
  predictedArrivalUt?: Value<"ut"> | null;
  /** For a held command, when its reply is predicted back, waits included; absent or null otherwise. */
  predictedReplyUt?: Value<"ut"> | null;
  /** For a held command, when it is deleted wherever it is if it has not run; absent or null otherwise. */
  expiresAtUt?: Value<"ut"> | null;
  /** For a held command, its lane number; absent or null for a command on no lane. */
  laneSeq?: Value<"count"> | null;
  /**
   * The request ids of the commands the entry stands for. A group sent with
   * `sendTogether` is one entry that lists each member's request id, with the
   * first also in `clientRequestId`.
   */
  members?: readonly string[];
}

/**
 * The one field of a `comms.delay` payload that {@link currentMode} reads.
 *
 * @category Delay and vantage
 */
export interface CommsDelayLike {
  /** The one-way signal delay, or `null` when there is no path to the craft. */
  oneWaySeconds: Value<"s"> | null;
}

/**
 * One row of the delay rail: a command on its way to a craft, or a
 * transmission on its way home. {@link deriveRailEntry} makes one.
 *
 * Times here are plain numbers of seconds.
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
  /** Which way the entry crosses the link: `command` up to the craft, `telemetry` down from it. */
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
}

/**
 * Something sent across the link, which {@link deriveRailEntry} places on the
 * delay rail: sent at `sentAt`, it arrives one delay later. An acked crossing
 * then waits one delay more for its reply; a fire-and-forget one ends when it
 * arrives. Set `tags` with {@link railTagsForCommand},
 * {@link railTagsForControlAxis} or {@link railTagsForTelemetry}.
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
 * Returns how a command sent now would travel, from a `comms.delay` payload:
 * `"live"` for a one-way delay of a second or less, `"staged"` for a longer
 * one, and `"no-path"` when `oneWaySeconds` is `null` or there is no payload.
 *
 * @category Delay and vantage
 */
export function currentMode(commsDelay: CommsDelayLike | undefined): DelayMode {
  const d = commsDelay?.oneWaySeconds;
  if (d == null) return "no-path";
  return d.lessThanOrEqual(STAGED_THRESHOLD_SECONDS) ? "live" : "staged";
}

/**
 * The live one-way delay a `comms.delay` reading states, or `null` when it
 * states none: no path home, a malformed or non-finite value, or no reading at
 * all. Never 0 for those, since a 0 says the entry arrives now.
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
 * nothing more will happen to it.
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
 * Returns a {@link PendingEntry} as a {@link RailCrossing}, sent when it was
 * dispatched.
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
 * It knows nothing of whether a reply came back or the link broke; use
 * {@link classifyRetained} for that.
 *
 * @category Delay and vantage
 */
export function deriveInFlight(
  entries: PendingEntry[],
  nowUt: number,
): InFlightCommand[] {
  return entries.flatMap(
    (e) => deriveRailEntry(pendingCrossing(e), nowUt) ?? [],
  );
}

/**
 * Returns whether the link to the craft was up for the whole of `fromUt` to
 * `toUt`, both in UT seconds. You supply it from your own record of the link.
 *
 * @category Delay and vantage
 */
export type PathConnectedDuring = (fromUt: number, toUt: number) => boolean;

/**
 * Returns the delay rail row for a command you sent, including whether it is
 * `"overdue"` or `"lost"`, which {@link deriveRailEntry} cannot say. Use it for
 * a command you keep showing after it has left `system.uplink.pending`.
 *
 * - `present`: whether the entry is still in `system.uplink.pending`
 * - `acknowledged`: whether a reply came back. Defaults to `!present`
 * - `overdueMarginSeconds`: how long past the expected reply before it is
 *   overdue
 * - `pathConnectedDuring`: your record of the link. Defaults to a link that
 *   never broke. A command whose link broke while it travelled is lost, except
 *   one held at a relay, which waits there
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
  const base = deriveRailEntry(pendingCrossing(entry), nowUt);
  // A command nothing answers has nothing to be late for once it arrives.
  if (base === undefined) return undefined;
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
  // No reply is predicted and nothing says when it expires: there is nothing to be late against yet.
  if (replyUt === null) return base;
  // 'lost': path was not continuously up across the in-flight window. Not for
  // a held command: a break leaves it waiting at a node, not lost.
  if (
    !held &&
    !pathConnectedDuring(entry.dispatchedAt.magnitude, replyUt.magnitude)
  ) {
    return { ...base, predictedPhase: "lost" };
  }
  // 'overdue': past reply + margin and nothing has come back.
  const overdueAfter = replyUt.plus(value("s", overdueMarginSeconds));
  if (!acknowledged && value("ut", nowUt).greaterThan(overdueAfter)) {
    return { ...base, predictedPhase: "overdue" };
  }
  return base;
}

/** Ordinal used only to detect a BACKWARD phase move (a transient judder), never to sort. */
const PHASE_ORDER: Record<PredictedPhase, number> = {
  "in-transit": 0,
  "awaiting-reply": 1,
  due: 2,
  overdue: 3,
  lost: 3,
};

/**
 * Returns `items` with each `predictedPhase` kept from moving backwards since
 * the last call, so a row does not flicker when the view time steps back
 * slightly for one frame.
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
