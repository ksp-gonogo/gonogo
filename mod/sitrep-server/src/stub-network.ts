/**
 * Network is the seam the Courier queries for point-to-point delay and
 * reachability between a Vantage (observer, e.g. "KSC") and a node (e.g. a
 * vessel id). Point-to-point only (D2): a scalar delay + a boolean
 * reachability per (vantage, node) pair. No contact-plan / routing / moving
 * relays: that's M3b.
 */
export interface Network {
  /** One-way signal delay seconds from `vantage` to `node`. */
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
 * `delayTo` result: the per-pair value above is the *base* delay, scaled
 * on read. `scale = 1` (the default) is unscaled, unchanged Task 3
 * behavior. `scale = 0` zeroes every pair's delay regardless of base
 * (light is instant), which is what collapses the whole M3 courier/archive
 * stack to M2-equivalent immediate delivery. `reachable` is never scaled,
 * it's a separate, binary axis.
 *
 * A default of `Infinity` is unknown, and `setFallbackVantages` limits which
 * vantages the node rows and the default answer, so a vantage with no row of
 * its own reads unknown.
 */
export class StubNetwork implements Network {
  private defaultDelay: number;
  private readonly defaultReachable: boolean;
  private readonly delays = new Map<string, Map<string, number>>();
  private readonly vantageDelays = new Map<string, number>();
  private readonly nodeDelays = new Map<string, number>();
  private readonly reachability = new Map<string, Map<string, boolean>>();
  private fallbackVantages: Set<string> | null = null;
  private scale: number;

  /** `defaults.delay` is the whole-network default; `Infinity` makes it unknown (see `setDefaultDelay`). */
  constructor(defaults?: { delay?: number; reachable?: boolean }, scale = 1) {
    this.defaultDelay = defaults?.delay ?? 0;
    this.defaultReachable = defaults?.reachable ?? true;
    this.scale = Math.max(0, scale);
  }

  delayTo(vantage: string, node: string): number {
    // Resolution order: explicit (vantage, node) pair -> the vantage's own row
    // (setVantageDelay) -> node-level default (setNodeDelay) -> global default
    // (setDefaultDelay). The last two answer only the vantages
    // setFallbackVantages names; any other vantage is unknown.
    const baseDelay =
      this.delays.get(vantage)?.get(node) ??
      this.vantageDelays.get(vantage) ??
      (this.fallbackVantages === null || this.fallbackVantages.has(vantage)
        ? (this.nodeDelays.get(node) ?? this.defaultDelay)
        : Number.POSITIVE_INFINITY);
    // "Never" stays never whatever the scale: zero times it is not a number.
    return baseDelay === Number.POSITIVE_INFINITY
      ? baseDelay
      : baseDelay * this.scale;
  }

  /** Set the global delay-scale multiplier applied to every `delayTo` pair (0 = instant, 1 = unscaled, N = N times base delay). Negative values clamp to 0, a negative scale would schedule deliveries in the past. */
  setScale(scale: number): void {
    this.scale = Math.max(0, scale);
  }

  /** Set the fallback one-way delay returned by `delayTo` for any (vantage, node) pair with no row of its own. `Infinity` makes the fallback unknown: such a pair is delivered nothing. NaN and negative values clamp to 0 (a negative delay would schedule deliveries in the past, matching `setScale`'s clamp intent). */
  setDefaultDelay(seconds: number): void {
    if (seconds === Number.POSITIVE_INFINITY) {
      this.defaultDelay = seconds;
      return;
    }
    this.defaultDelay =
      Number.isNaN(seconds) || !Number.isFinite(seconds) || seconds < 0
        ? 0
        : seconds;
  }

  /** Set one delay from `vantage` to every node: the tier beneath the pair rows and above the node rows, for a vantage whose delay does not depend on what it observes. */
  setVantageDelay(vantage: string, seconds: number): void {
    this.vantageDelays.set(vantage, seconds);
  }

  /** Name the vantages the node rows and the whole-network default answer. Any other vantage with no pair or vantage row of its own reads `Infinity`, unknown. `null`, the default, lets them answer every vantage. */
  setFallbackVantages(vantages: Iterable<string> | null): void {
    this.fallbackVantages = vantages === null ? null : new Set(vantages);
  }

  /** Set the one-way delay for a node, applied for that node from any vantage without a per-(vantage, node) `setDelay` override. The per-vessel downlink primitive: each vessel node carries its own routed signal delay for the single KSC observer. NaN / infinite / negative clamp to 0 (matching `setDefaultDelay`). Plan 3 layers per-(vantage, node) overrides on top. */
  setNodeDelay(node: string, seconds: number): void {
    this.nodeDelays.set(
      node,
      Number.isNaN(seconds) || !Number.isFinite(seconds) || seconds < 0
        ? 0
        : seconds,
    );
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

  private static set<Entry>(
    map: Map<string, Map<string, Entry>>,
    vantage: string,
    node: string,
    value: Entry,
  ): void {
    let byNode = map.get(vantage);
    if (!byNode) {
      byNode = new Map<string, Entry>();
      map.set(vantage, byNode);
    }
    byNode.set(node, value);
  }
}
