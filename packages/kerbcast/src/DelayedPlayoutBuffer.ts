/**
 * Media playout buffer that rides the SAME delay clock as telemetry
 * (`local_docs/telemetry-mod/m2-sdk-delay-design.md` §5 — "media delay").
 *
 * The headline guarantee: video and telemetry stamped the same UT become
 * available at the same wall-time, because both read `confirmedEdgeUt()`
 * off one shared clock object. This class never computes
 * `arrival + delaySeconds` itself — see §5.1, "samples confirm, estimate
 * only schedules". It is deliberately decoupled from `@ksp-gonogo/sitrep-client`
 * (no import of `ViewClock`): the `view` dependency is any object exposing
 * `confirmedEdgeUt()` / `onFrame()`, injected by the caller (the app wires
 * the real `ViewClock` in; kerbcast never imports sitrep-client, avoiding a
 * circular package dependency — see the class's constructor doc).
 */

/** One UT-stamped media frame (or still) entering the buffer. */
export interface StampedFrame<T = unknown> {
  /** Capture UT — the same timeline telemetry samples are stamped on. */
  ut: number;
  /** Frame payload. Absent for a bare still reference (see `stillRef`). */
  data?: T;
  /** A still-image reference, used when no per-frame payload is held (long
   *  delays degrading to stills — M2 design §5.2/§5.4). */
  stillRef?: T;
  /** Keyframe frames are never dropped by the over-cap eviction while a
   *  non-keyframe candidate exists (§5.3). */
  keyframe: boolean;
  /** Byte-size estimate for cap accounting. Defaults to 1 (frame-count
   *  cap) when omitted — callers modelling real bitrate should set this. */
  bytes?: number;
}

/**
 * The minimal delay-clock surface the buffer depends on. Structurally
 * matches `Pick<ViewClock, "confirmedEdgeUt" | "onFrame">` from
 * `@ksp-gonogo/sitrep-client` without importing that package — the app passes
 * the real `ViewClock` instance (or any equivalent) at the call site.
 */
export interface DelayClockLike {
  /** The certainty horizon: a frame stamped at-or-before this UT is
   *  releasable. THE one delay authority — never delay-subtracted here. */
  confirmedEdgeUt(): number;
  /** Best-effort per-frame notification (real-time driven). Not required
   *  for correctness — tests and other deterministic callers can drive
   *  releases explicitly via `pump()` instead. */
  onFrame(cb: (viewUt: number) => void): () => void;
}

export interface DelayedPlayoutBufferOptions<T = unknown> {
  /** THE delay clock — the same object instance telemetry reads. */
  view: DelayClockLike;
  /** Called synchronously, in UT order, once per frame that becomes
   *  eligible for display (`confirmedEdgeUt() >= frame.ut`). */
  onRelease(frame: StampedFrame<T>): void;
  /** Called once per `flush()` — the feed UI's resync marker (§5.4). */
  onResync?(): void;
  /** Called for every queued frame discarded WITHOUT being released — an
   *  over-cap eviction (`enforceCap`), a `flush()`, or leftover frames still
   *  queued at `dispose()`. Never called for a frame that reached
   *  `onRelease` (that frame's lifecycle is the caller's from that point).
   *  Optional — generic, not video-specific — but the caller MUST wire it
   *  when `T` holds an external resource (e.g. a WebCodecs `VideoFrame`)
   *  that needs `.close()`ing, or every discard path leaks it. */
  onDrop?(frame: StampedFrame<T>): void;
  /** Over this, drop-oldest-non-keyframe frames until back under cap
   *  (§5.3). Buffered size is the sum of each queued frame's `bytes`
   *  (default 1 per frame when unset). */
  maxBufferedBytes: number;
}

/**
 * Holds UT-stamped frames and releases each once the injected clock's
 * `confirmedEdgeUt()` reaches its `ut` — never earlier, so it can never
 * show data before the equivalent telemetry sample would confirm at the
 * same UT (M2 design §5.1, §0 "common-mode" property).
 */
export class DelayedPlayoutBuffer<T = unknown> {
  private queue: StampedFrame<T>[] = [];
  private lastReleased: StampedFrame<T> | undefined;
  private bufferedBytes = 0;
  private readonly unsubscribeFrame: () => void;
  private disposed = false;

  constructor(private readonly opts: DelayedPlayoutBufferOptions<T>) {
    this.unsubscribeFrame = opts.view.onFrame(() => this.pump());
  }

  /** Ingest one UT-stamped frame. Sorted into UT order (source frames
   *  arrive ~monotonically; a slight reorder is tolerated) and immediately
   *  checked for release — covers the delay=0 passthrough case (scenario
   *  6), where the newly pushed frame is already at-or-before the edge. */
  push(frame: StampedFrame<T>): void {
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
   * every `view.onFrame` tick (real-time use) but also safe — and the
   * primary lever for deterministic tests — to call directly after driving
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
   * Timeline-reset (§5.4): drop every buffered frame and the held-still
   * cursor, then emit the resync marker. Nothing pre-reset can surface
   * afterwards, even once the clock (post-epoch-bump) sweeps back past
   * those old UTs — they were discarded, not merely held.
   */
  flush(): void {
    for (const dropped of this.queue) this.opts.onDrop?.(dropped);
    this.queue = [];
    this.bufferedBytes = 0;
    this.lastReleased = undefined;
    this.opts.onResync?.();
  }

  /** The most recently released frame — the still held on screen between
   *  releases. `undefined` before the first release (or right after a
   *  flush, until the next release). */
  current(): StampedFrame<T> | undefined {
    return this.lastReleased;
  }

  /** Read-only snapshot of the queued (not-yet-released) frames, in UT
   *  order — debug/introspection and test assertions on cap eviction. */
  peekQueue(): ReadonlyArray<StampedFrame<T>> {
    return this.queue;
  }

  /** Unsubscribe from `view.onFrame`, stop accepting new frames, and drop
   *  (via `onDrop`) whatever's still queued — a camera switch or unmount
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
   * Over cap: drop-oldest non-keyframe frames first (mirrors telemetry's
   * lossy channel-keyframe coalescing — §5.3). A keyframe is only ever
   * dropped as a last resort, when every remaining queued frame is itself
   * a keyframe and the cap is still exceeded (never stall the release
   * clock waiting on a frame that can't fit).
   */
  private enforceCap(): void {
    while (
      this.bufferedBytes > this.opts.maxBufferedBytes &&
      this.queue.length > 0
    ) {
      let dropIdx = this.queue.findIndex((f) => !f.keyframe);
      if (dropIdx === -1) {
        if (this.queue.length <= 1) break; // nothing left to trade away
        dropIdx = 0; // last resort: oldest keyframe
      }
      const [dropped] = this.queue.splice(dropIdx, 1);
      if (dropped) {
        this.bufferedBytes -= dropped.bytes ?? 1;
        this.opts.onDrop?.(dropped);
      }
    }
  }
}
