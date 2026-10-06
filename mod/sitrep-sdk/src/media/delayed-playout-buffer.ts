/**
 * Media playout buffer that rides the SAME delay clock as telemetry.
 *
 * The headline guarantee: video and telemetry stamped the same UT become
 * available at the same wall-time, because both read `confirmedEdgeUt()`
 * off one shared clock object. This class never computes
 * `arrival + delaySeconds` itself: a sample confirms, an estimate only
 * schedules.
 *
 * The `view` dependency is STRUCTURAL (`DelayClockLike`), not the concrete
 * `ViewClock`, even though `ViewClock` lives in this same package. Two reasons:
 *   1. it lets the buffer be unit-tested against a hand-rolled clock double
 *      (see `delayed-playout-buffer.test.ts`) with no real `ViewClock`, no
 *      provider, no wall clock;
 *   2. it documents the MINIMAL surface media delay needs off the one delay
 *      authority, exactly `confirmedEdgeUt()` + `onFrame()`, so the coupling
 *      to the clock stays a two-method contract, not the whole class.
 * The app wires the real `ViewClock` in at the call site; `ViewClock`
 * satisfies `DelayClockLike` structurally (its `ViewClockView` view is wider).
 */

/**
 * One UT-stamped media frame (or still) entering the buffer.
 *
 * @category Delayed video
 */
export interface StampedFrame<Frame = unknown> {
  /** Capture UT: the same timeline telemetry samples are stamped on. */
  ut: number;
  /** Frame payload. Absent for a bare still reference (see `stillRef`). */
  data?: Frame;
  /** A still-image reference, used when no per-frame payload is held (long
   *  delays degrading to stills). */
  stillRef?: Frame;
  /** Keyframe frames are never dropped by the over-cap eviction while a
   *  non-keyframe candidate exists. */
  keyframe: boolean;
  /** Byte-size estimate for cap accounting. Defaults to 1 (frame-count
   *  cap) when omitted: callers modelling real bitrate should set this. */
  bytes?: number;
}

/**
 * The two methods of the app's view clock that delaying video needs:
 * `confirmedEdgeUt` and `onFrame`. Pass the app's clock, or a stand-in in a
 * test.
 *
 * @category Delayed video
 */
export interface DelayClockLike {
  /** The certainty horizon: a frame stamped at-or-before this UT is
   *  releasable. THE one delay authority: never delay-subtracted here. */
  confirmedEdgeUt(): number;
  /** Best-effort per-frame notification (real-time driven). Not required
   *  for correctness: tests and other deterministic callers can drive
   *  releases explicitly via `pump()` instead. */
  onFrame(cb: (viewUt: number) => void): () => void;
}

/**
 * Options for a new `DelayedPlayoutBuffer`.
 *
 * @category Delayed video
 */
export interface DelayedPlayoutBufferOptions<Frame = unknown> {
  /**
   * The app's view clock, the same one telemetry is read by.
   */
  view: DelayClockLike;
  /**
   * Called once for each frame as it becomes due (`confirmedEdgeUt() >= ut`), in
   * UT order. The frame is the caller's from then on.
   */
  onRelease(frame: StampedFrame<Frame>): void;
  /**
   * Called once on each `flush()`.
   */
  onResync?(): void;
  /**
   * Called for each frame discarded without being released: dropped over the
   * cap, by `flush()`, or still held at `dispose()`. Supply it whenever a frame
   * holds something that must be closed, such as a `VideoFrame`, or every
   * discarded frame leaks it.
   */
  onDrop?(frame: StampedFrame<Frame>): void;
  /**
   * The most the buffer holds, summed over each frame's `bytes` (1 for a frame
   * without one). Over it, the oldest frames are dropped; `gopSafeEviction` says
   * how many at a time.
   */
  maxBufferedBytes: number;
  /**
   * How frames are dropped over the cap.
   *
   * Unset or `false`: the oldest frame that is not a keyframe, one at a time.
   * Right for decoded frames, each of which can be shown alone.
   *
   * `true`: everything from the oldest frame up to the next keyframe, at once,
   * so the buffer always starts at a keyframe. Required for encoded video, where
   * a frame between keyframes cannot be decoded without the ones before it.
   */
  gopSafeEviction?: boolean;
}

/**
 * Holds UT-stamped frames and releases each once the clock's
 * `confirmedEdgeUt()` reaches its `ut`, never earlier. A frame is therefore
 * never shown before telemetry from the same instant would be.
 *
 * @category Delayed video
 */
export class DelayedPlayoutBuffer<Frame = unknown> {
  private queue: StampedFrame<Frame>[] = [];
  private lastReleased: StampedFrame<Frame> | undefined;
  private bufferedBytes = 0;
  private readonly unsubscribeFrame: () => void;
  private disposed = false;

  constructor(private readonly opts: DelayedPlayoutBufferOptions<Frame>) {
    this.unsubscribeFrame = opts.view.onFrame(() => this.pump());
  }

