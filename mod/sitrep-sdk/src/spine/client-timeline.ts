import type { TimelinePoint } from "../timeline";

/**
 * `TimelinePoint` moved to `@ksp-gonogo/sitrep-sdk`: an Uplink writing a derived
 * channel has to name one, and it cannot import this package. Re-exported so
 * app-side imports read the same.
 */

export type { TimelinePoint } from "../timeline";

export interface ClientTimelineOptions {
  /**
   * An OPT-IN ceiling on how far behind the latest ingested `validAt` points
   * are retained. Unset (and nothing in production sets it) means no UT bound
   * at all: `maxPoints` is the always-on one.
   *
   * It used to default to 300 and be the only bound, and that was wrong in both
   * directions. A UT window bounds MEMORY only if you assume a sample rate, so
   * it held a few dozen points of a slow channel and thousands of a fast one
   * for the same nominal cost. And its floor is measured from `latest.validAt`,
   * which a landed blackout dump moves: a dump spanning more than the window
   * destroyed its own oldest half, and the pre-outage tail with it, the instant
   * it arrived. That is the failure this option now exists to stay out of the
   * way of, so set it only for a consumer that genuinely wants a fixed-UT view
   * and can afford to lose a wider dump.
   */
  retentionSeconds?: number;

  /**
   * The always-on bound: at most this many points per topic, dropping the
   * OLDEST to make room. Bounds memory directly rather than through an assumed
   * sample rate, and is indifferent to how much UT a burst spans, so a blackout
   * dump survives ingest whatever its width.
   *
   * Drop-oldest matches the server-side recorder's own overrun policy
   * (`ChannelEngine.RecorderCapacityPerTopic`) so the two do not fight: the
   * span nearest the live edge is the one both keep. What a drop cost is
   * readable off `droppedThroughUt` rather than left to be inferred from a
   * hole.
   *
   * 1500, which is about what the old 300s window held for a channel emitting
   * at 4 Hz, so the busiest topic's footprint is unchanged and every slower one
   * simply keeps more history than it used to.
   */
  maxPoints?: number;
}

const DEFAULT_MAX_POINTS = 1500;

/**
 * Per-topic buffer of delivered samples, insert-sorted by `validAt` (samples
 * can arrive out of order, per-topic delays differ once comms modelling
 * lands, and the server's `Archive.Record` makes the same allowance).
 *
 * Bounded by POINT COUNT so a long-running client doesn't grow this
 * unboundedly, dropping the oldest and reporting the edge it dropped through:
 * see `ClientTimelineOptions.maxPoints` and `droppedThroughUt`. A UT window is
 * available on top (`retentionSeconds`) and nothing sets it; that option's own
 * doc has the history of why it stopped being the bound.
 *
 * Epoch-aware ("client-side ghost avoidance"): a
 * quickload rewind is detected per-topic from the incoming sample's own
 * `epoch` field (no separate reset message needed at this layer),
 *
 * - a sample from a LOWER epoch than the timeline currently holds is a
 *   stale straggler (e.g. queued behind the rewind) and is discarded on
 *   arrival;
 * - a sample from a HIGHER epoch is a rewind: every existing point is
 *   dropped atomically and the timeline adopts the new epoch before the
 *   incoming point is appended. This is the client analog of the server's
 *   `Archive.ResetTimeline`: get it wrong and stale pre-rewind data can be
 *   read forever after the epoch bump (the "stale ghost" defect the server
 *   side already fixed).
 */
export class ClientTimeline<T = unknown> {
  private points: TimelinePoint<T>[] = [];
  private currentEpoch = 0;
  private readonly retentionSeconds: number | undefined;
  private readonly maxPoints: number;
  private droppedThrough: number | undefined;

  /** Bumped on every append that changes the buffer (insert or epoch-reset). Memo key for later tasks. */
  revision = 0;

  constructor(options: ClientTimelineOptions = {}) {
    this.retentionSeconds = options.retentionSeconds;
    this.maxPoints = options.maxPoints ?? DEFAULT_MAX_POINTS;
  }

  /**
   * The `validAt` of the newest point this timeline has dropped to stay inside
   * its own bound, or `undefined` while nothing has been dropped. Data existed
   * at-or-below it and this client no longer has it.
   *
   * The client-side twin of the server's `Meta.gapSinceUt`, and separate from it
   * because the two say different things: that one reports what the SUBJECT
   * could not send, this one what the VIEWER could not keep. A consumer reading
   * a range that starts at-or-below this UT is looking at a truncated span, and
   * has to be told rather than shown a chart that simply starts later and looks
   * complete.
   *
   * Reset by a rewind (`adoptEpoch` / a higher-epoch append), because it
   * describes a record that no longer exists.
   */
  get droppedThroughUt(): number | undefined {
    return this.droppedThrough;
  }

