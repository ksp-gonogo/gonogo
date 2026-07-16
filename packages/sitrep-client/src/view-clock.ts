import {
  type ClockFormulaInputs,
  type ClockFormulaSnapshot,
  computeConfirmedEdgeUt,
  computeUtNowEstimate,
} from "./view-clock-formula";

export type {
  ClockFormulaInputs,
  ClockFormulaSnapshot,
} from "./view-clock-formula";

/** Which regime `viewUt()` is currently drawn from — set via `ViewClock.setMode`. */
export type ViewClockMode = "confirmed" | "predicted";

/**
 * Whether a read sits at-or-before the certainty horizon (`"confirmed"`: a
 * delivered sample or an honest interpolation between two of them) or past
 * it (`"predicted"`: a propagated/held-last estimate). Rides
 * alongside a value/status the same way `StreamStatusValue` does — see
 * `TimelineStore.sampleCertainty`.
 */
export type Certainty = "confirmed" | "predicted";

/**
 * Estimator health, used to widen staleness margins — never to gate
 * confirmation itself. Only the `"locked"`/`"coasting"` split
 * (silence-based) is implemented today; `"degraded"` (a warp-rate change
 * detected during silence) is deferred.
 */
export type ViewClockConfidence = "locked" | "coasting" | "degraded";

export interface ViewClockOptions {
  /** One delay authority — the default is a fixed/zero delay; a real `DelayAuthority` can be swapped in. */
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
 * One per client — THE single view time. Fits a UT↔wall
 * relationship from delivered-sample observations, but the central
 * invariant holds: **the estimate only schedules; samples confirm**:
 *
 * `confirmedEdgeUt()` is clamped to the max `validAt` actually observed via
 * `observeSample`. A wrong or fast-running estimate can therefore only ever
 * make `confirmedEdgeUt()` LOWER than the raw estimate (display latency, or
 * a too-early `HeldStale` later on) — never higher than what's actually been
 * delivered. That is the one invariant every other feature (staleness,
 * media release, predicted-view) is built to never violate.
 *
 * Epoch-aware exactly like `ClientTimeline`: `observeSample`'s `epoch`
 * argument resets the fit + sample clamp + monotonic view cursor on a
 * rewind, and discards stale-epoch stragglers — the same per-epoch hygiene,
 * applied to the one clock instead of per-topic buffers.
 */
export class ViewClock {
  private modeValue: ViewClockMode = "confirmed";

  private epoch = 0;
  private anchorWall: number | undefined;
  private anchorUt: number | undefined;
  private maxSampleUt = Number.NEGATIVE_INFINITY;
  private lastObservedWall: number | undefined;
  /** Monotonic cursor for CONFIRMED mode only — deliberately not shared with predicted-mode reads, see `viewUt()`'s doc. */
  private lastConfirmedViewUt = Number.NEGATIVE_INFINITY;
  /** Manual history-scrub target, `null` = live. Set via `scrubTo`. */
  private scrubTarget: number | null = null;

  /** Which regime `viewUt()` is currently drawn from. */
  get mode(): ViewClockMode {
    return this.modeValue;
  }

  /**
   * Switch between the confirmed view (`viewUt() = confirmedEdgeUt()`, the
   * default) and the predicted-present view (`viewUt() = utNowEstimate()`).
   * Independent of `scrubTo` — a scrub target still wins
   * over either mode while active.
   */
  setMode(mode: ViewClockMode): void {
    this.modeValue = mode;
  }

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
      this.lastConfirmedViewUt = Number.NEGATIVE_INFINITY;
      this.anchorWall = undefined;
      this.anchorUt = undefined;
      // A scrub target from the dead pre-rewind timeline must not survive
      // — same per-epoch hygiene as every other reset here.
      this.scrubTarget = null;
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

  /** One delay authority — feeds media release too. */
  delaySeconds(): number {
    return this.options.delaySeconds?.() ?? 0;
  }

  /** Estimated "vessel now": a piecewise-linear UT(wall) fit, coasting on
   *  the last observed slope between observations. Delegates to the shared
   *  pure formula (`view-clock-formula.ts`) so a second context (the
   *  kerbcast per-frame video-delay worker) can mirror this exactly — see
   *  that module's doc. */
  utNowEstimate(): number {
    return computeUtNowEstimate(this.formulaInputs(), this.now());
  }

  /**
   * The certainty horizon: `min(utNowEstimate() - delaySeconds(), maxBufferedSampleUt + slack)`.
   * Never ahead of the max sample UT actually observed — see the class doc.
   * Returns `-Infinity` before any sample has ever been observed (nothing
   * confirmed yet — the "resynchronizing" state after a rewind). Delegates
   * to the shared pure formula — see `utNowEstimate()`'s doc.
   */
  confirmedEdgeUt(): number {
    return computeConfirmedEdgeUt(this.formulaInputs(), this.now());
  }

