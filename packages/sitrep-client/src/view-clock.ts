/** Which regime `viewUt()` is currently drawn from. Predicted mode lands in a later task (T4/T5); T2 only ever runs `"confirmed"`. */
export type ViewClockMode = "confirmed" | "predicted";

/**
 * Estimator health, used by later tasks to widen staleness margins
 * (M2 design §4.3/§7.1) — never to gate confirmation itself. T2 implements
 * only the `"locked"`/`"coasting"` split (silence-based); `"degraded"`
 * (a warp-rate change detected during silence) is deferred.
 */
export type ViewClockConfidence = "locked" | "coasting" | "degraded";

export interface ViewClockOptions {
  /** One delay authority (M2 design §1.2) — M2 default is a fixed/zero delay; later tasks swap in a real `DelayAuthority`. */
  delaySeconds?: () => number;
  /** UT-per-wall-second slope. Default 1 (real-time, no warp modelling yet — a later task feeds the real `time.warp` channel). */
  warpRate?: () => number;
  /** Injectable wall clock (seconds), defaulting to `performance.now() / 1000`. Tests inject a controllable one. */
  nowWall?: () => number;
  /** Small slack added to the sample-clamp side of `confirmedEdgeUt`'s min(). Default 0 — keep the clamp tight/exact for testability; a later task may widen it for jitter tolerance. */
  slackSeconds?: number;
  /** Wall-seconds of silence (no `observeSample`) before `confidence()` reports `"coasting"`. Default 5. */
  coastingAfterSeconds?: number;
}

function defaultNowWall(): number {
  return performance.now() / 1000;
}

/**
 * One per client — THE single view time (M2 design §1.2). Fits a UT↔wall
 * relationship from delivered-sample observations, but — per the design's
 * central insight (§0) — **the estimate only schedules; samples confirm**:
 *
 * `confirmedEdgeUt()` is clamped to the max `validAt` actually observed via
 * `observeSample`. A wrong or fast-running estimate can therefore only ever
 * make `confirmedEdgeUt()` LOWER than the raw estimate (display latency, or
 * a too-early `HeldStale` later on) — never higher than what's actually been
 * delivered. That is the one invariant every other M2 feature (staleness,
 * media release, predicted-view) is built to never violate.
 *
 * Epoch-aware exactly like `ClientTimeline`: `observeSample`'s `epoch`
 * argument resets the fit + sample clamp + monotonic view cursor on a
 * rewind, and discards stale-epoch stragglers — the same per-epoch hygiene,
 * applied to the one clock instead of per-topic buffers.
 */
export class ViewClock {
  readonly mode: ViewClockMode = "confirmed";

  private epoch = 0;
  private anchorWall: number | undefined;
  private anchorUt: number | undefined;
  private maxSampleUt = Number.NEGATIVE_INFINITY;
  private lastObservedWall: number | undefined;
  private lastViewUt = Number.NEGATIVE_INFINITY;

  constructor(private readonly options: ViewClockOptions = {}) {}

  /**
   * Feed one delivered sample's timing into the UT↔wall fit and the sample
   * clamp. Call this for every delivered sample on every topic (not just
   * one) — it's what lets `confirmedEdgeUt` know "the max buffered sample
   * UT" without itself owning any per-topic buffer.
   */
  observeSample(validAt: number, deliveredAt: number, epoch = 0): void {
    if (epoch < this.epoch) return; // stale-epoch straggler, discard
    if (epoch > this.epoch) {
      this.epoch = epoch;
      this.maxSampleUt = Number.NEGATIVE_INFINITY;
      this.lastViewUt = Number.NEGATIVE_INFINITY;
      this.anchorWall = undefined;
      this.anchorUt = undefined;
    }

    const wallNow = this.now();
    this.anchorWall = wallNow;
    this.anchorUt = deliveredAt;
    this.lastObservedWall = wallNow;
    if (validAt > this.maxSampleUt) this.maxSampleUt = validAt;
  }