  /** Ingest one UT-stamped frame. Sorted into UT order (source frames
   *  arrive ~monotonically; a slight reorder is tolerated) and immediately
   *  checked for release: covers the delay=0 passthrough case (scenario
   *  6), where the newly pushed frame is already at-or-before the edge. */
  push(frame: StampedFrame<Frame>): void {
    if (this.disposed) return;
    const insertAt = this.queue.findIndex((f) => f.ut > frame.ut);
    if (insertAt === -1) this.queue.push(frame);
    else this.queue.splice(insertAt, 0, frame);
    this.bufferedBytes += frame.bytes ?? 1;
    this.enforceCap();
    this.pump();
  }

  /**
   * Explicit release check: releases every queued frame whose `ut` is
   * at-or-before `view.confirmedEdgeUt()`, in UT order. Wired to fire on
   * every `view.onFrame` tick (real-time use) but also safe, and the
   * primary lever for deterministic tests: to call directly after driving
   * a manual/fake clock forward.
   */
  pump(): void {
    if (this.disposed) return;
    const edge = this.opts.view.confirmedEdgeUt();
    while (this.queue.length > 0) {
      const head = this.queue[0];
      if (head === undefined || edge < head.ut) break;
      this.queue.shift();
      this.bufferedBytes -= head.bytes ?? 1;
      this.lastReleased = head;
      this.opts.onRelease(head);
    }
  }

  /**
   * Timeline-reset: drop every buffered frame and the held-still
   * cursor, then emit the resync marker. Nothing pre-reset can surface
   * afterwards, even once the clock (post-epoch-bump) sweeps back past
   * those old UTs: they were discarded, not merely held.
   */
  flush(): void {
    for (const dropped of this.queue) this.opts.onDrop?.(dropped);
    this.queue = [];
    this.bufferedBytes = 0;
    this.lastReleased = undefined;
    this.opts.onResync?.();
  }

  /** The most recently released frame: the still held on screen between
   *  releases. `undefined` before the first release (or right after a
   *  flush, until the next release). */
  current(): StampedFrame<Frame> | undefined {
    return this.lastReleased;
  }

  /** Read-only snapshot of the queued (not-yet-released) frames, in UT
   *  order: debug/introspection and test assertions on cap eviction. */
  peekQueue(): ReadonlyArray<StampedFrame<Frame>> {
    return this.queue;
  }

  /** Unsubscribe from `view.onFrame`, stop accepting new frames, and drop
   *  (via `onDrop`) whatever's still queued: a camera switch or unmount
   *  mid-delay would otherwise strand held frames (and any resource they
   *  hold, e.g. a `VideoFrame`) forever. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeFrame();
    for (const dropped of this.queue) this.opts.onDrop?.(dropped);
    this.queue = [];
    this.bufferedBytes = 0;
  }

  /**
   * Over cap: evict queued frames until back under cap. See
   * `gopSafeEviction`'s doc for the two available eviction units.
   */
  private enforceCap(): void {
    while (
      this.bufferedBytes > this.opts.maxBufferedBytes &&
      this.queue.length > 0
    ) {
      const evicted = this.opts.gopSafeEviction
        ? this.evictOldestGop()
        : this.evictOldestFrame();
      if (!evicted) break; // nothing left to trade away
    }
  }

  /** Original eviction unit: drop-oldest-non-keyframe, one frame at a time.
   *  A keyframe is only ever dropped as a last resort, when every remaining
   *  queued frame is itself a keyframe and the cap is still exceeded
   *  (never stall the release clock waiting on a frame that can't fit).
   *  Returns `false` when there's nothing left to trade away. */
  private evictOldestFrame(): boolean {
    let dropIdx = this.queue.findIndex((f) => !f.keyframe);
    if (dropIdx === -1) {
      if (this.queue.length <= 1) return false;
      dropIdx = 0; // last resort: oldest keyframe
    }
    const [dropped] = this.queue.splice(dropIdx, 1);
    if (dropped) {
      this.bufferedBytes -= dropped.bytes ?? 1;
      this.opts.onDrop?.(dropped);
    }
    return true;
  }

  /** GOP-safe eviction unit: drop the queue's leading run up to (but not
   *  including) the next keyframe: see `gopSafeEviction`'s doc. Returns
   *  `false` when only one frame remains (never evict the last one). */
  private evictOldestGop(): boolean {
    if (this.queue.length <= 1) return false; // nothing left to trade away
    let dropCount = 1;
    while (dropCount < this.queue.length && !this.queue[dropCount]?.keyframe) {
      dropCount++;
    }
    const dropped = this.queue.splice(0, dropCount);
    for (const frame of dropped) {
      this.bufferedBytes -= frame.bytes ?? 1;
      this.opts.onDrop?.(frame);
    }
    return dropped.length > 0;
  }
}
