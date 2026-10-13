import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import { useEffect, useRef, useState } from "react";
import {
  type BurnContext,
  type BurnWatch,
  burnFlown,
  watchBurn,
} from "./burnFlown";

export interface CompletedEntry {
  snapshot: ParsedManeuverNode;
  completedAt: number;
}

/** Wall-clock hold so the operator gets visual confirmation. Real time, not
 *  game time: timewarp would otherwise expire it instantly post-burn. */
export const COMPLETED_HOLD_MS = 10_000;

/**
 * Pure update step for the burn-completion state machine.
 *
 * - Updates `watches` in place with each node's frozen target, keyed by UT
 *   (stable across KSP renumbering on removal), and drops the watch of a node
 *   no longer in the plan.
 * - Returns the next `completedNodes` map: a node is added to it the first
 *   time the burn is found flown (see `burnFlown`). A node's own delta-v
 *   plays no part, so trimming a plan down never completes it.
 *
 * Returns the same `current` reference if no transitions happened, so React
 * can short-circuit re-renders.
 */
export function computeCompletionUpdate(
  current: ReadonlyMap<number, CompletedEntry>,
  nodes: readonly ParsedManeuverNode[],
  watches: Map<number, BurnWatch>,
  ctx: BurnContext,
  now: number,
): ReadonlyMap<number, CompletedEntry> {
  const present = new Set<number>();
  let next: Map<number, CompletedEntry> | null = null;
  for (const n of nodes) {
    present.add(n.UT);
    const watch = watchBurn(watches.get(n.UT), n, ctx);
    watches.set(n.UT, watch);
    if (current.has(n.UT)) continue;
    if (burnFlown(watch, n, ctx)) {
      if (next === null) next = new Map(current);
      next.set(n.UT, { snapshot: n, completedAt: now });
    }
  }
  for (const ut of watches.keys()) {
    if (!present.has(ut) && !current.has(ut)) watches.delete(ut);
  }
  return next ?? current;
}

interface UseBurnCompletionTrackerResult {
  /** Map keyed by UT: entries here render with the green-flash banner. */
  completedNodes: ReadonlyMap<number, CompletedEntry>;
  /** Each burn's watch keyed by UT: the orbit it was planned to reach and whether the craft was seen off it. Read by conformance so the two cannot disagree about whether a burn finished. */
  watches: ReadonlyMap<number, BurnWatch>;
}

/**
 * Tracks burns being flown and removes each after `COMPLETED_HOLD_MS` of
 * wall-clock time. `removeNode` receives the node's position in the latest
 * list, re-looked-up at fire time because KSP renumbers on every removal;
 * mapping it to the stream guid, and catching the send's rejection, is the
 * caller's job.
 */
export function useBurnCompletionTracker(
  nodes: readonly ParsedManeuverNode[],
  removeNode: (nodeId: string) => void,
  ctx: BurnContext,
): UseBurnCompletionTrackerResult {
  const [completedNodes, setCompletedNodes] = useState<
    ReadonlyMap<number, CompletedEntry>
  >(() => new Map());
  const watches = useRef<Map<number, BurnWatch>>(new Map());
  // Read inside the removal timeout, which would otherwise close over a stale list.
  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const { nowUt, current, thrust } = ctx;
  useEffect(() => {
    setCompletedNodes((done) =>
      computeCompletionUpdate(
        done,
        nodes,
        watches.current,
        { nowUt, current, thrust },
        Date.now(),
      ),
    );
  }, [nodes, nowUt, current, thrust]);

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
          setCompletedNodes((done) => {
            if (!done.has(ut)) return done;
            const next = new Map(done);
            next.delete(ut);
            return next;
          });
          watches.current.delete(ut);
        }, remaining),
      );
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [completedNodes, removeNode]);

  return { completedNodes, watches: watches.current };
}
