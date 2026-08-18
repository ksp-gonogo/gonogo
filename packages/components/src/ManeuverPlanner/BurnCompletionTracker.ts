import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import { useEffect, useRef, useState } from "react";

export interface CompletedEntry {
  snapshot: ParsedManeuverNode;
  completedAt: number;
}

/** A maneuver counts as "complete" once its remaining ΔV crosses below this
 *  threshold *after* having been observed above it, guards against tiny
 *  freshly-planned correction burns being mistaken for completed ones. */
export const COMPLETED_THRESHOLD_DV = 0.5;

/** Wall-clock hold so the operator gets visual confirmation. Real time, not
 *  game time: timewarp would otherwise expire it instantly post-burn. */
export const COMPLETED_HOLD_MS = 10_000;

/**
 * Pure update step for the burn-completion state machine.
 *
 * - Updates `maxDvByUt` in place with the highest ΔV magnitude seen for each
 *   node (keyed by UT, which is stable across KSP renumbering on removal).
 * - Returns the next `completedNodes` map: a node is added to it the first
 *   time `nodes` reports it below `threshold` *after* having been observed
 *   above the threshold.
 *
 * Returns the same `current` reference if no transitions happened, so React
 * can short-circuit re-renders.
 */
export function computeCompletionUpdate(
  current: ReadonlyMap<number, CompletedEntry>,
  nodes: readonly ParsedManeuverNode[],
  maxDvByUt: Map<number, number>,
  now: number,
  threshold: number = COMPLETED_THRESHOLD_DV,
): ReadonlyMap<number, CompletedEntry> {
  for (const n of nodes) {
    const prev = maxDvByUt.get(n.UT) ?? 0;
    if (n.deltaVMagnitude > prev) maxDvByUt.set(n.UT, n.deltaVMagnitude);
  }
  let next: Map<number, CompletedEntry> | null = null;
  for (const n of nodes) {
    if (current.has(n.UT)) continue;
    const observedMax = maxDvByUt.get(n.UT) ?? 0;
    if (observedMax > threshold && n.deltaVMagnitude < threshold) {
      if (next === null) next = new Map(current);
      next.set(n.UT, { snapshot: n, completedAt: now });
    }
  }
  return next ?? current;
}

interface UseBurnCompletionTrackerResult {
  /** Map keyed by UT: entries here render with the green-flash banner. */
  completedNodes: ReadonlyMap<number, CompletedEntry>;
  /**
   * The largest delta-v magnitude seen for each burn, keyed by UT: what the plan
   * asked for before any of it was spent.
   *
   * Exposed because conformance needs the same observation this hook already
   * makes, and a second watcher of one quantity is a second thing that can
   * disagree about whether the same burn finished. Read-only: the tracker owns
   * the accumulation.
   */
  maxDvByUt: ReadonlyMap<number, number>;
}

/**
 * Tracks which maneuver nodes have crossed below the completion threshold
 * (`computeCompletionUpdate`) and schedules an auto-removal of each one
 * after `COMPLETED_HOLD_MS` of wall-clock time.
 *
 * The auto-removal calls `removeNode(<position>)` with the node's position in
 * the *latest* list, re-looked-up at fire time because KSP re-numbers on every
 * removal. A POSITION, not an id: this hook only ever sees the legacy parsed
 * list, whose `id` is the array index, so resolving that to the stream guid the
 * `vessel.maneuver.remove` command needs is the caller's job and the caller is
 * the only one who can do it. Passing the index through as though it were an id
 * is what made this path silently dead.
 *
 * Fire-and-forget by design (an auto-cleanup, not an operator action with
 * somewhere to surface an error): the caller owns catching its own `.send(...)`
 * rejection, same as the legacy `execute(...)` call this replaces already
 * swallowed it. That is also why the defect survived: the command answered
 * NotFound every time and nothing was listening.
 */
export function useBurnCompletionTracker(
  nodes: readonly ParsedManeuverNode[],
  removeNode: (nodePosition: number) => void,
): UseBurnCompletionTrackerResult {
  const [completedNodes, setCompletedNodes] = useState<
    ReadonlyMap<number, CompletedEntry>
  >(() => new Map());
  const maxDvByUt = useRef<Map<number, number>>(new Map());
  // Latest `nodes` for use inside the auto-removal timeout, without this
  // ref the timeout would close over a stale list and look up the wrong id.
  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    setCompletedNodes((current) =>
      computeCompletionUpdate(current, nodes, maxDvByUt.current, Date.now()),
    );
  }, [nodes]);

  useEffect(() => {
    if (completedNodes.size === 0) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const [ut, entry] of completedNodes) {
      const remaining = Math.max(
        0,
        COMPLETED_HOLD_MS - (Date.now() - entry.completedAt),
      );
      timers.push(
        setTimeout(() => {
          const live = nodesRef.current.find((n) => n.UT === ut);
          if (live) {
            // `live.id` is the positional array index (`ParsedManeuverNode`'s
            // own shape), re-read here rather than captured, because an earlier
            // removal shifts every later node down one.
            removeNode(live.id);
          }
          setCompletedNodes((current) => {
            if (!current.has(ut)) return current;
            const next = new Map(current);
            next.delete(ut);
            return next;
          });
          maxDvByUt.current.delete(ut);
        }, remaining),
      );
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [completedNodes, removeNode]);

  return { completedNodes, maxDvByUt: maxDvByUt.current };
}