  /** The client's epoch generation — bumped by `observeSample` on a rewind. Read-only mirror of `ClientTimeline.epoch`'s reset generation. */
  getEpoch(): number {
    return this.epoch;
  }

  /** One delay authority — feeds media release too (M2 design §5). */
  delaySeconds(): number {
    return this.options.delaySeconds?.() ?? 0;
  }

  /** Estimated "vessel now": a piecewise-linear UT(wall) fit, coasting on the last observed slope between observations. */
  utNowEstimate(): number {
    if (this.anchorWall === undefined || this.anchorUt === undefined) {
      return this.maxSampleUt === Number.NEGATIVE_INFINITY
        ? 0
        : this.maxSampleUt;
    }
    const elapsed = this.now() - this.anchorWall;
    return this.anchorUt + elapsed * this.warpRate();
  }

  /**
   * The certainty horizon: `min(utNowEstimate() - delaySeconds(), maxBufferedSampleUt + slack)`.
   * Never ahead of the max sample UT actually observed — see the class doc.
   * Returns `-Infinity` before any sample has ever been observed (nothing
   * confirmed yet — the "resynchronizing" state after a rewind, per §3.4).
   */
  confirmedEdgeUt(): number {
    if (this.maxSampleUt === Number.NEGATIVE_INFINITY)
      return Number.NEGATIVE_INFINITY;
    const estimatedEdge = this.utNowEstimate() - this.delaySeconds();
    const sampleClamp = this.maxSampleUt + (this.options.slackSeconds ?? 0);
    return Math.min(estimatedEdge, sampleClamp);
  }

  /**
   * THE view time — every read in a frame uses this (via the frozen
   * `FrameToken`, see `timeline-store.ts`). In confirmed mode (T2's only
   * mode) this tracks `confirmedEdgeUt()`, monotonic non-decreasing within
   * an epoch (mirrors `Archive.ReadAtVantage`'s cursor clamp server-side) —
   * the cursor itself resets to `-Infinity` on an epoch bump via
   * `observeSample`, so "monotonic" is scoped per-epoch, not across a
   * rewind.
   */
  viewUt(): number {
    const edge = this.confirmedEdgeUt();
    const next = Math.max(this.lastViewUt, edge);
    this.lastViewUt = next;
    return next;
  }

  /** Estimator health — `"locked"` recently observed, `"coasting"` during silence. `"degraded"` (warp-change-during-silence) is a later task. */
  confidence(): ViewClockConfidence {
    if (this.lastObservedWall === undefined) return "coasting";
    const silence = this.now() - this.lastObservedWall;
    return silence > (this.options.coastingAfterSeconds ?? 5)
      ? "coasting"
      : "locked";
  }

  /**
   * Best-effort per-frame notification, driven by `requestAnimationFrame`
   * when available (browser) and a ~60Hz timer fallback otherwise (SSR/test
   * environments without rAF). NOT what enforces the single-view-time
   * invariant — that's `TimelineStore`'s frozen `FrameToken` (structural);
   * this is just a convenience scheduling hook for callers that want to
   * drive `TimelineStore.beginFrame()` from wall-clock frames.
   */
  onFrame(cb: (viewUt: number) => void): () => void {
    const hasRaf = typeof requestAnimationFrame === "function";
    let cancelled = false;
    let handle: number | ReturnType<typeof setTimeout>;

    const tick = () => {
      if (cancelled) return;
      cb(this.viewUt());
      handle = hasRaf ? requestAnimationFrame(tick) : setTimeout(tick, 16);
    };

    handle = hasRaf ? requestAnimationFrame(tick) : setTimeout(tick, 16);

    return () => {
      cancelled = true;
      if (hasRaf) cancelAnimationFrame(handle as number);
      else clearTimeout(handle as ReturnType<typeof setTimeout>);
    };
  }

  private now(): number {
    return (this.options.nowWall ?? defaultNowWall)();
  }

  private warpRate(): number {
    return this.options.warpRate?.() ?? 1;
  }
}
