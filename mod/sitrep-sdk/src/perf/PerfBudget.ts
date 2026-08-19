// The host-routed logger shim, not `@ksp-gonogo/logger`'s singleton: a bundled
// second copy of that is console-only and never reaches the shared ring buffer or
// Axiom. Only touched on an actual breach, so a budget constructed at module
// scope never needs a host to exist yet.
import { hasHost } from "../api/host";
import { logger } from "../api/logger";

/**
 * The single global slot the budget registry lives in. A string key rather than a
 * symbol so two different builds of this package still find the same Set.
 */
const PERF_BUDGET_REGISTRY_KEY = "__GONOGO_PERF_BUDGETS__" as const;

/**
 * Soft performance budget. Tracks an event-rate (or volume per second)
 * over a rolling window and emits a warn-level log when the threshold is
 * exceeded. Rate-limited so a sustained overrun emits at most one log per
 * window.
 *
 * Use this for hot paths where a regression would silently degrade the
 * experience: bytes/sec on the PeerJS broadcast, writes/sec to
 * localStorage, etc. The warning is informational; the budget is *soft*
 * (no throw, no behavioural change). Tests can also call `rate()` to
 * make explicit assertions about steady-state cost.
 *
 * Cost: one `Date.now()` and a small array push per `record()`. Window
 * trim is amortised O(1), events are appended in order, so we just
 * walk from the front while the head is older than the window.
 */

export interface PerfBudgetOptions {
  /** Human-readable label used in the warning message. */
  name: string;
  /** Rolling window in ms. Default 1000 (i.e. budget = "per second"). */
  windowMs?: number;
  /**
   * Threshold per window. The total summed amount across all `record()`
   * calls in the current window must stay <= this value. When it
   * exceeds, a warn fires (rate-limited to one per window).
   */
  threshold: number;
  /** Suffix for the warning message: "events", "bytes", "writes" etc. */
  unit?: string;
}

interface Event {
  t: number;
  n: number;
}

export class PerfBudget {
  private readonly opts: Required<PerfBudgetOptions>;
  private events: Event[] = [];
  private headIdx = 0;
  private currentSum = 0;
  private lastWarnAt = 0;
  private exceedanceCount = 0;

  constructor(opts: PerfBudgetOptions) {
    this.opts = {
      windowMs: opts.windowMs ?? 1000,
      unit: opts.unit ?? "events",
      ...opts,
    };
    PerfBudget.registry.add(this);
  }

  /**
   * Record one event of `amount` units (default 1). Triggers a warn
   * when the windowed sum exceeds the budget; the warn is throttled so
   * a sustained overrun logs once per window, not on every record call.
   */
  record(amount = 1, now: number = Date.now()): void {
    this.events.push({ t: now, n: amount });
    this.currentSum += amount;
    this.trim(now);
    if (this.currentSum > this.opts.threshold) {
      this.exceedanceCount++;
      if (now - this.lastWarnAt >= this.opts.windowMs) {
        this.lastWarnAt = now;
        const context = {
          observed: this.currentSum,
          threshold: this.opts.threshold,
          windowMs: this.opts.windowMs,
          unit: this.opts.unit,
          // Total times we've crossed the threshold since the budget was
          // created: useful for spotting flapping vs sustained issues.
          exceedanceCount: this.exceedanceCount,
        };
        // Host-gated, and it has to be. The shim throws a named error when no
        // host is installed, which is right for `registerComponent` and very
        // wrong here: this is the DIAGNOSTIC path of a budget being breached, and
        // a warning that takes down the thing it is observing is worse than no
        // warning. A budget is constructed at module scope and recorded against
        // from hot paths, both of which can run long before any host exists.
        if (hasHost()) {
          logger.warn(`[perf-budget] ${this.opts.name} exceeded`, context);
        } else {
          console.warn(`[perf-budget] ${this.opts.name} exceeded`, context);
        }
      }
    }
  }

  /** Current windowed total (events × amount). Useful in tests. */
  rate(now: number = Date.now()): number {
    this.trim(now);
    return this.currentSum;
  }

  /** How many times the threshold has been exceeded since construction. */
  getExceedanceCount(): number {
    return this.exceedanceCount;
  }

  /** Reset all counters. Test-only. */
  reset(): void {
    this.events = [];
    this.headIdx = 0;
    this.currentSum = 0;
    this.lastWarnAt = 0;
    this.exceedanceCount = 0;
  }

  /**
   * Clear the rolling-window content (drops `rate()` back to 0) without
   * touching the exceedance counter or warn-throttle state. Used by the
   * test gate to give each test a fresh window, burst counts from one
   * test then don't bleed into the next.
   */
  resetWindow(): void {
    this.events = [];
    this.headIdx = 0;
    this.currentSum = 0;
    this.lastWarnAt = 0;
  }

