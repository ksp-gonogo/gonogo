/**
 * The dependency broker (Task 6): orders capability activation so that a
 * provider's declared `deps` are already active by the time its factory
 * runs (i.e. `ctx.query(dep)` inside the factory resolves successfully).
 *
 * This module is deliberately selection-agnostic: it consumes the *already
 * selected* provider(s) per capability (post version-gate, post
 * exclusive-conflict resolution) — see `Kernel.resolve()`, which runs
 * selection first, builds one `DependencyNode` per capability from the
 * winning provider(s)' `deps`, topo-sorts with `topoSortActivationOrder`,
 * and only then invokes factories in that order.
 */

import type { CapabilityId } from "./capability";
import { DependencyCycleError } from "./errors";

export interface DependencyNode {
  id: CapabilityId;
  /** Capabilities this node's selected provider(s) must see active first. */
  deps: CapabilityId[];
}

/**
 * Kahn's algorithm topo-sort over the capability dependency graph.
 *
 * - A dep naming a capability that isn't in `nodes` is not an edge (it isn't
 *   a graph node) — it doesn't block activation. Whatever depends on it will
 *   simply get a "not exactly one active provider" error from `ctx.query` at
 *   factory time if it actually calls query for that id; the broker doesn't
 *   pre-empt that.
 * - Deterministic: ties are broken by `nodes` order (registration order),
 *   never by Set/Map iteration of intermediate structures — the initial
 *   ready queue is seeded in `nodes` order, and nodes that become ready
 *   later are appended to that same FIFO queue in the order their
 *   dependencies clear.
 * - Throws `DependencyCycleError` (naming the cycle) if a cycle prevents a
 *   full ordering.
 */
export function topoSortActivationOrder(
  nodes: readonly DependencyNode[],
): CapabilityId[] {
  const knownIds = new Set(nodes.map((n) => n.id));
  const dependents = new Map<CapabilityId, CapabilityId[]>();
  const inDegree = new Map<CapabilityId, number>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    dependents.set(node.id, []);
  }

  for (const node of nodes) {
    for (const dep of node.deps) {
      if (!knownIds.has(dep)) {
        // Dep on a capability that isn't part of this graph (never
        // registered) — not an edge; not this broker's problem.
        continue;
      }
      dependents.get(dep)?.push(node.id);
      inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
    }
  }

  const queue: CapabilityId[] = nodes
    .filter((n) => inDegree.get(n.id) === 0)
    .map((n) => n.id);
  const order: CapabilityId[] = [];

  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    order.push(current);

    for (const dependent of dependents.get(current) ?? []) {
      const remaining = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, remaining);
      if (remaining === 0) {
        queue.push(dependent);
      }
    }
  }

  if (order.length !== nodes.length) {
    const orderedSet = new Set(order);
    const remainingIds = nodes
      .map((n) => n.id)
      .filter((id) => !orderedSet.has(id));
    throw new DependencyCycleError(findCycle(remainingIds, nodes, knownIds));
  }

  return order;
}

/**
 * DFS cycle finder, scoped to the nodes that Kahn's algorithm couldn't order
 * (i.e. everything left over is part of, or feeds into, at least one cycle).
 * Walks each node's `deps` edges directly (the "depends on" direction) using
 * a visiting/visited marker, so the returned path is an actual dependency
 * chain that loops back on itself — useful in the thrown error message.
 */
function findCycle(
  remainingIds: readonly CapabilityId[],
  nodes: readonly DependencyNode[],
  knownIds: ReadonlySet<CapabilityId>,
): CapabilityId[] {
  const depsById = new Map(nodes.map((n) => [n.id, n.deps]));
  const remainingSet = new Set(remainingIds);
  const visiting = new Set<CapabilityId>();
  const visited = new Set<CapabilityId>();
  const stack: CapabilityId[] = [];

  const dfs = (id: CapabilityId): CapabilityId[] | undefined => {
    visiting.add(id);
    stack.push(id);

    for (const dep of depsById.get(id) ?? []) {
      if (!knownIds.has(dep) || !remainingSet.has(dep)) {
        continue;
      }
      if (visiting.has(dep)) {
        const startIndex = stack.indexOf(dep);
        return [...stack.slice(startIndex), dep];
      }
      if (!visited.has(dep)) {
        const found = dfs(dep);
        if (found) {
          return found;
        }
      }
    }

    visiting.delete(id);
    visited.add(id);
    stack.pop();
    return undefined;
  };

  for (const id of remainingIds) {
    if (visited.has(id)) {
      continue;
    }
    const found = dfs(id);
    if (found) {
      return found;
    }
  }

  // Should be unreachable (Kahn's algorithm only leaves nodes that are part
  // of some cycle) — fall back to naming everything left over.
  return [...remainingIds];
}
