/**
 * One camera frame's capture stamp: the RTP timestamp its packets carry, the
 * universal time it was rendered at, and the capture epoch that UT belongs to.
 * Useful for dating a delayed video frame from the camera itself rather than
 * from a clock sampled about once a second. Delivered by a
 * {@link FrameStampFeed}.
 *
 * @category Delayed video
 */
export interface FrameStamp {
  /** RTP timestamp (90 kHz, 32-bit, wrapping) of the frame on this connection. */
  rtpTimestamp: number;
  /** KSP universal time (seconds) the frame was rendered at. */
  ut: number;
  /** Capture epoch `ut` belongs to; it changes on a revert, quickload or scene reload. */
  epoch: number;
}

/**
 * A source of {@link FrameStamp}s: the camera Uplink's control channel.
 * `subscribe` calls `listener` for each stamp as it arrives and returns a
 * function that stops it. Useful for handing a camera's per-frame stamps to the
 * video delay. Taken by the delay pipelines through their `frameStamps` option.
 *
 * @category Delayed video
 */
export interface FrameStampFeed {
  /** Calls `listener` for each stamp as it arrives. Returns the function that stops it. */
  subscribe(listener: (stamp: FrameStamp) => void): () => void;
}

/**
 * How a frame's UT was worked out: `exact` from its own stamp, `interpolated`
 * from the stamps either side of it, `extrapolated` from the rate of the two
 * newest stamps when the frame is newer than every stamp so far, `held` at the
 * newest stamp when there is no rate to go on.
 *
 * @category Delayed video
 */
export type FrameStampSource =
  | "exact"
  | "interpolated"
  | "extrapolated"
  | "held";

/**
 * The UT of one frame as {@link FrameStampTimeline.utFor} worked it out. Useful
 * for stamping a delayed video frame with the time it was captured.
 *
 * @category Delayed video
 */
export interface FrameStampLookup {
  /** KSP universal time (seconds) the frame was rendered at. */
  ut: number;
  /** Capture epoch `ut` belongs to. */
  epoch: number;
  /** How `ut` was worked out. */
  source: FrameStampSource;
}

/** Furthest, in RTP ticks, a frame is dated past the newest stamp: 0.5 s. */
const MAX_EXTRAPOLATION_TICKS = 45000;

/** Stamps kept: about 8 s of 60 fps video, far past any jitter buffer. */
const HISTORY = 512;

/** Furthest, in RTP ticks, a stamp may arrive behind the newest and still be a reordered one: 5 s. */
const MAX_REORDER_TICKS = 450000;

/** Seconds of UT a stamp may fall behind the newest before it can only be a restart. */
const UT_BACKSTEP_SECONDS = 1;

/** Game seconds per video second a reordered stamp may be behind by: well above any warp a camera sees. */
const MAX_UT_PER_VIDEO_SECOND = 4;

const RTP_PER_SECOND = 90000;

const RTP_MODULUS = 2 ** 32;
const RTP_HALF = 2 ** 31;

/**
 * The capture stamps of one camera's recent frames, answering "what UT was the
 * frame with this RTP timestamp rendered at". A frame whose own stamp was
 * dropped is dated from the stamps either side of it; one newer than every
 * stamp so far is carried forward at the rate of the two newest, for at most
 * half a second, then held. A stamp carrying
 * a new epoch discards every earlier one, since their UTs belong to a timeline
 * that no longer exists. So does one that can only come from a restarted
 * source: its UT well behind the newest with no RTP gap to explain it, or its
 * RTP timestamp further behind than any reordering. Useful for stamping delayed video frames in decode
 * order, with no drift against the game's clock. Used by the delay pipelines
 * through {@link bindFrameStamps}.
 *
 * @category Delayed video
 */
export class FrameStampTimeline {
  /** Ordered by `rtp`, the RTP timestamp unwrapped onto one increasing line. */
  private entries: { rtp: number; ut: number }[] = [];
  private epoch: number | null = null;

  /**
   * Adds a stamp. Returns `true` when it opened a new epoch or came from a
   * restarted source, which discarded every earlier stamp: the caller should
   * empty whatever it holds that was dated against them.
   */
  record(stamp: FrameStamp): boolean {
    let epochChanged = false;
    if (
      this.epoch !== null &&
      (stamp.epoch !== this.epoch || this.isRestart(stamp))
    ) {
      this.entries = [];
      epochChanged = true;
    }
    this.epoch = stamp.epoch;

    const rtp = this.unwrap(stamp.rtpTimestamp);
    const at = this.lowerBound(rtp);
    const existing = this.entries[at];
    if (existing && existing.rtp === rtp) existing.ut = stamp.ut;
    else this.entries.splice(at, 0, { rtp, ut: stamp.ut });
    if (this.entries.length > HISTORY) {
      this.entries.splice(0, this.entries.length - HISTORY);
    }
    return epochChanged;
  }