  /** The epoch this timeline currently holds points for. */
  get epoch(): number {
    return this.currentEpoch;
  }

  /** Insert a delivered sample, sorted by `validAt` (tie-break: `meta.seq`). */
  append(point: TimelinePoint<T>): void {
    if (point.epoch < this.currentEpoch) {
      // Stale-epoch straggler (queued behind a rewind broadcast); never
      // let pre-rewind data re-enter a post-rewind timeline.
      return;
    }
    if (point.epoch > this.currentEpoch) {
      // Rewind: the superseded timeline is dead. Drop it atomically before
      // adopting the new epoch, so there is no window where a read could
      // see a mix of old and new epoch's points.
      this.points = [];
      this.currentEpoch = point.epoch;
      this.droppedThrough = undefined;
    }

    const index = this.insertionIndex(point);
    this.points.splice(index, 0, point);
    this.revision++;

    this.autoEvict();
  }

  /** Latest point with `validAt <= ut` (current epoch only, the buffer never holds stale-epoch points). */
  at(ut: number): TimelinePoint<T> | undefined {
    // points are sorted ascending by validAt; scan back from the end since
    // reads cluster near the live edge.
    for (let i = this.points.length - 1; i >= 0; i--) {
      const point = this.points[i];
      if (point.validAt <= ut) return point;
    }
    return undefined;
  }

  /**
   * The pair of points straddling `ut`, `[before, after]` where
   * `before.validAt <= ut < after.validAt`. Undefined when `ut` is before
   * the first point or at-or-after the last (nothing to interpolate
   * towards). A hold-last read (`at`) is what T2 consumers use; interpolation
   * lands in a later task: this is the seam it will use.
   */
  straddle(ut: number): [TimelinePoint<T>, TimelinePoint<T>] | undefined {
    for (let i = 0; i < this.points.length - 1; i++) {
      const before = this.points[i];
      const after = this.points[i + 1];
      if (before.validAt <= ut && ut < after.validAt) return [before, after];
    }
    return undefined;
  }

  /** All points with `validAt` in `[fromUt, toUt]`, inclusive. */
  range(fromUt: number, toUt: number): TimelinePoint<T>[] {
    return this.points.filter((p) => p.validAt >= fromUt && p.validAt <= toUt);
  }

  /** The most recently ingested point: the confirmed edge for this topic. */
  latest(): TimelinePoint<T> | undefined {
    return this.points[this.points.length - 1];
  }

  /**
   * Proactively adopt a higher epoch with no incoming sample, a no-op if
   * `epoch` isn't actually higher than the one this timeline currently
   * holds. Used by `TimelineStore`'s cross-topic sweep (guards against
   * "the client ghost"): a rewind confirmed by one topic's
   * ingest doesn't, on its own, tell every OTHER topic's `ClientTimeline` to
   * reset: each timeline only ever learns about a rewind from its own next
   * `append`. Without this, a slow/change-gated topic that hasn't re-sampled
   * since the rewind keeps serving its dead-epoch points indefinitely. The
   * store calls this on every registered timeline the instant any topic's
   * `append` bumps the shared epoch, so the drop happens immediately rather
   * than waiting for that topic's next sample.
   */
  adoptEpoch(epoch: number): void {
    if (epoch <= this.currentEpoch) return;
    this.points = [];
    this.currentEpoch = epoch;
    this.droppedThrough = undefined;
    this.revision++;
  }

  /** Drop every point with `validAt < ut`. Used to enforce an externally-computed retention bound (e.g. the real delay window). */
  evictBelow(ut: number): void {
    const next = this.points.filter((p) => p.validAt >= ut);
    if (next.length === this.points.length) return;
    this.points = next;
    this.revision++;
  }

  private autoEvict(): void {
    const latest = this.latest();
    if (!latest) return;
    if (this.retentionSeconds !== undefined) {
      this.evictBelow(latest.validAt - this.retentionSeconds);
    }
    if (this.points.length <= this.maxPoints) return;
    const surplus = this.points.length - this.maxPoints;
    // Read the drop edge BEFORE splicing: it is the newest point going, which
    // is the one at the boundary.
    this.droppedThrough = this.points[surplus - 1].validAt;
    this.points.splice(0, surplus);
    this.revision++;
  }

  private insertionIndex(point: TimelinePoint<T>): number {
    // Linear scan from the end: append-mostly workload (new samples are
    // usually the newest), so this is O(1) amortized in the common case
    // despite being O(n) worst case for genuinely out-of-order delivery.
    let i = this.points.length;
    while (i > 0) {
      const prev = this.points[i - 1];
      if (
        prev.validAt < point.validAt ||
        (prev.validAt === point.validAt && prev.meta.seq <= point.meta.seq)
      ) {
        break;
      }
      i--;
    }
    return i;
  }
}
