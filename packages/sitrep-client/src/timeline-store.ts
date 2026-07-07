import {
  ClientTimeline,
  type ClientTimelineOptions,
  type TimelinePoint,
} from "./timeline";
import type { ViewClock } from "./view-clock";

/**
 * The frozen view-time token for one frame / read cycle (M2 design §1.2,
 * §7.4's "single-view-time invariant"). There is deliberately no method
 * anywhere in this file that reads "the current time" and hands back a
 * fresh UT per call — every read goes through a `FrameToken`, and a token's
 * `viewUt` never changes after it's minted. That's what makes the
 * invariant structural rather than a convention callers have to remember.
 */
export interface FrameToken {
  readonly viewUt: number;
  /**
   * Internal validity marker, bumped by every `beginFrame()` call. Not
   * meant to be read by callers — it's what lets `sample()` detect a token
   * a caller cached across a frame boundary (M2 fix-report "FrameToken
   * never invalidated") and fall back to the current frame instead of
   * honoring a frozen-in-the-past `viewUt` forever.
   */
  readonly generation: number;
}

export interface TimelineStoreOptions {
  timelineOptions?: ClientTimelineOptions;
}

/**
 * Ties per-topic `ClientTimeline`s to the one shared `ViewClock` and mints
 * the frozen `FrameToken` every read goes through.
 *
 * Two consumption tiers per the design (§2.2):
 * - **Reactive**: `subscribeFrame` + `sample` back a `useSyncExternalStore`
 *   hook (`useTimelineStream`) that reads at whatever `FrameToken`
 *   `currentFrame()` currently holds — it does NOT mint its own token per
 *   render, so two components rendering in the same frame see the same
 *   `viewUt` even if wall time ticks between their renders.
 * - **Imperative**: `sample(topic, token)` for a caller's own rAF loop
 *   (canvas widgets) — pass the token from `currentFrame()` (or one you
 *   minted yourself with `beginFrame()`) explicitly.
 *
 * This is the foundation derived channels (T3), staleness consumption (T4),
 * and confirmed-vs-predicted (T5) all build on — none of that is
 * implemented here.
 */
export class TimelineStore {
  private readonly timelines = new Map<string, ClientTimeline<unknown>>();
  private readonly frameListeners = new Set<() => void>();
  private currentToken: FrameToken;
  private generation = 0;

  /**
   * Per-`FrameToken` memoization cache (M2 fix-report Defect 3, frame
   * coherence). Keyed by token object identity via a `WeakMap` so it never
   * needs manual cleanup — once a token is no longer referenced anywhere
   * (including as `currentToken`), its cache entry is collected too. The
   * first `sample(topic, token)` read for a given `(token, topic)` pair is
   * authoritative for that token's whole lifetime; a mid-frame `ingest`
   * cannot flip it. Also the seam derived channels (T3) reuse instead of
   * building their own per-frame cache.
   */
  private readonly frameCache = new WeakMap<FrameToken, Map<string, unknown>>();

  constructor(
    readonly clock: ViewClock,
    private readonly options: TimelineStoreOptions = {},
  ) {
    this.currentToken = { viewUt: clock.viewUt(), generation: this.generation };
  }

  /**
   * Append a delivered sample for `topic` and feed its timing into the
   * shared `ViewClock`. Does NOT advance the frame — ingest and frame
   * advance are independent (many samples can arrive within one frame; the
   * frame only advances on `beginFrame()`).
   *
   * Store-level epoch guard (M2 fix-report Defect 1+2, "the client ghost"):
   * the store — not any individual `ClientTimeline` — is the epoch
   * authority. A point tagged with an epoch lower than the shared clock's
   * current epoch is refused outright, even for a topic whose
   * `ClientTimeline` has never been touched (a freshly-created timeline
   * defaults to epoch 0, which would otherwise wrongly admit a pre-rewind
   * straggler as if it were live). If this ingest is the one that bumps the
   * clock's epoch, every other registered timeline is swept forward to the
   * new epoch immediately, so a topic that hasn't re-sampled since the
   * rewind goes cold right away instead of continuing to serve dead-epoch
   * points until it happens to receive its own next sample.
   */
  ingest<T>(topic: string, point: TimelinePoint<T>): void {
    const priorEpoch = this.clock.getEpoch();
    if (point.epoch < priorEpoch) {
      // Stale-epoch straggler by the store's authoritative epoch — refused,
      // not merely masked at read time.
      return;
    }

    this.timelineFor<T>(topic).append(point);
    this.clock.observeSample(
      point.validAt,
      point.meta.deliveredAt,
      point.epoch,
    );

    const newEpoch = this.clock.getEpoch();
    if (newEpoch > priorEpoch) {
      for (const lagging of this.timelines.values()) {
        lagging.adoptEpoch(newEpoch);
      }
    }
  }

