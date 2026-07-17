/**
 * Media playout buffer that rides the SAME delay clock as telemetry
 * (`local_docs/telemetry-mod/m2-sdk-delay-design.md` §5 — "media delay").
 *
 * The headline guarantee: video and telemetry stamped the same UT become
 * available at the same wall-time, because both read `confirmedEdgeUt()`
 * off one shared clock object. This class never computes
 * `arrival + delaySeconds` itself — see §5.1, "samples confirm, estimate
 * only schedules".
 *
 * The `view` dependency is STRUCTURAL (`DelayClockLike`), not the concrete
 * `ViewClock` — a deliberate choice kept even though this buffer now lives in
 * the same package as `ViewClock` (moved here 2026-07-17 as generic media
 * infra). The original reason — "avoid a circular dependency from the camera
 * Uplink back into sitrep-client" — no longer applies; two reasons that DO
 * survive the move keep it structural:
 *   1. it lets the buffer be unit-tested against a hand-rolled clock double
 *      (see `delayed-playout-buffer.test.ts`) with no real `ViewClock`, no
 *      provider, no wall clock;
 *   2. it documents the MINIMAL surface media delay needs off the one delay
 *      authority — exactly `confirmedEdgeUt()` + `onFrame()` — so the coupling
 *      to the clock stays a two-method contract, not the whole class.
 * The app still wires the real `ViewClock` in at the call site; `ViewClock`
 * satisfies `DelayClockLike` structurally (its `ViewClockView` view is wider).
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
 * The minimal delay-clock surface the buffer depends on — a subset of the
 * sibling `ViewClock`'s `ViewClockView` (`confirmedEdgeUt` + `onFrame`). Kept
 * structural (not `ViewClock` itself) on purpose — see the module doc: it
 * keeps the buffer unit-testable against a clock double and documents the
 * two-method contract media delay needs off the one delay authority. The app
 * passes the real `ViewClock` instance (or any equivalent) at the call site.
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
  /** Over this, evict queued frames until back under cap (§5.3). Buffered
   *  size is the sum of each queued frame's `bytes` (default 1 per frame
   *  when unset). Eviction UNIT depends on `gopSafeEviction` — see that
   *  option's doc. */
  maxBufferedBytes: number;
  /**
   * Eviction safety mode (encoded-transform video-delay work, 2026-07-16 —
   * `local_docs/reports/encoded-transform-spike-report.md`'s "frame
   * ordering / GOP dependency survival" finding).
   *
   * Default `false`/unset — **drop-oldest-non-keyframe, one frame at a
   * time.** Correct for payloads with no inter-frame dependency (a decoded
   * `VideoFrame`: each is independently displayable, so `frame-delay.ts`
   * always tags them `keyframe: false` and any single one is a safe
   * eviction candidate). This is the ORIGINAL, unchanged behaviour — every
   * pre-existing caller keeps it exactly as before.
   *
   * `true` — **drop a complete GOP run at a time, from the oldest end.**
   * REQUIRED for encoded video: an `RTCEncodedVideoFrame` delta frame is
   * compressed relative to a prior reference frame via motion compensation,
   * so evicting a single mid-GOP delta frame breaks the decode chain for
   * every subsequent delta frame until the next keyframe — silent picture
   * corruption, not a clean drop. In this mode `enforceCap` always removes
   * the queue's leading run up to (but not including) the next keyframe —
   * whether that run starts with a keyframe or is a leftover delta-only
   * prefix — as one atomic unit. The retained queue therefore always either
   * starts exactly at a keyframe or is empty: a valid decodable prefix,
   * never a partial one. Costs coarser-grained eviction (a whole GOP,
   * rather than one frame, leaves at a time) — acceptable because encoded
   * buffers are tiny relative to decoded ones (see the spike report's
   * memory finding), so eviction should be rare-to-never in practice.
   */
  gopSafeEviction?: boolean;
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
   *  including) the next keyframe — see `gopSafeEviction`'s doc. Returns
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
