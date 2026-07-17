/**
 * ONE delayed pipeline per camera, shared by every consumer of that camera.
 *
 * Delay is a property of the CAMERA, not of the viewer. Before this module,
 * each consumer delayed its own copy: the delayed-playout hook built a fresh
 * pipeline per hook call, so a `CameraFeed` and the docking-HUD backdrop
 * pointed at the same camera would each try to build one. Two problems, one
 * fatal:
 *
 *   - **Fatal**: both Breakout-Box backends construct a
 *     `MediaStreamTrackProcessor` over the track, and a `MediaStreamTrack`
 *     admits only ONE processor — the second consumer's build throws. Same
 *     shape for the encoded backend: `RTCRtpScriptTransform` is one-per
 *     `RTCRtpReceiver`. So a second viewer on one camera was never
 *     supportable, only unreachable-by-luck.
 *   - **Wasteful**: even where it worked it would decode the same frames
 *     twice.
 *
 * And it was incoherent on its face: two consumers of one camera showing
 * DIFFERENT delays is never what anyone wants — they are looking at the same
 * lens through the same one delay authority.
 *
 * The fix is to delay ONCE at the source and hand the delayed output to every
 * consumer: one processor per track, N consumers of its output. This module
 * is that seam — a refcounted, keyed cache of in-flight pipelines. It lives
 * in `sitrep-client` (beside the delay authority `ViewClock`, not in any
 * camera package) because it is about MEDIA + TIME. It knows nothing about
 * WebRTC or any camera SDK: the caller supplies the key (the shared
 * `MediaStream`/track identity) and the build function.
 *
 * Lifecycle:
 *   - first `acquire(key)` starts a build; later `acquire(key)` calls while
 *     that build is in flight (or after it settled) attach to the SAME entry
 *     and see the same result — so a consumer attaching mid-stream gets the
 *     existing delayed output rather than spawning a second processor;
 *   - the LAST `release()` disposes the pipeline and drops the entry. A build
 *     that settles after the last release is disposed immediately and never
 *     published (the teardown race a `raw`-stream swap creates).
 *
 * The "contribution" seam: each lease contributes a value (in practice the
 * capture-clock sample provider) and the build reads `contribution()` — the
 * FIRST still-live lease's. This matters because the pipeline outlives the
 * consumer that happened to build it: if that consumer unmounts while another
 * still watches, a closure captured over the builder's refs would silently go
 * stale (a frozen capture UT -> frames stamped against a dead clock). Reading
 * the active contribution per call re-points automatically. Every consumer of
 * one camera reads the same app-wide clock, so any live one is equivalent.
 */

/** What a build produces: the value to publish, plus the physical pipeline's
 *  teardown/flush handles. `dispose` runs when the last lease releases. */
export interface BuiltDelayedStream<R> {
  result: R;
  dispose?(): void;
  flush?(): void;
}

/** Build context handed to the caller's build function. */
export interface DelayedStreamBuildContext<C> {
  /** The first still-live lease's contribution, or `undefined` if every
   *  contributing lease has released. Call this PER USE (never hoist it) —
   *  re-pointing away from an unmounted builder is the whole point. */
  contribution(): C | undefined;
}

export type DelayedStreamBuild<R, C> = (
  ctx: DelayedStreamBuildContext<C>,
) => Promise<BuiltDelayedStream<R>> | BuiltDelayedStream<R>;

/** One consumer's handle on a shared entry. */
export interface DelayedStreamLease<R, C> {
  /** The currently published result, or `undefined` while the build is in
   *  flight. */
  get(): R | undefined;
  /** Notified whenever the published result changes. */
  subscribe(cb: () => void): () => void;
  /** Update THIS lease's contribution (call on every render — cheap). */
  setContribution(c: C): void;
  /** Flush the shared pipeline (timeline reset). Affects every consumer —
   *  correct, since they share one buffer. */
  flush(): void;
  /** Detach. The last release tears the pipeline down. */
  release(): void;
}

