import type { Meta } from "@gonogo/sitrep-sdk";

/**
 * One point on a topic's `ClientTimeline`.
 *
 * `payload: null` is a tombstone (absence-as-data, M2 design §4) — a
 * confirmed "there is no value", distinct from `undefined` (never received).
 * `meta` is kept whole (not just the payload) because quality-picking,
 * subject-provenance guarding (`sameSubject`, later task), and staleness all
 * need fields beyond the value itself.
 *
 * `epoch` is the client-side timeline-reset generation this point was
 * ingested under (mirrors `meta.timelineEpoch`, copied in verbatim by
 * whoever constructs the point — `ClientTimeline.append` trusts it, it does
 * not re-derive it from `meta`).
 */
export interface TimelinePoint<T = unknown> {
  validAt: number;
  payload: T | null;
  meta: Meta;
  epoch: number;
}

export interface ClientTimelineOptions {
  /**
   * How far behind the latest ingested `validAt` points are retained before
   * being evicted automatically. Foundation-level default; a later task may
   * additionally call `evictBelow` with the real confirmed-edge-minus-delay
   * bound once a `ViewClock`/subscription option is wired in. Default is
   * generous (5 minutes of UT) — tight enough to bound memory, loose enough
   * not to surprise a topic with no external eviction driver.
   */
  retentionSeconds?: number;
}

const DEFAULT_RETENTION_SECONDS = 300;

/**
 * Per-topic buffer of delivered samples, insert-sorted by `validAt` (samples
 * can arrive out of order — per-topic delays differ once comms modelling
 * lands, and the server's `Archive.Record` makes the same allowance).
 *
 * Bounded to a retention window behind the latest ingested sample so a
 * long-running client doesn't grow this unboundedly — see
 * `ClientTimelineOptions.retentionSeconds` and `evictBelow`.
 *
 * Epoch-aware (M2 design §3.4/§7.6, "client-side ghost avoidance"): a
 * quickload rewind is detected per-topic from the incoming sample's own
 * `epoch` field (no separate reset message needed at this layer) —
 *
 * - a sample from a LOWER epoch than the timeline currently holds is a
 *   stale straggler (e.g. queued behind the rewind) and is discarded on
 *   arrival;
 * - a sample from a HIGHER epoch is a rewind: every existing point is
 *   dropped atomically and the timeline adopts the new epoch before the
 *   incoming point is appended. This is the client analog of the server's
 *   `Archive.ResetTimeline` — get it wrong and stale pre-rewind data can be
 *   read forever after the epoch bump (the "stale ghost" defect the server
 *   side already fixed).
 */
export class ClientTimeline<T = unknown> {
  private points: TimelinePoint<T>[] = [];
  private currentEpoch = 0;
  private readonly retentionSeconds: number;

  /** Bumped on every append that changes the buffer (insert or epoch-reset). Memo key for later tasks. */
  revision = 0;

  constructor(options: ClientTimelineOptions = {}) {
    this.retentionSeconds =
      options.retentionSeconds ?? DEFAULT_RETENTION_SECONDS;
  }

  /** The epoch this timeline currently holds points for. */
  get epoch(): number {
    return this.currentEpoch;
  }

  /** Insert a delivered sample, sorted by `validAt` (tie-break: `meta.seq`). */
  append(point: TimelinePoint<T>): void {
    if (point.epoch < this.currentEpoch) {
      // Stale-epoch straggler (queued behind a rewind broadcast) — never
      // let pre-rewind data re-enter a post-rewind timeline.
      return;
    }
    if (point.epoch > this.currentEpoch) {
      // Rewind: the superseded timeline is dead. Drop it atomically before
      // adopting the new epoch, so there is no window where a read could
      // see a mix of old and new epoch's points.
      this.points = [];
      this.currentEpoch = point.epoch;
    }

    const index = this.insertionIndex(point);
    this.points.splice(index, 0, point);
    this.revision++;

    this.autoEvict();
  }

  /** Latest point with `validAt <= ut` (current epoch only — the buffer never holds stale-epoch points). */
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
   * The pair of points straddling `ut` — `[before, after]` where
   * `before.validAt <= ut < after.validAt`. Undefined when `ut` is before
   * the first point or at-or-after the last (nothing to interpolate
   * towards). A hold-last read (`at`) is what T2 consumers use; interpolation
   * lands in a later task — this is the seam it will use.
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

  /** The most recently ingested point — the confirmed edge for this topic. */
  latest(): TimelinePoint<T> | undefined {
    return this.points[this.points.length - 1];
  }

  /**
   * Proactively adopt a higher epoch with no incoming sample — a no-op if
   * `epoch` isn't actually higher than the one this timeline currently
   * holds. Used by `TimelineStore`'s cross-topic sweep (M2 fix-report
   * Defect 1+2, "the client ghost"): a rewind confirmed by one topic's
   * ingest doesn't, on its own, tell every OTHER topic's `ClientTimeline` to
   * reset — each timeline only ever learns about a rewind from its own next
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
    this.evictBelow(latest.validAt - this.retentionSeconds);
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
