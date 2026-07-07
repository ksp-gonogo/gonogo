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

  constructor(
    readonly clock: ViewClock,
    private readonly options: TimelineStoreOptions = {},
  ) {
    this.currentToken = { viewUt: clock.viewUt() };
  }

  /**
   * Append a delivered sample for `topic` and feed its timing into the
   * shared `ViewClock`. Does NOT advance the frame — ingest and frame
   * advance are independent (many samples can arrive within one frame; the
   * frame only advances on `beginFrame()`).
   */
  ingest<T>(topic: string, point: TimelinePoint<T>): void {
    this.timelineFor<T>(topic).append(point);
    this.clock.observeSample(
      point.validAt,
      point.meta.deliveredAt,
      point.epoch,
    );
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
    this.currentToken = { viewUt: this.clock.viewUt() };
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
   */
  sample<T>(
    topic: string,
    token: FrameToken = this.currentToken,
  ): TimelinePoint<T> | undefined {
    return this.timelineFor<T>(topic).at(token.viewUt);
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
