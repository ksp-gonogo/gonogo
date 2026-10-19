/**
 * The presentation pacer: the actual jank fix (cross-browser video-delay design, 2026-07-16, finding F3 + "Paced release"). Moving the
 * frame-delay pipeline into a Worker does not by itself fix the reported
 * stutter: `ViewClock.confirmedEdgeUt()` is sample-clamped
 * (`min(utNowEstimate() - delaySeconds, maxSampleUt + slackSeconds)`, with
 * `slackSeconds` defaulting to 0), so in the sample-limited regime the edge
 * steps at telemetry sample cadence (~10Hz), not video frame cadence
 * (~30fps). `DelayedPlayoutBuffer.onRelease` fires for every queued frame
 * whose `ut` is now at-or-before the edge, in one synchronous pass, so an
 * edge step releases a burst of several video frames at once, then nothing
 * for ~100ms. That burst-then-silence pattern, not main-thread contention,
 * is the stutter.
 *
 * This class sits between `DelayedPlayoutBuffer`'s release and the actual
 * sink write (wired in via `runFrameDelayPipeline`'s optional `pacing`
 * option: see `frame-delay.ts`). It re-times a burst of already-CONFIRMED
 * frames so they present spaced by their own UT deltas, instead of all at
 * once. This can only ever add latency, never remove it, every frame
 * handed to `submit()` already passed `DelayedPlayoutBuffer`'s
 * `confirmedEdgeUt()` gate, so pacing never reveals a frame the clock
 * hasn't confirmed yet (the "estimate only schedules; samples confirm"
 * invariant, see `DelayedPlayoutBuffer`'s doc: holds exactly as before;
 * this class only ever delays what's already been released, it is not a
 * second release-gate).
 *
 * Driven externally via `tick(nowWall)` rather than owning its own timer,
 * matches this codebase's existing "manual clock, explicit pump()" testing
 * convention (`DelayedPlayoutBuffer.pump()`), and lets both the Chrome
 * main-thread backend (driven from `requestAnimationFrame`) and the
 * worker-hosted backend (driven from its own ~60Hz poll loop) share this one
 * implementation without either owning a scheduling mechanism themselves.
 *
 * **A UT-second delta is not a wall-second delay, and the difference is the
 * rate.** Spacing frames by their own UT deltas re-imposes the source's grid on
 * the presentation, whatever cadence the frames actually reached this pacer at,
 * which is wrong the moment the two differ. A transmitter and a listener whose
 * separation is changing are exactly that case: chunks stamped 20 ms apart do
 * not become audible 20 ms apart, they bunch up while the separation closes and
 * spread while it opens, and a pacer that re-spaces them onto the 20 ms grid
 * erases that. Left alone it does not distort anything audibly, it accrues:
 * the queue grows, or the anchor drifts until the backlog check snaps and drops
 * audio, over a long transmission rather than at any one instant.
 *
 * So the caller may hand `submit()` the wall instant a frame arrived, and the
 * pacer measures wall-seconds-per-UT-second across the arrivals it has seen and
 * scales its spacing by it, which is what an RTP receiver's playout clock does
 * with the sender's timestamps. Passing no arrival instant leaves the rate at
 * 1:1 and the behaviour exactly as it was.
 *
 * The measurement is a long baseline (first arrival to latest) rather than a
 * gap between consecutive arrivals, because `DelayedPlayoutBuffer` releases in
 * bursts: several frames share one arrival instant, so a short window reads a
 * rate near zero. It is also clamped to a narrow band around 1:1, which is what
 * keeps the warp promise: real doppler in this game is parts per hundred
 * thousand, so the band never fights a true separation rate, while the slowest
 * warp step is 2x and lands far outside it. Under warp the pacer therefore
 * keeps presenting at natural rate and lets the backlog grow and be reported,
 * which is the documented position rather than a new one.
 */

/**
 * One frame handed to the pacer: its capture UT (for spacing) and payload.
 * Useful for presenting video or audio at the intervals it was captured at.
 * Taken by {@link PresentationPacer.submit}.
 *
 * @category Delayed video
 */
export interface PacedFrame<Frame> {
  /** The UT the frame was captured at. */
  ut: number;
  /** The frame. */
  data: Frame;
  /**
   * Whether the frame can be decoded without any frame before it. Read only
   * when the pacer is built with `gopSafeSkip`.
   */
  keyframe?: boolean;
}

/**
 * Options for a new {@link PresentationPacer}: the callbacks that present and
 * skip frames, and the limits on backlog and playout rate. Useful for keeping
 * the video frames the operator sees at an even rate after a delay releases
 * them together. Used by the video delay pipelines.
 *
 * @category Delayed video
 */
