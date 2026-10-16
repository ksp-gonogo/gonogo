import {
  classifyRetained,
  type InFlightCommand,
  type PathConnectedDuring,
  type PendingEntry,
} from "../command-delay";

/**
 * How long, in real seconds, a dispatched id may go without appearing in
 * `system.uplink.pending` before this hook gives up tracking it, which is how
 * a command that was never delayed leaves the tracking. A delayed command's
 * entry is in the next queue snapshot whatever its own `oneWaySeconds`, so the
 * window has only to outlast one queue broadcast, never a round trip. Counted on
 * the page's clock, because the mod broadcasts the queue on real time while the
 * game is paused.
 */
const NEVER_TRACKED_GRACE_SECONDS = 5;

export interface PendingUplinkQueueLike {
  pending: PendingEntry[];
}

export type TrackedResolution =
  | { kind: "classified"; item: InFlightCommand }
  /** No queue entry yet, but still within the never-tracked grace window; keep tracking, nothing to render yet. */
  | { kind: "waiting" }
  /** Reached `predictedPhase: "due"` and actually came back, stop tracking. */
  | { kind: "resolved" }
  /** No queue entry ever arrived within the grace window, assume this dispatch never used the pending-uplink queue at all. */
  | { kind: "expired" };

/**
 * Resolve one tracked dispatch id against the live queue, this hook's own
 * entry cache, this client's own record of what came back, and (when never
 * queued) the never-tracked grace clock. Shared by the render-time `inFlight`
 * computation and the prune effect below so the two can never drift on what
 * counts as resolved/expired.
 *
 * `acknowledged` is what stops a dispatch being dropped on faith. Reaching
 * `predictedPhase: "due"` under a connected path is not enough: the reply being
 * due does not mean one came, and a command nobody answered must not read as
 * one that arrived. The client knows the difference per dispatch and is asked
 * for it here.
 */
/** A group's one row says how many commands it stands for; a command sent alone keeps its own label. */
function groupedLabel(entry: PendingEntry): string {
  const size = entry.members?.length ?? 0;
  const name = entry.label || entry.command;
  return size > 1 ? `${name} (group of ${size})` : entry.label;
}

export function resolveTracked(
  id: string,
  queue: PendingUplinkQueueLike | undefined,
  cache: Map<string, PendingEntry>,
  firstSeenAt: Map<string, number>,
  nowUt: number,
  nowWall: number,
  pathConnectedDuring: PathConnectedDuring,
  acknowledged: (id: string) => boolean,
  judgedLost: (id: string) => boolean = () => false,
): TrackedResolution {
  /* Matched on the requestId the queue echoes back, never on `entry.id`, which is the engine's own counter and collides with this client's. */
  const found = queue?.pending.find((entry) => entry.clientRequestId === id);
  /*
   * A group is one entry, found by its first member. The others are covered by
   * it: they stay tracked while it is queued and draw no row of their own.
   */
  if (!found && queue?.pending.some((entry) => entry.members?.includes(id))) {
    return { kind: "waiting" };
  }
  // Re-keyed to the tracked id so the rail row keeps the id the caller holds.
  const inQueue = found && {
    ...found,
    id,
    label: groupedLabel(found),
  };
  if (inQueue) cache.set(id, inQueue);
  const entry = inQueue ?? cache.get(id);

  if (!entry) {
    const firstSeen = firstSeenAt.get(id);
    if (
      firstSeen !== undefined &&
      nowWall - firstSeen >= NEVER_TRACKED_GRACE_SECONDS
    ) {
      return { kind: "expired" };
    }
    return { kind: "waiting" };
  }

  const acked = acknowledged(id);
  const classified = classifyRetained({
    entry,
    nowUt,
    present: Boolean(inQueue),
    acknowledged: acked,
    pathConnectedDuring,
  });
  /*
   * Still anchored on `due` rather than on the acknowledgement alone: the rail
   * shows the PREDICTED round trip, and a stub or a zero-delay path can answer
   * before the predicted reply without the window having elapsed.
   */
  if (classified === undefined) return { kind: "resolved" };
  /*
   * The client's own finding, made from the game clock once the reply was
   * overdue. A command sent with no route has no predicted reply, so the rail's
   * prediction alone would keep it in transit after its promise has rejected.
   */
  if (!acked && judgedLost(id) && classified.predictedPhase !== "lost") {
    return {
      kind: "classified",
      item: { ...classified, predictedPhase: "lost" },
    };
  }
  if (acked && classified.predictedPhase === "due") {
    return { kind: "resolved" };
  }
  /*
   * Nothing on the rail to play through: no route was known, the entry is held
   * at a relay whose wait the prediction can only guess, or no reply time was
   * predicted. The answer came, so the command ran, and `due` may never come.
   */
  if (
    acked &&
    (classified.reachEtaSeconds === null ||
      entry.laneSeq != null ||
      classified.replyEtaSeconds === null)
  ) {
    return { kind: "resolved" };
  }
  return { kind: "classified", item: classified };
}
