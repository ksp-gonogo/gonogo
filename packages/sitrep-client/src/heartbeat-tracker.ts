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

  constructor(private readonly options: HeartbeatTrackerOptions = {}) {}

  /**
   * Record a confirmed arrival for `topic` at `deliveredAt` (UT). Call this
   * for EVERY ingested sample on the topic — keyframe or change-emission
   * alike, both count: a change emission also confirms the link is alive,
   * exactly like a keyframe would. Out-of-order arrivals never move the
   * tracked heartbeat backwards.
   */
  noteArrival(topic: string, deliveredAt: number): void {
    const prev = this.lastHeartbeatUt.get(topic);
    if (prev === undefined || deliveredAt > prev) {
      this.lastHeartbeatUt.set(topic, deliveredAt);
    }
  }

  /**
   * Drop every tracked heartbeat. Call on an epoch bump (quickload rewind)
   * so pre-reset heartbeat history can't leak a wrong-epoch expectation into
   * the resynchronizing period that follows (mirrors `ClientTimeline`'s own
   * per-epoch point drop, applied to this tracker's per-topic map instead).
   */
  reset(): void {
    this.lastHeartbeatUt.clear();
  }

  /** The keyframe interval (UT seconds) this tracker uses for `topic`. */
  intervalFor(topic: string): number {
    return (
      this.options.keyframeIntervalUt?.[topic] ??
      this.options.defaultKeyframeIntervalUt ??
      DEFAULT_KEYFRAME_INTERVAL_UT
    );
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
