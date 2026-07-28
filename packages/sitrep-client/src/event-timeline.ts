/**
 * One discrete occurrence on an `event` topic.
 *
 * An `event` topic is the discrete-occurrence sibling of `ClientTimeline` /
 * `TimelinePoint`: where a value channel is a keyframed timeline that a value
 * *holds* across (read with `at(ut)`), an event topic is a timeline of things
 * that *happened* at a UT (part-failed, storm-arrived, camera-added). Each
 * occurrence is an edge, not a level, it never "holds", it fires once.
 *
 * Delivered discretely (`Delivery.ReliableOrdered` on the wire, the same lane
 * as `flight.started` / `crash.lastCrash`) and reveal-gated: an occurrence at
 * `ut` becomes visible only once `now >= ut + delay` AND the comms link was up
 * at `ut`. Reveal here is DERIVED for legibility, enforcement stays
 * server-side in the mod's reveal gate (see `project_streaming_delay_model`).
 * The gonogo Uplink layer that owns reveal/delay semantics synthesises this
 * primitive from a producer's raw discrete edges (see the kerbcast-Uplink
 * decision, `local_docs/kerbalism-RO-design-DECISIONS.md` §New PRIMITIVES).
 *
 * `epoch` is the client-side timeline-reset generation this occurrence was
 * ingested under (mirrors `TimelinePoint.epoch`): a quickload rewind bumps the
 * epoch and drops superseded occurrences so a pre-rewind event can never be
 * re-revealed after the rewind.
 */
export interface EventOccurrence<K extends string = string, P = unknown> {
  /** Universal Time the occurrence happened at: the reveal-gate key. */
  ut: number;
  /** Discriminant naming what happened, e.g. `"part-failed"`, `"storm-arrived"`. */
  kind: K;
  /** Occurrence detail. */
  payload: P;
  /** Client-side timeline-reset generation (mirrors `TimelinePoint.epoch`). */
  epoch: number;
}

/**
 * Was the comms link up at a given UT? Mirrors the server reveal gate's
 * `ConnectivityAt(ut)`: an occurrence whose `ut` fell during a blackout is
 * dropped forever, never revealed late once the link returns.
 */
export type ConnectivityAt = (ut: number) => boolean;

export interface EventRevealOptions {
  /**
   * Current view UT. An occurrence reveals only once `now >= ut + delaySeconds`,
   * the delayed-horizon check.
   */
  now: number;
  /**
   * One-way signal delay applied before an occurrence reveals, seconds.
   * Default 0 (LAN / `DelayRole.TrueNow`).
   */
  delaySeconds?: number;
  /**
   * Connectivity oracle. An occurrence at a `ut` the link was DOWN for is
   * dropped forever, matching the server gate `now >= ut + delay &&
   * ConnectivityAt(ut)`. Default: always connected.
   */
  connectivityAt?: ConnectivityAt;
}

export interface EventTimelineOptions {
  /**
   * How far behind the latest ingested occurrence `ut` older occurrences are
   * retained before automatic eviction. Mirrors `ClientTimelineOptions`;
   * default 5 minutes of UT: bounds memory without surprising a low-rate
   * event topic.
   */
  retentionSeconds?: number;
}

const DEFAULT_RETENTION_SECONDS = 300;

/**
 * Per-topic buffer of discrete occurrences, insert-sorted by `ut` (occurrences
 * can arrive out of order, same allowance as `ClientTimeline`). This is the
 * event sibling of `ClientTimeline`: it stores edges and exposes a reveal-gated
 * read (`revealed`) rather than a hold-last value read (`at`).
 *
 * Epoch-aware, identically to `ClientTimeline`: a lower-epoch occurrence is a
 * stale straggler and is discarded; a higher-epoch occurrence is a rewind that
 * drops every buffered occurrence atomically before adopting the new epoch.
 */
export class EventTimeline<K extends string = string, P = unknown> {
  private occurrences: EventOccurrence<K, P>[] = [];
  private currentEpoch = 0;
  private readonly retentionSeconds: number;

  /** Bumped on every append that changes the buffer (insert or epoch-reset). */
  revision = 0;