  /** The per-topic `ClientTimeline`, created on first access. */
  getTimeline<T>(topic: string): ClientTimeline<T> {
    return this.timelineFor<T>(topic);
  }

  /**
   * Mint a new frozen `FrameToken` from the clock's current `viewUt()` and
   * make it `currentFrame()`'s value. Call once per animation frame / read
   * cycle (e.g. from `clock.onFrame` or a widget's own rAF loop) — never
   * once per read.
   */
  beginFrame(): FrameToken {
    this.generation++;
    this.currentToken = {
      viewUt: this.clock.viewUt(),
      generation: this.generation,
    };
    for (const listener of this.frameListeners) listener();
    return this.currentToken;
  }

  /** The token minted by the most recent `beginFrame()` call. What reactive reads (`useTimelineStream`) use — never recomputed per read. */
  currentFrame(): FrameToken {
    return this.currentToken;
  }

  /**
   * Imperative tier: read `topic` at a frame token's frozen `viewUt`
   * (defaults to `currentFrame()` — there is no per-read "now").
   *
   * Three fixes live here (M2 fix-report):
   * - **Stale-token fallback**: a `token` from a superseded frame (its
   *   `generation` doesn't match the store's current one — e.g. a caller
   *   cached a token across a `beginFrame()` boundary) is not honored;
   *   the read is routed to `currentFrame()` instead.
   * - **Store-level epoch guard (Defect 1+2)**: if `topic`'s timeline is
   *   still sitting on an epoch lower than the shared clock's, it's treated
   *   as cold (`undefined`) rather than serving its dead-epoch data — this
   *   is what actually closes the cross-topic ghost even in the split
   *   second before `ingest`'s proactive sweep has touched it, and for a
   *   timeline that gets lazily created (via `timelineFor`) after a rewind.
   * - **Frame-coherent memoization (Defect 3)**: the first read of a given
   *   `(topic, token)` pair is authoritative for that token's whole
   *   lifetime, so a mid-frame `ingest` can't flip the answer mid-read-cycle
   *   (tearing) — the change only surfaces once a new `beginFrame()` mints a
   *   new token.
   */
  sample<T>(
    topic: string,
    token: FrameToken = this.currentToken,
  ): TimelinePoint<T> | undefined {
    const effectiveToken =
      token.generation === this.generation ? token : this.currentToken;

    return this.memoize(effectiveToken, topic, () => {
      const timeline = this.timelineFor<T>(topic);
      if (timeline.epoch < this.clock.getEpoch()) return undefined;
      return timeline.at(effectiveToken.viewUt);
    });
  }

  /**
   * Frame-coherent memoized read: the first `compute()` for a given
   * `(token, key)` pair wins for that token's lifetime; subsequent calls
   * return the cached result even if the underlying data changes in
   * between. Private for now — exposed indirectly via `sample()` — but
   * deliberately generic so derived channels (T3) can reuse the same
   * per-frame cache instead of building their own.
   */
  private memoize<T>(token: FrameToken, key: string, compute: () => T): T {
    let cache = this.frameCache.get(token);
    if (!cache) {
      cache = new Map();
      this.frameCache.set(token, cache);
    }
    if (cache.has(key)) {
      return cache.get(key) as T;
    }
    const value = compute();
    cache.set(key, value);
    return value;
  }

  /** Notified once per `beginFrame()` call — backs the reactive tier's `useSyncExternalStore` subscription. */
  subscribeFrame(cb: () => void): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  private timelineFor<T>(topic: string): ClientTimeline<T> {
    let timeline = this.timelines.get(topic);
    if (!timeline) {
      timeline = new ClientTimeline<T>(this.options.timelineOptions);
      this.timelines.set(topic, timeline as ClientTimeline<unknown>);
    }
    return timeline as ClientTimeline<T>;
  }
}
