/**
 * One thing that happened at a moment, such as a part failing or a storm
 * arriving, as an {@link EventTimeline} holds it. Unlike a Topic's value, an
 * occurrence does not stay true afterwards: it happens once.
 *
 * @typeParam Kind - The names of what can happen, such as `"part-failed"`.
 * @typeParam Payload - The detail each occurrence carries.
 *
 * @category Delay and vantage
 */
export interface EventOccurrence<
  Kind extends string = string,
  Payload = unknown,
> {
  /** The UT it happened at. */
  ut: number;
  /** What happened, such as `"part-failed"` or `"storm-arrived"`. */
  kind: Kind;
  /** The detail of what happened. */
  payload: Payload;
  /**
   * The timeline generation it was received in. Loading a save moves the
   * timeline to a new generation, and occurrences from an older one are
   * discarded.
   */
  epoch: number;
}

/**
 * Returns whether the link to the craft was up at `ut`. An occurrence that
 * happened while the link was down is never revealed, even after the link
 * returns.
 *
 * @category Delay and vantage
 */
export type ConnectivityAt = (ut: number) => boolean;

/**
 * When {@link EventTimeline.revealed} shows an occurrence: once the view time
 * has passed its UT plus the signal delay, and only if the link was up when it
 * happened.
 *
 * @category Delay and vantage
 */
export interface EventRevealOptions {
  /** The view UT. An occurrence is revealed once `now` reaches its UT plus `delaySeconds`. */
  now: number;
  /** The one-way signal delay, in seconds. Defaults to 0. */
  delaySeconds?: number;
  /** Whether the link was up at a given UT. Defaults to a link that is always up. */
  connectivityAt?: ConnectivityAt;
}

/**
 * Options for a new {@link EventTimeline}.
 *
 * @category Delay and vantage
 */
export interface EventTimelineOptions {
  /**
   * How many seconds of UT behind the newest occurrence to keep. Older ones are
   * removed as new ones arrive. Defaults to 300.
   */
  retentionSeconds?: number;
}

const DEFAULT_RETENTION_SECONDS = 300;

/**
 * The occurrences received on one event Topic, sorted by UT, with
 * {@link EventTimeline.revealed} returning those the operator may see yet under
 * the signal delay. Occurrences may be appended out of order.
 *
 * Appending an occurrence from a newer generation (`epoch`) clears everything
 * held first, and one from an older generation is ignored, so nothing from
 * before a save was loaded comes back.
 *
 * @typeParam Kind - The names of what can happen.
 * @typeParam Payload - The detail each occurrence carries.
 *
 * @category Delay and vantage
 */
export class EventTimeline<Kind extends string = string, Payload = unknown> {
  private occurrences: EventOccurrence<Kind, Payload>[] = [];
  private currentEpoch = 0;
  private readonly retentionSeconds: number;

  /** Increases whenever the occurrences held change. */
  revision = 0;

  constructor(options: EventTimelineOptions = {}) {
    this.retentionSeconds =
      options.retentionSeconds ?? DEFAULT_RETENTION_SECONDS;
  }

  /** The generation of the occurrences held now. */
  get epoch(): number {
    return this.currentEpoch;
  }

  /** Adds an occurrence in UT order. Occurrences at the same UT keep the order they were appended in. */
  append(occurrence: EventOccurrence<Kind, Payload>): void {
    if (occurrence.epoch < this.currentEpoch) {
      // Stale-epoch straggler (queued behind a rewind): never let a pre-rewind occurrence re-enter a post-rewind timeline.
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
   * Returns the occurrences the operator may see at `now`, oldest first: those
   * whose UT plus the delay has passed, and which happened while the link was
   * up.
   */
  revealed(options: EventRevealOptions): EventOccurrence<Kind, Payload>[] {
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
   * Returns every occurrence received, oldest first, whether or not it may be
   * seen yet. To show occurrences, use `revealed`.
   */
  all(): EventOccurrence<Kind, Payload>[] {
    return [...this.occurrences];
  }

  /** Returns the occurrences from `fromUt` to `toUt` inclusive, oldest first, without the delay. */
  range(fromUt: number, toUt: number): EventOccurrence<Kind, Payload>[] {
    return this.occurrences.filter((o) => o.ut >= fromUt && o.ut <= toUt);
  }

  /** Returns the occurrences after `ut`, oldest first, without the delay. */
  since(ut: number): EventOccurrence<Kind, Payload>[] {
    return this.occurrences.filter((o) => o.ut > ut);
  }

  /** Returns the occurrence with the latest UT, without the delay. */
  latest(): EventOccurrence<Kind, Payload> | undefined {
    return this.occurrences[this.occurrences.length - 1];
  }

  /**
   * Moves to a newer generation, clearing every occurrence held. Does nothing
   * when `epoch` is not newer than the one held.
   */
  adoptEpoch(epoch: number): void {
    if (epoch <= this.currentEpoch) return;
    this.occurrences = [];
    this.currentEpoch = epoch;
    this.revision++;
  }

  /** Removes every occurrence before `ut`. */
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

  private insertionIndex(occurrence: EventOccurrence<Kind, Payload>): number {
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