  /** This clock's formula inputs, as of right now — the shared shape both
   *  `utNowEstimate`/`confirmedEdgeUt` (via `view-clock-formula.ts`) and
   *  `snapshot()` (below) read from, so the two can never drift apart. */
  private formulaInputs(): ClockFormulaInputs {
    return {
      anchorWall: this.anchorWall,
      anchorUt: this.anchorUt,
      maxSampleUt: this.maxSampleUt,
      delaySeconds: this.delaySeconds(),
      warpRate: this.warpRate(),
      slackSeconds: this.options.slackSeconds ?? 0,
    };
  }

  /**
   * Serializable snapshot of this clock's formula inputs, for a SECOND
   * context to mirror `confirmedEdgeUt()`/`utNowEstimate()` locally against
   * its own wall clock — the kerbcast per-frame video-delay worker's "Clock
   * seam" (cross-browser kerbcast video-delay design, 2026-07-16). The
   * receiving side evaluates the exact same `view-clock-formula.ts`
   * functions this class uses, so there is one implementation, never a
   * fork. `epoch` lets a stale-epoch snapshot be discarded the same way
   * `observeSample` discards a stale-epoch straggler.
   */
  snapshot(): ClockFormulaSnapshot {
    return { epoch: this.epoch, ...this.formulaInputs() };
  }

  /**
   * The certainty horizon — a first-class alias for
   * `confirmedEdgeUt()`. A `viewUt` at-or-before this is CONFIRMED (a
   * delivered sample or an honest interpolation between two of them);
   * strictly after it is PREDICTED (propagated / held-last). It's the exact
   * same sample-clamped quantity as `confirmedEdgeUt()` — exposed under its
   * own name because callers (the SDK surface, `TimelineStore.beginFrame`'s
   * per-frame certainty classification) reason about it as a first-class
   * value, not as "confirmedEdgeUt renamed".
   */
  certaintyHorizonUt(): number {
    return this.confirmedEdgeUt();
  }

  /** Classify `ut` against the certainty horizon — `<=` is CONFIRMED, matching `viewUt() === confirmedEdgeUt()` exactly in confirmed mode (never falsely "predicted" while merely tracking live). */
  certaintyFor(ut: number): Certainty {
    return ut <= this.certaintyHorizonUt() ? "confirmed" : "predicted";
  }

  /**
   * Manual history scrub: pins `viewUt()` to `ut`
   * regardless of `mode`, for exploring history (a scrub bar). The live
   * cursor keeps advancing underneath while scrubbed (confirmed-edge
   * tracking / predicted estimate both keep updating from `observeSample`
   * and wall-clock flow) — so `scrubTo(null)` resumes live tracking with a
   * monotonic catch-up, picking up wherever the live cursor has reached by
   * then, never a backward jump. Cleared automatically on an epoch bump
   * (see `observeSample`) — a scrub target from a dead timeline must not
   * survive a rewind.
   */
  scrubTo(ut: number | null): void {
    this.scrubTarget = ut;
  }

  /**
   * THE view time — every read in a frame uses this (via the frozen
   * `FrameToken`, see `timeline-store.ts`).
   *
   * - **Confirmed mode** (default): tracks `confirmedEdgeUt()`, monotonic
   *   non-decreasing within an epoch (mirrors `Archive.ReadAtVantage`'s
   *   cursor clamp server-side) — the cursor resets to `-Infinity` on an
   *   epoch bump via `observeSample`, so "monotonic" is scoped per-epoch,
   *   not across a rewind.
   * - **Predicted mode**: tracks `utNowEstimate()`
   *   directly — deliberately NOT run through the confirmed cursor's
   *   monotonic clamp (`lastConfirmedViewUt`), so a predicted excursion can
   *   never leak forward and pin the confirmed cursor ahead of the real
   *   confirmed edge once the caller switches back to confirmed mode.
   * - **Scrubbed** (either mode): `scrubTo`'s target wins outright, but the
   *   live cursor for whichever mode is active still advances underneath
   *   (see `scrubTo`'s doc).
   */
  viewUt(): number {
    let live: number;
    if (this.modeValue === "predicted") {
      live = this.utNowEstimate();
    } else {
      const edge = this.confirmedEdgeUt();
      live = Math.max(this.lastConfirmedViewUt, edge);
      this.lastConfirmedViewUt = live;
    }
    return this.scrubTarget !== null ? this.scrubTarget : live;
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
