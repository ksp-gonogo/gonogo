import type { ViewClockConfidence } from "./view-clock";

/**
 * Fallback keyframe interval (UT seconds) for a topic that hasn't declared
 * its own. Matches the emitter's current uniform `KeyframeIntervalUt`
 * convention (`~30s UT` — see CLAUDE.md's CI/CD note and
 * `mod/Sitrep.Core/EmissionPolicy.cs`). A later task may thread the real
 * per-channel declaration through the handshake; until then every topic
 * shares this default unless overridden via `HeartbeatTrackerOptions`.
 */
export const DEFAULT_KEYFRAME_INTERVAL_UT = 30;

/**
 * How many recent inter-arrival gaps `HeartbeatTracker` keeps per topic to
 * learn its cadence (finding B item 2). A small rolling window rather than
 * an all-time average — a channel's real cadence can be assumed roughly
 * stationary over this many arrivals, and a small window lets a genuine
 * cadence CHANGE (not just a one-off blackout) actually take effect instead
 * of being diluted forever by history from before the change.
 */
const LEARN_WINDOW = 5;

/**
 * Minimum observed gaps (i.e. `arrivals - 1`) before a learned interval is
 * trusted over the configured default (finding B item 2: "fall back to the
 * default until enough arrivals are seen"). Two gaps is the smallest sample
 * that still lets the median estimator (`medianOf`) be meaningfully
 * "middle" rather than just parroting the one gap seen so far.
 */
const MIN_GAPS_TO_LEARN = 2;

/** The middle value of `values` (average of the two middles for an even-length input) — a robust central estimate that isn't dragged by a single outlier the way a mean would be, as long as it stays a minority of the window (finding B item 2: "don't let one long gap poison the learned interval"). */
function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export interface HeartbeatTrackerOptions {
  /** Fallback keyframe interval (UT seconds) for any topic not listed in `keyframeIntervalUt`. Default `DEFAULT_KEYFRAME_INTERVAL_UT`. */
  defaultKeyframeIntervalUt?: number;
  /** Per-topic keyframe interval (UT seconds) overrides. */
  keyframeIntervalUt?: Record<string, number>;
  /** Multiplier applied to the keyframe interval for the base margin (on top of one full interval of slack). Default 1. */
  marginMultiplier?: number;
  /** Extra flat UT-seconds of jitter allowance, added to the base margin regardless of confidence. Default 0. */
  jitterAllowanceUt?: number;
  /** Multiplier applied to the WHOLE margin when `ViewClock.confidence()` is not `"locked"` (M2 design §4.3/§7.1: "a degraded estimate widens the staleness window rather than false-flagging"). Default 3. */
  degradedMarginMultiplier?: number;
}

/**
 * Client-side `HeldStale` inference (M2 design §4.3: "the keyframe cadence
 * IS the heartbeat"). Tracks, per topic, the UT at which the last sample
 * actually ARRIVED (`meta.deliveredAt` — the post-delay, vantage-read UT,
 * per the design's own definition: "`meta.deliveredAt` is the UT it arrived
 * at the vantage") and reports a topic overdue once the current view UT
 * passes `lastHeartbeatUt + keyframeInterval + margin`.
 *
 * **Deliberately never reads `validAt` anywhere in this file — it isn't even
 * a parameter of `noteArrival`.** That's the structural version of the
 * design's central warning: "an old `validAt` on a change-gated channel is
 * normal... staleness comes from missed heartbeat keyframes... never from
 * `now - validAt`" (M2 design §0/§4.1). A channel whose VALUE hasn't changed
 * for a long time (a frozen/old `validAt`) but whose keyframes keep arriving
 * on schedule (a fresh `deliveredAt` every interval — a keyframe
 * unconditionally re-announces even an unchanged value) never gets flagged
 * here; only an actual gap in ARRIVALS does. See `timeline-store.test.ts`'s
 * "the trap" describe block for the end-to-end proof.
 *
 * `deliveredAt` is used as the sole heartbeat signal rather than the design
 * doc's own `lastPoint.validAt + interval + delaySeconds` sketch (M2 design
 * §4.3), because `deliveredAt` for a given sample already IS its post-delay
 * arrival UT — re-adding a separately-modeled `delaySeconds` on top would
 * double-count it, and anchoring on the actually-OBSERVED arrival is more
 * robust to delay CHANGES mid-flight than re-deriving delay from a separate
 * authority every time.
 */
export class HeartbeatTracker {
  private readonly lastHeartbeatUt = new Map<string, number>();
  /** Rolling window of recent inter-arrival gaps (UT seconds) per topic — the raw material `intervalFor` learns a per-channel cadence from (finding B item 2). Capped at `LEARN_WINDOW`, oldest dropped first. */
  private readonly recentGapsUt = new Map<string, number[]>();