  constructor(options: EventTimelineOptions = {}) {
    this.retentionSeconds =
      options.retentionSeconds ?? DEFAULT_RETENTION_SECONDS;
  }

  /** The epoch this timeline currently holds occurrences for. */
  get epoch(): number {
    return this.currentEpoch;
  }

  /** Insert a delivered occurrence, sorted by `ut` (ties keep arrival order). */
  append(occurrence: EventOccurrence<K, P>): void {
    if (occurrence.epoch < this.currentEpoch) {
      // Stale-epoch straggler (queued behind a rewind): never let a
      // pre-rewind occurrence re-enter a post-rewind timeline.
      return;
    }
    if (occurrence.epoch > this.currentEpoch) {
      // Rewind: the superseded timeline is dead. Drop it atomically before
      // adopting the new epoch, so no read can see a mix of epochs.
      this.occurrences = [];
      this.currentEpoch = occurrence.epoch;
    }

    const index = this.insertionIndex(occurrence);
    this.occurrences.splice(index, 0, occurrence);
    this.revision++;

    this.autoEvict();
  }

  /**
   * The occurrences visible at `now` under the reveal gate, those matured
   * past the delay horizon (`now >= ut + delay`) whose `ut` fell while the
   * link was up. Ascending by `ut`. This is the DERIVED reveal a consumer
   * (e.g. the alarm `event` trigger) reads; the server enforces the same gate
   * authoritatively upstream.
   */
  revealed(options: EventRevealOptions): EventOccurrence<K, P>[] {
    const { now } = options;
    const delaySeconds = options.delaySeconds ?? 0;
    const connectivityAt = options.connectivityAt;
    return this.occurrences.filter((o) => {
      if (now < o.ut + delaySeconds) return false;
      if (connectivityAt && !connectivityAt(o.ut)) return false;
      return true;
    });
  }

  /**
   * Every buffered occurrence, ascending by `ut`, WITHOUT reveal-gating,
   * i.e. what has been received, not what is visible. Consumers that care
   * about legibility want `revealed`; this is the raw view for producers and
   * tests.
   */
  all(): EventOccurrence<K, P>[] {
    return [...this.occurrences];
  }

  /** All occurrences with `ut` in `[fromUt, toUt]`, inclusive, ascending. */
  range(fromUt: number, toUt: number): EventOccurrence<K, P>[] {
    return this.occurrences.filter((o) => o.ut >= fromUt && o.ut <= toUt);
  }

  /** All occurrences strictly after `ut`, ascending. */
  since(ut: number): EventOccurrence<K, P>[] {
    return this.occurrences.filter((o) => o.ut > ut);
  }

  /** The most recently occurring buffered occurrence. */
  latest(): EventOccurrence<K, P> | undefined {
    return this.occurrences[this.occurrences.length - 1];
  }

  /**
   * Proactively adopt a higher epoch with no incoming occurrence, a no-op if
   * `epoch` isn't higher than the one currently held. The cross-topic rewind
   * sweep analog of `ClientTimeline.adoptEpoch`: a rewind confirmed by one
   * topic's ingest tells every other topic's timeline to drop immediately.
   */
  adoptEpoch(epoch: number): void {
    if (epoch <= this.currentEpoch) return;
    this.occurrences = [];
    this.currentEpoch = epoch;
    this.revision++;
  }

  /** Drop every occurrence with `ut < ut`. Enforces an external retention bound. */
  evictBelow(ut: number): void {
    const next = this.occurrences.filter((o) => o.ut >= ut);
    if (next.length === this.occurrences.length) return;
    this.occurrences = next;
    this.revision++;
  }

  private autoEvict(): void {
    const latest = this.latest();
    if (!latest) return;
    this.evictBelow(latest.ut - this.retentionSeconds);
  }

  private insertionIndex(occurrence: EventOccurrence<K, P>): number {
    // Linear scan from the end: append-mostly workload (occurrences usually
    // arrive newest-last), so O(1) amortized despite O(n) worst case. Ties on
    // `ut` keep arrival order (new one after the existing) so a reliable-ordered
    // burst at one UT stays in wire order.
    let i = this.occurrences.length;
    while (i > 0 && this.occurrences[i - 1].ut > occurrence.ut) {
      i--;
    }
    return i;
  }
}
