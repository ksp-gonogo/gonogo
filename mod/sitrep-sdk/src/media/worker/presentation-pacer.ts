/**
 * The presentation pacer: the ACTUAL jank fix (cross-browser video-delay design, 2026-07-16, finding F3 + "Paced release"). Moving the
 * frame-delay pipeline into a Worker does NOT by itself fix the reported
 * stutter: `ViewClock.confirmedEdgeUt()` is sample-clamped
 * (`min(utNowEstimate() - delaySeconds, maxSampleUt + slackSeconds)`, with
 * `slackSeconds` defaulting to 0), so in the sample-limited regime the edge
 * steps at TELEMETRY sample cadence (~10Hz), not video frame cadence
 * (~30fps). `DelayedPlayoutBuffer.onRelease` fires for every queued frame
 * whose `ut` is now at-or-before the edge, in one synchronous pass, so an
 * edge step releases a BURST of several video frames at once, then nothing
 * for ~100ms. That burst-then-silence pattern, not main-thread contention,
 * is the stutter.
 *
 * This class sits between `DelayedPlayoutBuffer`'s release and the actual
 * sink write (wired in via `runFrameDelayPipeline`'s optional `pacing`
 * option: see `frame-delay.ts`). It re-times a burst of already-CONFIRMED
 * frames so they present spaced by their own UT deltas, instead of all at
 * once. This can only ever ADD latency, never remove it, every frame
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
 * RATE.** Spacing frames by their own UT deltas re-imposes the SOURCE's grid on
 * the presentation, whatever cadence the frames actually reached this pacer at,
 * which is wrong the moment the two differ. A transmitter and a listener whose
 * separation is CHANGING are exactly that case: chunks stamped 20 ms apart do
 * not become audible 20 ms apart, they bunch up while the separation closes and
 * spread while it opens, and a pacer that re-spaces them onto the 20 ms grid
 * erases that. Left alone it does not distort anything audibly, it accrues:
 * the queue grows, or the anchor drifts until the backlog check snaps and drops
 * audio, over a long transmission rather than at any one instant.
 *
 * So the caller may hand `submit()` the wall instant a frame ARRIVED, and the
 * pacer measures wall-seconds-per-UT-second across the arrivals it has seen and
 * scales its spacing by it, which is what an RTP receiver's playout clock does
 * with the sender's timestamps. Passing no arrival instant leaves the rate at
 * 1:1 and the behaviour exactly as it was.
 *
 * The measurement is a LONG baseline (first arrival to latest) rather than a
 * gap between consecutive arrivals, because `DelayedPlayoutBuffer` releases in
 * BURSTS: several frames share one arrival instant, so a short window reads a
 * rate near zero. It is also clamped to a narrow band around 1:1, which is what
 * keeps the warp promise: real doppler in this game is parts per hundred
 * thousand, so the band never fights a true separation rate, while the slowest
 * warp step is 2x and lands far outside it. Under warp the pacer therefore
 * keeps presenting at natural rate and lets the backlog grow and be reported,
 * which is the documented position rather than a new one.
 */

/** One frame handed to the pacer: its capture UT (for spacing) and payload. */
export interface PacedFrame<T> {
  ut: number;
  data: T;
}