  constructor(private readonly options: HeartbeatTrackerOptions = {}) {}

  /**
   * Record a confirmed arrival for `topic` at `deliveredAt` (UT). Call this
   * for EVERY ingested sample on the topic — keyframe or change-emission
   * alike, both count: a change emission also confirms the link is alive,
   * exactly like a keyframe would. Out-of-order arrivals never move the
   * tracked heartbeat backwards, and — since they're not a genuine forward
   * gap — never feed the adaptive cadence learner either.
   */
  noteArrival(topic: string, deliveredAt: number): void {
    const prev = this.lastHeartbeatUt.get(topic);
    if (prev === undefined || deliveredAt > prev) {
      if (prev !== undefined) this.recordGap(topic, deliveredAt - prev);
      this.lastHeartbeatUt.set(topic, deliveredAt);
    }
  }

  /**
   * Drop every tracked heartbeat AND every learned cadence. Call on an epoch
   * bump (quickload rewind) so pre-reset heartbeat/cadence history can't
   * leak a wrong-epoch expectation into the resynchronizing period that
   * follows (mirrors `ClientTimeline`'s own per-epoch point drop, applied to
   * this tracker's per-topic maps instead).
   */
  reset(): void {
    this.lastHeartbeatUt.clear();
    this.recentGapsUt.clear();
  }

  /**
   * The keyframe interval (UT seconds) this tracker uses for `topic` —
   * finding B item 2's adaptive cadence. Precedence, most to least
   * authoritative:
   * 1. An explicit per-topic `keyframeIntervalUt` override — a caller that
   *    declared one always wins, learned or not.
   * 2. The LEARNED interval (`medianOf` of `recentGapsUt`), once at least
   *    `MIN_GAPS_TO_LEARN` genuine forward gaps have been observed for this
   *    topic — different channels keyframe at different cadences, and this
   *    is what replaces a one-size-fits-all default with the channel's own
   *    OBSERVED cadence, without needing a server handshake.
   * 3. The configured/default fallback, for a topic with too little history
   *    to trust yet (cold start, or right after a `reset()`).
   */
  intervalFor(topic: string): number {
    const explicit = this.options.keyframeIntervalUt?.[topic];
    if (explicit !== undefined) return explicit;

    const learned = this.learnedIntervalFor(topic);
    if (learned !== undefined) return learned;

    return (
      this.options.defaultKeyframeIntervalUt ?? DEFAULT_KEYFRAME_INTERVAL_UT
    );
  }

  /** The learned interval for `topic`, or `undefined` if too few gaps have been observed yet to trust it (see `intervalFor`'s doc). */
  private learnedIntervalFor(topic: string): number | undefined {
    const gaps = this.recentGapsUt.get(topic);
    if (!gaps || gaps.length < MIN_GAPS_TO_LEARN) return undefined;
    return medianOf(gaps);
  }

  /** Append one observed inter-arrival gap to `topic`'s rolling window, evicting the oldest once it exceeds `LEARN_WINDOW`. */
  private recordGap(topic: string, gapUt: number): void {
    let gaps = this.recentGapsUt.get(topic);
    if (!gaps) {
      gaps = [];
      this.recentGapsUt.set(topic, gaps);
    }
    gaps.push(gapUt);
    if (gaps.length > LEARN_WINDOW) gaps.shift();
  }

  /**
   * The staleness margin (UT seconds) added on top of the raw keyframe
   * interval before a missed heartbeat is flagged — confidence-scaled per M2
   * design §4.3/§7.1. Exposed publicly (not just folded into `isOverdue`) so
   * tests can assert directly that the margin widens under a degraded
   * estimate.
   */
  marginUt(topic: string, confidence: ViewClockConfidence): number {
    const interval = this.intervalFor(topic);
    const base =
      interval * (this.options.marginMultiplier ?? 1) +
      (this.options.jitterAllowanceUt ?? 0);
    return confidence === "locked"
      ? base
      : base * (this.options.degradedMarginMultiplier ?? 3);
  }

  /**
   * Has `topic` missed its expected next heartbeat as of `viewUt`? A topic
   * with no recorded arrival at all is NOT reported overdue here — that's
   * the `"resyncing"` case (no point at all), handled one layer up in
   * `TimelineStore.sampleStatus`; a heartbeat miss is specifically about a
   * topic we HAVE heard from before going quiet.
   */
  isOverdue(
    topic: string,
    viewUt: number,
    confidence: ViewClockConfidence,
  ): boolean {
    const last = this.lastHeartbeatUt.get(topic);
    if (last === undefined) return false;
    return (
      viewUt > last + this.intervalFor(topic) + this.marginUt(topic, confidence)
    );
  }
}
