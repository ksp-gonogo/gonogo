import { logger } from "@ksp-gonogo/logger";

const log = logger.tag("radio:clock");

export interface RadioClockOptions {
  /** The raw present, `undefined` before a clock exists. */
  source(): number | undefined;
  /** Wall seconds, on the clock the source extrapolates against. */
  nowWall?: () => number;
  /**
   * The largest backward step read as jitter rather than as a discontinuity.
   *
   * Two seconds: well past any relay stall a working mesh produces, and well
   * short of a revert or a quickload, which move the clock by minutes.
   */
  toleranceSeconds?: number;
}

/** What the clock has had to smooth over, for instrumentation. */
export interface RadioClockStats {
  /** Backward steps held out as jitter, one per run of readings behind. */
  absorbed: number;
  /** The largest of them, in seconds. */
  largestAbsorbedSeconds: number;
  /** Backward steps beyond the tolerance, taken as discontinuities. */
  discontinuities: number;
}

/**
 * The present the radio stamps and releases chunks against: the view clock's
 * `utNowEstimate()`, with its backward jitter held out.
 *
 * The raw estimate re-anchors on every delivered sample, at that sample's
 * `deliveredAt`. A sample that reaches this screen later than the one before it
 * therefore steps the present BACK by the difference, and on a station every
 * sample has crossed the host's relay first, so a busy host hands it a sawtooth.
 * Audio cannot absorb that: a chunk stamped behind the one spoken before it is
 * released out of order or early, and a release instant that moves back makes
 * the pacer read a burst as a backlog and skip it.
 *
 * So the present only moves FORWARD at natural rate from the furthest point the
 * estimate has reached. The furthest point is also the best one: the sample that
 * crossed fastest is the one closest to the true present, and a slower one says
 * nothing newer. A step back beyond `toleranceSeconds` is not jitter but a real
 * discontinuity (a revert, a quickload, a pause the estimate ran past), and is
 * taken.
 */
export class RadioClock {
  private anchor: { ut: number; wall: number } | null = null;
  /** The last reading was held out, so a run of them is counted once. */
  private absorbing = false;
  private readonly nowWall: () => number;
  private readonly toleranceSeconds: number;
  private readonly counts: RadioClockStats = {
    absorbed: 0,
    largestAbsorbedSeconds: 0,
    discontinuities: 0,
  };

  constructor(private readonly opts: RadioClockOptions) {
    this.nowWall = opts.nowWall ?? (() => performance.now() / 1000);
    this.toleranceSeconds = opts.toleranceSeconds ?? 2;
  }

  /** The present, never behind an earlier reading except across a discontinuity. */
  now(): number | undefined {
    const raw = this.opts.source();
    if (raw === undefined) return undefined;
    const wall = this.nowWall();
    const anchor = this.anchor;
    if (anchor === null) {
      this.anchor = { ut: raw, wall };
      return raw;
    }
    const held = anchor.ut + (wall - anchor.wall);
    if (raw >= held) {
      this.anchor = { ut: raw, wall };
      this.absorbing = false;
      return raw;
    }
    const behind = held - raw;
    if (behind <= this.toleranceSeconds) {
      if (!this.absorbing) this.counts.absorbed += 1;
      this.absorbing = true;
      if (behind > this.counts.largestAbsorbedSeconds) {
        this.counts.largestAbsorbedSeconds = behind;
      }
      return held;
    }
    this.absorbing = false;
    this.counts.discontinuities += 1;
    log.info("discontinuity: the present stepped back", {
      behindSeconds: behind,
    });
    this.anchor = { ut: raw, wall };
    return raw;
  }

  stats(): RadioClockStats {
    return { ...this.counts };
  }
}