export interface PresentationPacerOptions<T> {
  /** Called, in order, for each frame the pacer determines is due at the
   *  `nowWall` passed to `tick()`. The caller does the actual sink write. */
  onPresent(frame: PacedFrame<T>): void;
  /** Called for a frame dropped by backlog control (never reaches
   *  `onPresent`): the caller MUST wire this to release/close the frame's
   *  resources if `T` holds one (e.g. a WebCodecs `VideoFrame`), the same
   *  memory-safety contract `DelayedPlayoutBuffer.onDrop` has. */
  onSkip?(frame: PacedFrame<T>): void;
  /** Wall-clock seconds of backlog (how far past the oldest queued frame's
   *  due time `tick()`'s `nowWall` has drifted) beyond which the pacer
   *  snaps straight to the newest queued frame instead of draining the
   *  backlog in slow motion: "a live feed must not accrue latency". */
  maxBacklogSeconds: number;
  /**
   * UT seconds of arrivals that must be on the books before a measured rate is
   * believed at all. Below it the pacer spaces at 1:1.
   *
   * A floor rather than a smoothing constant: one burst of released frames
   * carries one arrival instant, so a baseline shorter than several bursts
   * measures the burst rather than the stream.
   */
  rateBaselineSeconds?: number;
  /**
   * How far from 1:1 a measured rate may depart, as a fraction. Outside the
   * band the pacer holds the nearer edge.
   *
   * See the class doc: the band exists to separate a separation rate from a
   * time warp, not to bound doppler, which is thousands of times smaller than
   * any value worth putting here.
   */
  maxRateDeparture?: number;
}

/** See `PresentationPacerOptions.rateBaselineSeconds`: ten frames of a 20 ms
 *  audio grid, two of a 10 Hz release burst. */
const DEFAULT_RATE_BASELINE_SECONDS = 0.2;

/** See `PresentationPacerOptions.maxRateDeparture`: a fifth, comfortably above
 *  every real separation rate and comfortably below the 0.5 that the slowest
 *  time warp produces. */
const DEFAULT_MAX_RATE_DEPARTURE = 0.2;

export class PresentationPacer<T> {
  private queue: PacedFrame<T>[] = [];
  /** The (ut, wall) pair the NEXT queued frame's due time is computed
   *  relative to: either the last frame this pacer actually presented, or
   *  `null` before the first one ever (in which case the next frame is due
   *  immediately, at whatever `nowWall` the next `tick()` supplies). */
  private lastPresented: { ut: number; wall: number } | null = null;
  /**
   * The two ends of the arrival baseline the playout rate is measured over.
   *
   * The anchor settles on the first arrival INSTANT and stays there, so the
   * estimate spans this pacer's whole life. That suits a pacer whose life IS one
   * transmission, which is how the radio builds them; one kept alive
   * indefinitely would want a sliding window and does not have one, which is the
   * other half of why arrival instants are opt-in per `submit()`.
   */
  private arrivalAnchor: { ut: number; wall: number } | null = null;
  private arrivalLatest: { ut: number; wall: number } | null = null;

  constructor(private readonly opts: PresentationPacerOptions<T>) {}

  /**
   * Queue one already-confirmed frame. Does not present it, that only happens
   * from `tick()`, once its computed due time has arrived.
   *
   * `arrivedWall` is the wall instant this frame reached the pacer, on the same
   * clock `tick()` reads. Supplying it turns on the measured playout rate (see
   * the class doc); omitting it leaves spacing at 1:1.
   */
  submit(frame: PacedFrame<T>, arrivedWall?: number): void {
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
    frame: PacedFrame<T>,
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

    // One reading per tick, so every frame drained in this pass is spaced on
    // the same rate rather than on one that moved underneath the loop.
    const rate = this.playoutRate();

    const head = this.queue[0];
    if (head === undefined) return;
    const headDue = this.dueWallFor(head, nowWall, rate);
    if (nowWall - headDue > this.opts.maxBacklogSeconds) {
      // Fallen too far behind: jump straight to the newest queued frame
      // rather than draining the backlog in slow motion. Everything else
      // queued is skipped (closed by the caller via onSkip), never
      // presented.
      const newest = this.queue[this.queue.length - 1];
      for (const dropped of this.queue) {
        if (dropped !== newest) this.opts.onSkip?.(dropped);
      }
      this.queue = [];
      if (newest !== undefined) {
        this.opts.onPresent(newest);
        this.lastPresented = { ut: newest.ut, wall: nowWall };
      }
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

  /** Drop (via `onSkip`) everything still queued, without presenting it,
   *  the pipeline-teardown case, mirroring `DelayedPlayoutBuffer.dispose()`. */
  dispose(): void {
    for (const dropped of this.queue) this.opts.onSkip?.(dropped);
    this.queue = [];
  }
}