  /**
   * The UT of the frame carrying `rtpTimestamp`, or `null` when no stamp can
   * date it: none has arrived in this epoch, or the frame is older than every
   * stamp kept.
   */
  utFor(rtpTimestamp: number): FrameStampLookup | null {
    if (this.entries.length === 0 || this.epoch === null) return null;
    const rtp = this.unwrap(rtpTimestamp);
    const at = this.lowerBound(rtp);
    const next = this.entries[at];
    if (next && next.rtp === rtp) {
      return { ut: next.ut, epoch: this.epoch, source: "exact" };
    }
    const prev = this.entries[at - 1];
    if (!prev) return null;
    if (!next) return this.past(prev, at - 1, rtp, this.epoch);
    const t = (rtp - prev.rtp) / (next.rtp - prev.rtp);
    return {
      ut: prev.ut + t * (next.ut - prev.ut),
      epoch: this.epoch,
      source: "interpolated",
    };
  }

  /** Whether `stamp` cannot belong to the stream the stored stamps came from. */
  private isRestart(stamp: FrameStamp): boolean {
    const newest = this.entries[this.entries.length - 1];
    if (!newest) return false;
    const behindTicks = newest.rtp - this.unwrap(stamp.rtpTimestamp);
    if (behindTicks > MAX_REORDER_TICKS) return true;
    const utBack = newest.ut - stamp.ut;
    if (utBack <= UT_BACKSTEP_SECONDS) return false;
    const reorderSeconds = Math.max(0, behindTicks) / RTP_PER_SECOND;
    return (
      utBack > MAX_UT_PER_VIDEO_SECOND * reorderSeconds + UT_BACKSTEP_SECONDS
    );
  }

  /** A frame newer than the newest stamp, `prev`. */
  private past(
    prev: { rtp: number; ut: number },
    prevIndex: number,
    rtp: number,
    epoch: number,
  ): FrameStampLookup {
    const before = this.entries[prevIndex - 1];
    const ticks = rtp - prev.rtp;
    if (!before || ticks > MAX_EXTRAPOLATION_TICKS) {
      return { ut: prev.ut, epoch, source: "held" };
    }
    const rate = (prev.ut - before.ut) / (prev.rtp - before.rtp);
    return { ut: prev.ut + ticks * rate, epoch, source: "extrapolated" };
  }

  /** Discards every stamp and the epoch. */
  clear(): void {
    this.entries = [];
    this.epoch = null;
  }

  /** Puts a raw 32-bit RTP timestamp on the line the stored ones are on. */
  private unwrap(raw: number): number {
    const newest = this.entries[this.entries.length - 1];
    if (!newest) return raw;
    const newestRaw = ((newest.rtp % RTP_MODULUS) + RTP_MODULUS) % RTP_MODULUS;
    const diff =
      ((((raw - newestRaw + RTP_HALF) % RTP_MODULUS) + RTP_MODULUS) %
        RTP_MODULUS) -
      RTP_HALF;
    return newest.rtp + diff;
  }

  /** Index of the first entry at or after `rtp`. */
  private lowerBound(rtp: number): number {
    let lo = 0;
    let hi = this.entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.entries[mid] as { rtp: number }).rtp < rtp) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

/**
 * The RTP timestamp of a frame as the browser reports it: a decoded
 * `VideoFrame` through `metadata()`, an `RTCEncodedVideoFrame` through
 * `getMetadata()`. `null` when the frame carries none.
 *
 * @category Delayed video
 */
export function rtpTimestampOf(frame: unknown): number | null {
  if (typeof frame !== "object" || frame === null) return null;
  for (const method of ["metadata", "getMetadata"]) {
    const read: unknown = Reflect.get(frame, method);
    if (typeof read !== "function") continue;
    try {
      const meta: unknown = read.call(frame);
      if (
        typeof meta === "object" &&
        meta !== null &&
        "rtpTimestamp" in meta &&
        typeof meta.rtpTimestamp === "number"
      ) {
        return meta.rtpTimestamp;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Subscribes a {@link FrameStampTimeline} to `feed` and returns the function a
 * delay pipeline stamps each frame with. A frame no stamp can date gets
 * `Number.POSITIVE_INFINITY`, which the buffer holds and then drops once a dated
 * frame arrives. `onEpochChange` is called when the camera starts a new epoch;
 * empty the pipeline there. `reset` forgets every stamp, for a pipeline that is
 * flushed from outside. Useful for stamping delayed video from the camera's
 * own per-frame stamps. Used by the delay pipelines.
 *
 * @category Delayed video
 */
export function bindFrameStamps(
  feed: FrameStampFeed,
  onEpochChange: () => void,
): { captureUt(frame: unknown): number; reset(): void; dispose(): void } {
  const timeline = new FrameStampTimeline();
  const unsubscribe = feed.subscribe((stamp) => {
    if (timeline.record(stamp)) onEpochChange();
  });
  return {
    captureUt(frame) {
      const rtp = rtpTimestampOf(frame);
      const found = rtp === null ? null : timeline.utFor(rtp);
      return found ? found.ut : Number.POSITIVE_INFINITY;
    },
    reset: () => timeline.clear(),
    dispose: unsubscribe,
  };
}
