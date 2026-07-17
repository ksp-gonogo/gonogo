/**
 * The presentation pacer — the ACTUAL jank fix (cross-browser video-delay design, 2026-07-16, finding F3 + "Paced release"). Moving the
 * frame-delay pipeline into a Worker does NOT by itself fix the reported
 * stutter: `ViewClock.confirmedEdgeUt()` is sample-clamped
 * (`min(utNowEstimate() - delaySeconds, maxSampleUt + slackSeconds)`, with
 * `slackSeconds` defaulting to 0), so in the sample-limited regime the edge
 * steps at TELEMETRY sample cadence (~10Hz), not video frame cadence
 * (~30fps). `DelayedPlayoutBuffer.onRelease` fires for every queued frame
 * whose `ut` is now at-or-before the edge, in one synchronous pass — so an
 * edge step releases a BURST of several video frames at once, then nothing
 * for ~100ms. That burst-then-silence pattern, not main-thread contention,
 * is the stutter.
 *
 * This class sits between `DelayedPlayoutBuffer`'s release and the actual
 * sink write (wired in via `runFrameDelayPipeline`'s optional `pacing`
 * option — see `frame-delay.ts`). It re-times a burst of already-CONFIRMED
 * frames so they present spaced by their own UT deltas, instead of all at
 * once. This can only ever ADD latency, never remove it — every frame
 * handed to `submit()` already passed `DelayedPlayoutBuffer`'s
 * `confirmedEdgeUt()` gate, so pacing never reveals a frame the clock
 * hasn't confirmed yet (the "estimate only schedules; samples confirm"
 * invariant — see `DelayedPlayoutBuffer`'s doc — holds exactly as before;
 * this class only ever delays what's already been released, it is not a
 * second release-gate).
 *
 * Driven externally via `tick(nowWall)` rather than owning its own timer —
 * matches this codebase's existing "manual clock, explicit pump()" testing
 * convention (`DelayedPlayoutBuffer.pump()`), and lets both the Chrome
 * main-thread backend (driven from `requestAnimationFrame`) and the
 * worker-hosted backend (driven from its own ~60Hz poll loop) share this one
 * implementation without either owning a scheduling mechanism themselves.
 *
 * `nowWall` and every frame's `ut` are compared directly (a UT-second delta
 * is treated as a wall-second delay) — see the module docstring caveat in
 * `frame-delay.ts` re: this being a deliberate v1 simplification that does
 * NOT scale by warp rate.
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
   *  `onPresent`) — the caller MUST wire this to release/close the frame's
   *  resources if `T` holds one (e.g. a WebCodecs `VideoFrame`), the same
   *  memory-safety contract `DelayedPlayoutBuffer.onDrop` has. */
  onSkip?(frame: PacedFrame<T>): void;
  /** Wall-clock seconds of backlog (how far past the oldest queued frame's
   *  due time `tick()`'s `nowWall` has drifted) beyond which the pacer
   *  snaps straight to the newest queued frame instead of draining the
   *  backlog in slow motion — "a live feed must not accrue latency". */
  maxBacklogSeconds: number;
}

export class PresentationPacer<T> {
  private queue: PacedFrame<T>[] = [];
  /** The (ut, wall) pair the NEXT queued frame's due time is computed
   *  relative to — either the last frame this pacer actually presented, or
   *  `null` before the first one ever (in which case the next frame is due
   *  immediately, at whatever `nowWall` the next `tick()` supplies). */
  private lastPresented: { ut: number; wall: number } | null = null;

  constructor(private readonly opts: PresentationPacerOptions<T>) {}

  /** Queue one already-confirmed frame. Does not present it — that only
   *  happens from `tick()`, once its computed due time has arrived. */
  submit(frame: PacedFrame<T>): void {
    this.queue.push(frame);
  }

  private dueWallFor(frame: PacedFrame<T>, nowWall: number): number {
    return this.lastPresented
      ? this.lastPresented.wall + (frame.ut - this.lastPresented.ut)
      : nowWall; // nothing presented yet this session — present immediately
  }

  /** Drain whatever's due at `nowWall` (same wall-clock basis every call
   *  uses — the caller's own clock). Call this on every tick of the
   *  caller's ~60Hz loop. */
  tick(nowWall: number): void {
    if (this.queue.length === 0) return;

    const head = this.queue[0];
    if (head === undefined) return;
    const headDue = this.dueWallFor(head, nowWall);
    if (nowWall - headDue > this.opts.maxBacklogSeconds) {
      // Fallen too far behind — jump straight to the newest queued frame
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
      const due = this.dueWallFor(next, nowWall);
      if (nowWall < due) break; // not due yet — wait for a later tick
      this.queue.shift();
      this.opts.onPresent(next);
      // Anchor at the SCHEDULED due time, not the actual `nowWall` a tick
      // happened to land on — keeps spacing exact (each frame `deltaUT`
      // apart) even when `tick()` calls are irregular, rather than
      // compounding jitter from one frame to the next.
      this.lastPresented = { ut: next.ut, wall: due };
    }
  }

  /** Drop (via `onSkip`) everything still queued, without presenting it —
   *  the pipeline-teardown case, mirroring `DelayedPlayoutBuffer.dispose()`. */
  dispose(): void {
    for (const dropped of this.queue) this.opts.onSkip?.(dropped);
    this.queue = [];
  }
}