export interface PresentationPacerOptions<Frame> {
  /**
   * Called, in order, for each frame due at the `nowWall` passed to `tick()`.
   * Writing the frame out is the caller's job.
   */
  onPresent(frame: PacedFrame<Frame>): void;
  /**
   * Called for each frame skipped to catch up, which never reaches `onPresent`.
   * Supply it whenever a frame holds something that must be closed, such as a
   * `VideoFrame`.
   */
  onSkip?(frame: PacedFrame<Frame>): void;
  /**
   * How far, in wall-clock seconds, `tick()` may run past the oldest queued
   * frame's due time before the pacer skips straight to the newest frame, so a
   * live feed does not fall further and further behind.
   */
  maxBacklogSeconds: number;
  /**
   * How far ahead of now, in wall-clock seconds, the newest queued frame may be
   * due. Past it the pacer shows that frame at once and drops the ones before
   * it: the source's clock is running faster than its frames can be shown at
   * their own spacing, as under time warp, or it has jumped forward. Set it
   * above the longest burst the source releases together. Unset, there is no
   * limit, which suits a source whose frames must all be played, such as a
   * radio transmission.
   */
  maxLeadSeconds?: number;
  /**
   * How many UT seconds of arrivals the pacer measures before it trusts the
   * measured rate. Until then it spaces frames at 1:1.
   */
  rateBaselineSeconds?: number;
  /**
   * How far from 1:1 the measured rate may be, as a fraction. Outside that, the
   * pacer uses the nearer limit.
   */
  maxRateDeparture?: number;
  /**
   * Set for encoded video, where a frame between keyframes cannot be decoded
   * without the frames before it. Catching up then never presents a frame whose
   * references were skipped: it jumps to the newest keyframe in the queue and
   * keeps every frame after it, and with no keyframe queued it presents the
   * whole queue at once and skips nothing. Each submitted frame must set
   * `keyframe`.
   */
  gopSafeSkip?: boolean;
}

/** See `PresentationPacerOptions.rateBaselineSeconds`: ten frames of a 20 ms
 *  audio grid, two of a 10 Hz release burst. */
const DEFAULT_RATE_BASELINE_SECONDS = 0.2;

/** See `PresentationPacerOptions.maxRateDeparture`: a fifth, comfortably above
 *  every real separation rate and comfortably below the 0.5 that the slowest
 *  time warp produces. */
const DEFAULT_MAX_RATE_DEPARTURE = 0.2;

/**
 * Spaces out frames that were released together, so they are shown at the
 * intervals they were captured at rather than all at once. It only ever delays a
 * frame, never shows one early. Drive it by calling `tick` with the wall-clock
 * time. Useful for keeping delayed video and radio audio smooth when the
 * telemetry clock releases them in bursts. Used by the radio session and by the
 * video delay pipeline.
 *
 * @category Delayed video
 */
export class PresentationPacer<Frame> {
  private queue: PacedFrame<Frame>[] = [];
  /** The (ut, wall) pair the next queued frame's due time is computed
   *  relative to: either the last frame this pacer actually presented, or
   *  `null` before the first one ever (in which case the next frame is due
   *  immediately, at whatever `nowWall` the next `tick()` supplies). */
  private lastPresented: { ut: number; wall: number } | null = null;
  /**
   * The two ends of the arrival baseline the playout rate is measured over.
   *
   * The anchor settles on the first arrival instant and stays there, so the
   * estimate spans this pacer's whole life. That suits a pacer whose life is one
   * transmission, which is how the radio builds them; one kept alive
   * indefinitely would want a sliding window and does not have one, which is the
   * other half of why arrival instants are opt-in per `submit()`.
   */
  private arrivalAnchor: { ut: number; wall: number } | null = null;
  private arrivalLatest: { ut: number; wall: number } | null = null;

  constructor(private readonly opts: PresentationPacerOptions<Frame>) {}

  /**
   * Queue one already-confirmed frame. Does not present it, that only happens
   * from `tick()`, once its computed due time has arrived.
   *
   * `arrivedWall` is the wall instant this frame reached the pacer, on the same
   * clock `tick()` reads. Supplying it turns on the measured playout rate (see
   * the class doc); omitting it leaves spacing at 1:1.
   */
  submit(frame: PacedFrame<Frame>, arrivedWall?: number): void {
    this.queue.push(frame);
    if (arrivedWall === undefined) return;
    const arrival = { ut: frame.ut, wall: arrivedWall };
    /*
     * Both ends of the baseline are the FURTHEST point of the source timeline
     * delivered as of their own wall instant, which is why the anchor keeps
     * moving while the first arrival instant is still the latest one. Pairing a
     * first-of-burst against a last-of-burst instead biases the span by one
     * burst's worth of UT, a fixed error that a longer baseline only dilutes.
     */
    if (this.arrivalAnchor === null || arrivedWall <= this.arrivalAnchor.wall) {
      this.arrivalAnchor = arrival;
    }
    this.arrivalLatest = arrival;
  }