  /** Read-only metadata. */
  get name(): string {
    return this.opts.name;
  }
  get threshold(): number {
    return this.opts.threshold;
  }
  get windowMs(): number {
    return this.opts.windowMs;
  }
  get unit(): string {
    return this.opts.unit;
  }

  private trim(now: number): void {
    const cutoff = now - this.opts.windowMs;
    while (this.headIdx < this.events.length) {
      const e = this.events[this.headIdx];
      if (e.t >= cutoff) break;
      this.currentSum -= e.n;
      this.headIdx++;
    }
    // Periodically compact the underlying array so it doesn't grow
    // unbounded (we only ever push and never splice the front in the
    // hot path).
    if (this.headIdx > 256 && this.headIdx > this.events.length / 2) {
      this.events = this.events.slice(this.headIdx);
      this.headIdx = 0;
    }
  }

  // ── Static registry ───────────────────────────────────────────────────────

  /**
   * Every PerfBudget self-registers here on construction, which is what lets the
   * Perf Budgets widget list every rate in the app and what lets the test gate
   * below iterate all of them.
   *
   * Held on `globalThis`, not as a module-static `Set`.
   *
   * It was a module static, and that was safe only while this class lived in
   * `@ksp-gonogo/core`, which an Uplink cannot bundle. Published from the sdk it
   * would be the textbook second-copy-of-a-registry failure: a bundled Uplink
   * registers its budgets into its own `Set`, the widget lists the app's, and the
   * Uplink's budgets are simply invisible with nothing raising a word. Same
   * mechanism, same reason, as `GONOGO_HOST_KEY`.
   *
   * This is why `GonogoHost.createPerfBudget` exists, and it stays: it is the
   * documented author-facing route and costs nothing. The difference is that
   * reaching the class directly is no longer a silent trap, which matters because
   * a budget is constructed at MODULE SCOPE (`const B = new PerfBudget(...)`) and
   * so cannot go through a host that may not be installed yet.
   */
  private static get registry(): Set<PerfBudget> {
    const g = globalThis as unknown as {
      [PERF_BUDGET_REGISTRY_KEY]?: Set<PerfBudget>;
    };
    g[PERF_BUDGET_REGISTRY_KEY] ??= new Set<PerfBudget>();
    return g[PERF_BUDGET_REGISTRY_KEY];
  }

  static getAll(): readonly PerfBudget[] {
    return [...PerfBudget.registry];
  }

  /** Test-only: clears the registry. Doesn't dispose existing instances. */
  static clearRegistry(): void {
    PerfBudget.registry.clear();
  }

  /**
   * Vitest-only hook. Each test snapshots every budget's exceedance
   * count in `beforeEach`; the matching `afterEach` fails the test if
   * any budget's count rose during the run. Call this from a setup file
   * (`setupFiles` in vitest.config) so it applies globally.
   *
   * Tests that intentionally exceed thresholds (the PerfBudget unit
   * suite, deliberately stress-y benchmarks) should either:
   *   - Clear the registry in their own `afterEach`, the gate then
   *     iterates over zero budgets and passes.
   *   - Call `b.reset()` on the affected budget at the end of the test
   *     so the diff is zero.
   *
   * The gate does nothing when `beforeEach` / `afterEach` aren't
   * available (i.e. outside a test runner).
   */
  static installTestGate(): void {
    type Hook = (cb: () => void | Promise<void>) => void;
    const before = (globalThis as unknown as { beforeEach?: Hook }).beforeEach;
    const after = (globalThis as unknown as { afterEach?: Hook }).afterEach;
    if (typeof before !== "function" || typeof after !== "function") return;

    let snapshot = new Map<string, number>();
    before(() => {
      // Reset the rolling-window content of every budget so a previous
      // test's burst doesn't bleed into this one. Keeps exceedance
      // counts for the diff at end of test.
      for (const b of PerfBudget.getAll()) b.resetWindow();
      snapshot = new Map(
        PerfBudget.getAll().map((b) => [b.name, b.getExceedanceCount()]),
      );
    });
    after(() => {
      const offenders: string[] = [];
      for (const b of PerfBudget.getAll()) {
        const prev = snapshot.get(b.name) ?? 0;
        const now = b.getExceedanceCount();
        if (now > prev) {
          offenders.push(
            `${b.name}: +${now - prev} exceedance${now - prev === 1 ? "" : "s"} (now ${now}, was ${prev}); rate=${b.rate()} threshold=${b.threshold}`,
          );
        }
      }
      if (offenders.length > 0) {
        throw new Error(
          `[perf-budget gate] one or more budgets exceeded their soft cap during this test. ` +
            `If the regression is real, fix it; if intentional, reset the budget at the end of the test.\n  - ` +
            offenders.join("\n  - "),
        );
      }
    });
  }
}
