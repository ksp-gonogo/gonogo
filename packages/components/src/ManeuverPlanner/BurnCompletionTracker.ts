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
   * Largest delta-v seen per burn, keyed by UT: what the plan asked for before
   * any was spent. Shared with conformance so the two cannot disagree about
   * whether a burn finished.
   */
  maxDvByUt: ReadonlyMap<number, number>;
}

/**
 * Tracks nodes crossing below the completion threshold and removes each after
 * `COMPLETED_HOLD_MS` of wall-clock time. `removeNode` receives the node's
 * POSITION in the latest list, re-looked-up at fire time because KSP renumbers
 * on every removal; mapping it to the stream guid, and catching the send's
 * rejection, is the caller's job.
 */
export function useBurnCompletionTracker(
  nodes: readonly ParsedManeuverNode[],
  removeNode: (nodeId: string) => void,
): UseBurnCompletionTrackerResult {
  const [completedNodes, setCompletedNodes] = useState<
    ReadonlyMap<number, CompletedEntry>
  >(() => new Map());
  const maxDvByUt = useRef<Map<number, number>>(new Map());
  // Read inside the removal timeout, which would otherwise close over a stale list.
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
          // Re-read rather than captured, so a node the operator already removed during the hold is not asked to be removed again.
          if (live) removeNode(live.id);
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