  /**
   * Wall seconds one UT second of the source's timeline is arriving over.
   *
   * 1 until there is a baseline worth reading, so a stream that supplies no
   * arrival instants, or has not yet run long enough, paces exactly as before.
   */
  private playoutRate(): number {
    const anchor = this.arrivalAnchor;
    const latest = this.arrivalLatest;
    if (anchor === null || latest === null) return 1;
    const utSpan = latest.ut - anchor.ut;
    const wallSpan = latest.wall - anchor.wall;
    const baseline =
      this.opts.rateBaselineSeconds ?? DEFAULT_RATE_BASELINE_SECONDS;
    if (utSpan < baseline || wallSpan <= 0) return 1;
    const departure = this.opts.maxRateDeparture ?? DEFAULT_MAX_RATE_DEPARTURE;
    const measured = wallSpan / utSpan;
    return Math.min(Math.max(measured, 1 - departure), 1 + departure);
  }

  private dueWallFor(
    frame: PacedFrame<Frame>,
    nowWall: number,
    rate: number,
  ): number {
    return this.lastPresented
      ? this.lastPresented.wall + (frame.ut - this.lastPresented.ut) * rate
      : nowWall; // nothing presented yet this session, present immediately
  }

  /** Drain whatever's due at `nowWall` (same wall-clock basis every call
   *  uses, the caller's own clock). Call this on every tick of the
   *  caller's ~60Hz loop. */
  tick(nowWall: number): void {
    if (this.queue.length === 0) return;

    // One reading per tick, so every frame drained in this pass is spaced on the same rate rather than on one that moved underneath the loop.
    const rate = this.playoutRate();

    const head = this.queue[0];
    const newest = this.queue[this.queue.length - 1];
    if (head === undefined || newest === undefined) return;
    const headDue = this.dueWallFor(head, nowWall, rate);
    const lead = this.dueWallFor(newest, nowWall, rate) - nowWall;
    /*
     * Too far behind, or too far ahead. Either way the queue cannot be shown at
     * its own spacing, so the newest frame is shown now and the rest are handed
     * to `onSkip` to be closed, never presented.
     */
    if (
      nowWall - headDue > this.opts.maxBacklogSeconds ||
      lead > (this.opts.maxLeadSeconds ?? Number.POSITIVE_INFINITY)
    ) {
      if (this.opts.gopSafeSkip) this.catchUpWithoutBreakingReferences(nowWall);
      else this.skipToNewest(newest, nowWall);
      return;
    }

    while (this.queue.length > 0) {
      const next = this.queue[0];
      if (next === undefined) break;
      const due = this.dueWallFor(next, nowWall, rate);
      if (nowWall < due) break; // not due yet, wait for a later tick
      this.queue.shift();
      this.opts.onPresent(next);
      // Anchor at the SCHEDULED due time, not the actual `nowWall` a tick
      // happened to land on: keeps spacing exact (each frame `deltaUT × rate`
      // apart) even when `tick()` calls are irregular, rather than
      // compounding jitter from one frame to the next.
      this.lastPresented = { ut: next.ut, wall: due };
    }
  }

  private skipToNewest(newest: PacedFrame<Frame>, nowWall: number): void {
    for (const dropped of this.queue) {
      if (dropped !== newest) this.opts.onSkip?.(dropped);
    }
    this.queue = [];
    this.opts.onPresent(newest);
    this.lastPresented = { ut: newest.ut, wall: nowWall };
  }

  /*
   * The newest keyframe is shown now and the frames after it stay queued, due
   * on their own spacing from it, so every frame the decoder sees still has its
   * references. With no keyframe queued nothing can be skipped safely, so the
   * queue is shown at once, which costs a burst and no frames.
   */
  private catchUpWithoutBreakingReferences(nowWall: number): void {
    let keyAt = -1;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i]?.keyframe) {
        keyAt = i;
        break;
      }
    }
    if (keyAt === -1) {
      const all = this.queue;
      this.queue = [];
      for (const f of all) this.opts.onPresent(f);
      const last = all[all.length - 1];
      if (last) this.lastPresented = { ut: last.ut, wall: nowWall };
      return;
    }
    for (const dropped of this.queue.splice(0, keyAt)) {
      this.opts.onSkip?.(dropped);
    }
    const key = this.queue.shift();
    if (!key) return;
    this.opts.onPresent(key);
    this.lastPresented = { ut: key.ut, wall: nowWall };
  }

  /**
   * Drops everything still queued, through `onSkip`, and forgets the frame it
   * last presented and the rate it measured, so the next frame submitted is
   * shown at once. Call it when the frames before and after are not one
   * continuous run, as when the pipeline feeding it is flushed.
   */
  reset(): void {
    this.dispose();
    this.lastPresented = null;
    this.arrivalAnchor = null;
    this.arrivalLatest = null;
  }

  /** Drop (via `onSkip`) everything still queued, without presenting it,
   *  the pipeline-teardown case, mirroring `DelayedPlayoutBuffer.dispose()`. */
  dispose(): void {
    for (const dropped of this.queue) this.opts.onSkip?.(dropped);
    this.queue = [];
  }
}
