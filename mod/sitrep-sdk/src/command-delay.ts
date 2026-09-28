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
 * Where a command in flight is expected to be: travelling out, waiting for its
 * reply, due, overdue, or lost.
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
 * Structural subset of the `PendingUplink` wire entry (do NOT import the mod
 * type).
 *
 * @category Delay and vantage
 */
export interface PendingEntry {
  id: string;
  command: string;
  label: string;
  topic: string;
  vantage: string;
  dispatchedAt: Value<"ut">;
  oneWaySeconds: Value<"s">;
  /**
   * The scalar the dispatch asked for, when its command is a declared control
   * channel's write half. Absent otherwise, and absent rather than zero when
   * unknown: a zero throttle and an unknown value must never read the same.
   */
  commandedValue?: number;
}

/**
 * Structural subset of the `CommsDelay` wire payload's field this module reads.
 *
 * @category Delay and vantage
 */
export interface CommsDelayLike {
  oneWaySeconds: Value<"s"> | null;
}

/**
 * One row on the delay rail: anything crossing the link, a command this client
 * sent or a transmission the craft is sending home. Produced only by
 * {@link deriveRailEntry}, so the two cannot drift in what their rows say.
 *
 * @category Delay and vantage
 */
export interface InFlightCommand {
  id: string;
  label: string;
  /** The command id, or for a transmission the subject it carries. */
  command: string;
  topic: string;
  /** Which way the entry crosses the link: `command` up to the craft, `telemetry` down from it. */
  direction: RailDirection;
  dispatchedAt: number;
  /** The one-way delay the crossing was sent under, frozen at the send. */
  oneWaySeconds: number;
  /** Seconds until the entry reaches the far end; `null` when no-path. */
  reachEtaSeconds: number | null;
  /** Seconds until the reply is expected back; `null` when no-path, and always for a fire-and-forget entry, which has no reply. */
  replyEtaSeconds: number | null;
  predictedPhase: PredictedPhase;
}

/**
 * What a rail entry is made from: something sent across the link at `sentAt`
 * under a one-way delay, arriving one delay later. An acked crossing then waits
 * the same delay again for its reply; a fire-and-forget one ends at arrival,
 * since nothing replies to it. `tags` come from a `railTagsFor*` derivation.
 *
 * @category Delay and vantage
 */
export interface RailCrossing {
  id: string;
  label: string;
  /** The command id, or for a transmission the subject it carries. */
  command: string;
  topic: string;
  tags: RailTags;
  sentAt: Value<"ut">;
  oneWaySeconds: Value<"s">;
}

const STAGED_THRESHOLD_SECONDS = 1;

/**
 * The current delay mode from a `comms.delay` payload. `oneWaySeconds` is
 * nullable: `null` means NO PATH, never a measured zero-distance delay.
 * Never coerce it to 0.
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
 * The one rail-entry derivation: where a crossing is at `nowUt`. A
 * fire-and-forget crossing is `in-transit` until it arrives and gone after,
 * so it returns `undefined` from arrival on rather than inventing an outcome.
 *
 * @category Delay and vantage
 */
export function deriveRailEntry(
  crossing: RailCrossing,
  nowUt: number,
): InFlightCommand | undefined {
  const now = value("ut", nowUt);
  const reachUt = crossing.sentAt.plus(crossing.oneWaySeconds);
  const row = {
    id: crossing.id,
    label: crossing.label,
    command: crossing.command,
    topic: crossing.topic,
    direction: crossing.tags.direction,
    dispatchedAt: crossing.sentAt.magnitude,
    oneWaySeconds: crossing.oneWaySeconds.magnitude,
    reachEtaSeconds: reachUt.minus(now).magnitude,
  };
  if (crossing.tags.delivery === "fire-and-forget") {
    if (!now.lessThan(reachUt)) return undefined;
    return { ...row, replyEtaSeconds: null, predictedPhase: "in-transit" };
  }
  const replyUt = crossing.sentAt.plus(crossing.oneWaySeconds.times(2));
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
 * A queued uplink as the crossing it is: its command, sent at dispatch.
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
    oneWaySeconds: entry.oneWaySeconds,
  };
}

/**
 * Reach/reply etas and the predicted phase for each pending entry, given the
 * caller's `nowUt`. No memory, no connectivity; see `classifyRetained` for the
 * retained/failure-aware variant.
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
 * A caller-supplied predicate: was the comms path continuously connected across
 * [from,to] UT?
 *
 * @category Delay and vantage
 */
export type PathConnectedDuring = (fromUt: number, toUt: number) => boolean;

/**
 * For a retained (own) command that may have left the live queue: classify
 * overdue/lost. `present` = is the entry still in the current pending queue.
 * Defaults `pathConnectedDuring` to "always connected" when the caller has no
 * connectivity history to offer (e.g. a first render before any `comms.link`
 * sample has arrived). `undefined` once a command nothing replies to has
 * arrived, since it has ended.
 *
 * @category Delay and vantage
 */
export function classifyRetained(args: {
  entry: PendingEntry;
  nowUt: number;
  present: boolean;
  /**
   * Did a response actually come back for this dispatch?
   *
   * The `overdue` gate, and it has to be asked separately from `present`
   * because queue presence cannot answer it. `system.uplink.pending` is
   * prediction-only and the mod ages an entry out at exactly
   * `DispatchedAt + 2*OneWaySeconds` with no margin
   * (`ChannelEngine.PrunePendingUplinks`), so by the time `nowUt` passes
   * `replyUt + overdueMarginSeconds` the entry has left the queue whether it
   * was answered or ignored. Gating on `present` alone made `overdue`
   * unreachable, and every unanswered command read as one that arrived.
   *
   * Defaults to `!present`, which is that same unreachable rule stated out
   * loud, for a caller with no per-dispatch acknowledgement to offer.
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
  const replyUt = entry.dispatchedAt.plus(entry.oneWaySeconds.times(2));
  // 'lost': path was not continuously up across the in-flight window.
  if (!pathConnectedDuring(entry.dispatchedAt.magnitude, replyUt.magnitude)) {
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
 * Latches each item's `predictedPhase` forward-only across calls, guarding
 * against a transient backward blip in the caller's `nowUt` (view-clock
 * re-anchoring on an unrelated sample can rewind the estimate by a hair for
 * one frame: see the kOS terminal's original `isPastReach` doc, which this
 * generalizes). `memory` is the caller's own persisted map (typically a
 * `useRef`); mutated in place and also returned via the result. Ids no
 * longer present in `items` are forgotten so the map doesn't grow forever.
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
