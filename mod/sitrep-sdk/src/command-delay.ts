import { LOSS_MARGIN } from "./spine/client";
import { type Value, value } from "./unit-system";
/**
 * Pure delayed-command derivations. Delay is ambient and universal, every
 * command the mod accepts is already gated by the reveal/uplink machinery,
 * so there is no "delayed vs not" command to opt into. These helpers turn
 * `system.uplink.pending` entries (each carrying its own `oneWaySeconds`,
 * frozen at dispatch) into a display-ready `InFlightCommand[]`, given the
 * caller's current view of `nowUt`.
 *
 * Nothing here dispatches or fetches. Statefulness (own-dispatch memory,
 * connectivity history,
 * judder-latching) lives one layer up in the hooks that call these
 * (`use-command.ts`, `use-route-commands.ts`), never here.
 */

export type PredictedPhase =
  | "in-transit"
  | "awaiting-reply"
  | "due"
  | "overdue"
  | "lost";
export type DelayMode = "live" | "staged" | "no-path";

/** Structural subset of the `PendingUplink` wire entry (do NOT import the mod type). */
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
   * `control-expectation.ts` is what consumes it.
   */
  commandedValue?: number;
}

/** Structural subset of the `CommsDelay` wire payload's field this module reads. */
export interface CommsDelayLike {
  oneWaySeconds: Value<"s"> | null;
}

export interface InFlightCommand {
  id: string;
  label: string;
  command: string;
  topic: string;
  dispatchedAt: number;
  /** Seconds until the command reaches the craft; `null` when no-path. */
  reachEtaSeconds: number | null;
  /** Seconds until the reply is expected back; `null` when no-path. */
  replyEtaSeconds: number | null;
  predictedPhase: PredictedPhase;
}

const STAGED_THRESHOLD_SECONDS = 1;

/**
 * The current delay mode from a `comms.delay` payload. `oneWaySeconds` is
 * nullable: `null` means NO PATH, never a measured zero-distance delay.
 * Never coerce it to 0.
 */
export function currentMode(commsDelay: CommsDelayLike | undefined): DelayMode {
  const d = commsDelay?.oneWaySeconds;
  if (d == null) return "no-path";
  return d.lessThanOrEqual(STAGED_THRESHOLD_SECONDS) ? "live" : "staged";
}

/**
 * Pure timing derivation: reach/reply etas and the predicted phase for each
 * pending entry, given the caller's `nowUt`. No memory, no connectivity,
 * see `classifyRetained` for the retained/failure-aware variant.
 */
export function deriveInFlight(
  entries: PendingEntry[],
  nowUt: number,
): InFlightCommand[] {
  const now = value("ut", nowUt);
  return entries.map((e) => {
    // Two instants, each the dispatch offset by a number of one-way legs, and
    // two intervals between an instant and now. The algebra distinguishes the
    // instants from the intervals; `+` and `-` on bare numbers did not.
    const reachUt = e.dispatchedAt.plus(e.oneWaySeconds);
    const replyUt = e.dispatchedAt.plus(e.oneWaySeconds.times(2));
    const predictedPhase: PredictedPhase = now.lessThan(reachUt)
      ? "in-transit"
      : now.lessThan(replyUt)
        ? "awaiting-reply"
        : "due";
    return {
      id: e.id,
      label: e.label,
      command: e.command,
      topic: e.topic,
      dispatchedAt: e.dispatchedAt.magnitude,
      reachEtaSeconds: reachUt.minus(now).magnitude,
      replyEtaSeconds: replyUt.minus(now).magnitude,
      predictedPhase,
    };
  });
}

/** A caller-supplied predicate: was the comms path continuously connected across [from,to] UT? */
export type PathConnectedDuring = (fromUt: number, toUt: number) => boolean;

/**
 * For a retained (own) command that may have left the live queue: classify
 * overdue/lost. `present` = is the entry still in the current pending
 * queue. Defaults `pathConnectedDuring` to "always connected" when the
 * caller has no connectivity history to offer (e.g. a first render before
 * any `comms.link` sample has arrived).
 */
export function classifyRetained(args: {
  entry: PendingEntry;
  nowUt: number;
  present: boolean;
  overdueMarginSeconds?: number;
  pathConnectedDuring?: PathConnectedDuring;
}): InFlightCommand {
  const {
    entry,
    nowUt,
    present,
    overdueMarginSeconds = LOSS_MARGIN,
    pathConnectedDuring = () => true,
  } = args;
  const base = deriveInFlight([entry], nowUt)[0];
  // Out and back: the dispatch instant offset by two one-way legs. An instant
  // plus a duration, so the algebra does it rather than `+` on two bare
  // numbers that happen to be seconds apart in meaning.
  const replyUt = entry.dispatchedAt.plus(entry.oneWaySeconds.times(2));
  // 'lost': path was not continuously up across the in-flight window.
  if (!pathConnectedDuring(entry.dispatchedAt.magnitude, replyUt.magnitude)) {
    return { ...base, predictedPhase: "lost" };
  }
  // 'overdue': past reply + margin and still tracked with no resolution.
  const overdueAfter = replyUt.plus(value("s", overdueMarginSeconds));
  if (present && value("ut", nowUt).greaterThan(overdueAfter)) {
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