interface Entry<R, C> {
  built?: BuiltDelayedStream<R>;
  result?: R;
  settled: boolean;
  /** Live leases, in acquisition order — the Map's iteration order is what
   *  makes `contribution()` deterministic ("first still-live lease"). */
  contributions: Map<object, C | undefined>;
  listeners: Set<() => void>;
}

/**
 * A keyed, refcounted registry of shared delayed pipelines. Keyed by
 * reference identity (a `Map`), so the natural key is the shared
 * `MediaStream`/track object every consumer of one camera already holds —
 * no fragile string id needed, and it works with the opaque stream tokens
 * unit tests stand in for a real `MediaStream`.
 *
 * Exported as a class (rather than module functions over a hidden Map) so a
 * test can mint an isolated instance instead of leaking entries through a
 * global — the media hook uses one shared instance; tests of the cache use
 * their own.
 */
export class SharedDelayedStreams<R, C, K = object> {
  private entries = new Map<K, Entry<R, C>>();

  /**
   * Attach to the shared pipeline for `key`, building it if this is the
   * first consumer. `build` runs AT MOST once per entry — a second acquire
   * on a live key never builds.
   */
  acquire(key: K, build: DelayedStreamBuild<R, C>): DelayedStreamLease<R, C> {
    const token = {};
    let entry = this.entries.get(key);
    const isFirst = entry === undefined;
    if (!entry) {
      entry = {
        settled: false,
        contributions: new Map(),
        listeners: new Set(),
      };
      this.entries.set(key, entry);
    }
    const e = entry;
    e.contributions.set(token, undefined);

    if (isFirst) {
      const ctx: DelayedStreamBuildContext<C> = {
        contribution: () => {
          for (const c of e.contributions.values()) {
            if (c !== undefined) return c;
          }
          return undefined;
        },
      };
      const settle = (built: BuiltDelayedStream<R>) => {
        // The last lease may have released while the build was in flight —
        // dispose rather than publish a pipeline nobody is watching.
        if (this.entries.get(key) !== e) {
          built.dispose?.();
          return;
        }
        e.built = built;
        e.result = built.result;
        e.settled = true;
        for (const cb of e.listeners) cb();
      };
      const abort = () => {
        // A throwing build leaves nothing to publish; drop the entry so a later
        // acquire on the same key can retry rather than wedging on a
        // permanently-"building" record.
        if (this.entries.get(key) === e) this.entries.delete(key);
      };
      // Settle SYNCHRONOUSLY when `build` is synchronous (the encoded and
      // main-thread backends), so a consumer sees the result in the same tick
      // it acquired — no spurious extra "connecting" frame. Only a genuinely
      // async build (the worker backend) settles on a later microtask.
      let produced: Promise<BuiltDelayedStream<R>> | BuiltDelayedStream<R>;
      try {
        produced = build(ctx);
      } catch {
        abort();
        produced = undefined as never;
      }
      if (produced instanceof Promise) {
        void produced.then(settle, abort);
      } else if (produced !== undefined) {
        settle(produced);
      }
    }

    return {
      get: () => e.result,
      subscribe: (cb) => {
        e.listeners.add(cb);
        return () => {
          e.listeners.delete(cb);
        };
      },
      setContribution: (c) => {
        if (e.contributions.has(token)) e.contributions.set(token, c);
      },
      flush: () => e.built?.flush?.(),
      release: () => {
        if (!e.contributions.delete(token)) return; // idempotent
        if (e.contributions.size > 0) return;
        if (this.entries.get(key) === e) this.entries.delete(key);
        e.built?.dispose?.();
        e.built = undefined;
        e.listeners.clear();
      },
    };
  }

  /** Live entry count — for tests/diagnostics. */
  get size(): number {
    return this.entries.size;
  }

  /** Whether `key` currently has a live shared entry. */
  has(key: K): boolean {
    return this.entries.has(key);
  }
}
