/**
 * Network is the seam the Courier queries for point-to-point delay and
 * reachability between a Vantage (observer, e.g. "KSC") and a node (e.g. a
 * vessel id). Point-to-point only (D2): a scalar delay + a boolean
 * reachability per (vantage, node) pair. No contact-plan / routing / moving
 * relays — that's M3b.
 */
export interface Network {
  /** One-way light-time seconds from `vantage` to `node`. */
  delayTo(vantage: string, node: string): number;
  /** Whether `node` is currently reachable from `vantage`. */
  reachable(vantage: string, node: string): boolean;
}

/**
 * Scriptable point-to-point network model for tests and the reference
 * delay engine. Every (vantage, node) pair defaults to a fixed delay and
 * reachability (0 / true unless overridden via the constructor); individual
 * pairs can be pinned to specific values with `setDelay` / `setReachable`.
 *
 * Pairs are keyed with a nested Map (vantage -> node -> value) rather than
 * naive string concatenation, so there's no collision between e.g.
 * ("ab", "c") and ("a", "bc").
 *
 * A global `scale` (light-speed / delay-scale config) multiplies every
 * `delayTo` result — the per-pair value above is the *base* delay, scaled
 * on read. `scale = 1` (the default) is unscaled, unchanged Task 3
 * behavior. `scale = 0` zeroes every pair's delay regardless of base
 * (light is instant), which is what collapses the whole M3 courier/archive
 * stack to M2-equivalent immediate delivery. `reachable` is never scaled —
 * it's a separate, binary axis.
 */
export class StubNetwork implements Network {
  private readonly defaultDelay: number;
  private readonly defaultReachable: boolean;
  private readonly delays = new Map<string, Map<string, number>>();
  private readonly reachability = new Map<string, Map<string, boolean>>();
  private scale: number;

  constructor(defaults?: { delay?: number; reachable?: boolean }, scale = 1) {
    this.defaultDelay = defaults?.delay ?? 0;
    this.defaultReachable = defaults?.reachable ?? true;
    this.scale = Math.max(0, scale);
  }

  delayTo(vantage: string, node: string): number {
    const baseDelay = this.delays.get(vantage)?.get(node) ?? this.defaultDelay;
    return baseDelay * this.scale;
  }

  /** Set the global delay-scale multiplier applied to every `delayTo` pair (0 = instant, 1 = unscaled, N = N times base delay). Negative values clamp to 0 — a negative scale would schedule deliveries in the past. */
  setScale(scale: number): void {
    this.scale = Math.max(0, scale);
  }

  reachable(vantage: string, node: string): boolean {
    return this.reachability.get(vantage)?.get(node) ?? this.defaultReachable;
  }

  setDelay(vantage: string, node: string, seconds: number): void {
    StubNetwork.set(this.delays, vantage, node, seconds);
  }

  setReachable(vantage: string, node: string, ok: boolean): void {
    StubNetwork.set(this.reachability, vantage, node, ok);
  }

  private static set<V>(
    map: Map<string, Map<string, V>>,
    vantage: string,
    node: string,
    value: V,
  ): void {
    let byNode = map.get(vantage);
    if (!byNode) {
      byNode = new Map<string, V>();
      map.set(vantage, byNode);
    }
    byNode.set(node, value);
  }
}
