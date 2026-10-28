/**
 * How fast one screen is keeping up, from the screen's own side: how late its
 * timers fire (the page too busy to run them) and how long it takes to draw a
 * frame. Each figure is the 90th percentile over the last five seconds.
 */
export interface PaceReading {
  loopLagMs: number;
  frameMs: number;
}

/** A screen is behind once its timers fire this late, or a frame takes this long to draw. */
const BEHIND_LOOP_LAG_MS = 200;
const BEHIND_FRAME_MS = 100;

export function isBehind(reading: PaceReading): boolean {
  return (
    reading.loopLagMs > BEHIND_LOOP_LAG_MS || reading.frameMs > BEHIND_FRAME_MS
  );
}

const WINDOW_MS = 5_000;
const TICK_MS = 200;
/** A frame gap this long is a hidden or sleeping tab, not a slow draw. */
const LONGEST_FRAME_MS = 2_000;

/** Samples kept over a sliding window, read as their 90th percentile. */
class Window {
  private readonly samples: { at: number; value: number }[] = [];

  add(at: number, value: number): void {
    this.samples.push({ at, value });
    while (this.samples.length > 0 && at - this.samples[0].at > WINDOW_MS) {
      this.samples.shift();
    }
  }

  clear(): void {
    this.samples.length = 0;
  }

  p90(): number {
    if (this.samples.length === 0) return 0;
    const sorted = this.samples.map((s) => s.value).sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  }
}

/** Whether the browser has hidden this page: a background tab, a minimised window, or one covered by another. */
export function pageHidden(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

/**
 * Measures this page's {@link PaceReading} while started.
 *
 * A hidden page is not measured. The browser runs a hidden page's timers about
 * once a second and its animation frames not at all, so its lateness says how
 * the browser throttles it rather than how busy it is. The figures from before
 * it was hidden are dropped when it is shown again, so the first reading after
 * is of the page as it is now.
 */
export class PaceMonitor {
  private readonly lag = new Window();
  private readonly frames = new Window();
  private timer: ReturnType<typeof setInterval> | null = null;
  private frameRequest: number | null = null;
  private lastFrame: number | null = null;
  private onVisibility: (() => void) | null = null;

  start(): void {
    if (this.timer !== null) return;
    let expected = performance.now() + TICK_MS;
    this.timer = setInterval(() => {
      const now = performance.now();
      if (!pageHidden()) this.lag.add(now, Math.max(0, now - expected));
      expected = now + TICK_MS;
    }, TICK_MS);
    if (typeof document !== "undefined") {
      this.onVisibility = () => {
        this.lag.clear();
        this.frames.clear();
        this.lastFrame = null;
        expected = performance.now() + TICK_MS;
      };
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    if (typeof requestAnimationFrame !== "function") return;
    const onFrame = (now: number) => {
      const last = this.lastFrame;
      if (last !== null && now - last < LONGEST_FRAME_MS) {
        this.frames.add(now, now - last);
      }
      this.lastFrame = now;
      this.frameRequest = requestAnimationFrame(onFrame);
    };
    this.frameRequest = requestAnimationFrame(onFrame);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.frameRequest !== null) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = null;
    this.lastFrame = null;
    if (this.onVisibility) {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    this.onVisibility = null;
  }

  reading(): PaceReading {
    return { loopLagMs: this.lag.p90(), frameMs: this.frames.p90() };
  }
}

/** How long a backlog is measured against: the quickest a frame crossed in this long is taken as the link with nothing queued. */
const BACKLOG_WINDOW_MS = 30_000;

/**
 * How far frames from the main screen are queued on their way to a station: how
 * much longer the latest took to arrive than the quickest one recently. The two
 * screens' clocks need not agree, since only the change in that gap is read.
 */
export class ArrivalBacklog {
  private readonly crossings: { at: number; gap: number }[] = [];
  private latest = 0;

  /** Note a frame the main screen stamped `sentAt` arriving at `receivedAt`, both in each screen's own `Date.now()`. */
  note(sentAt: number, receivedAt: number): void {
    const gap = receivedAt - sentAt;
    this.crossings.push({ at: receivedAt, gap });
    while (
      this.crossings.length > 0 &&
      receivedAt - this.crossings[0].at > BACKLOG_WINDOW_MS
    ) {
      this.crossings.shift();
    }
    const quickest = Math.min(...this.crossings.map((c) => c.gap));
    this.latest = gap - quickest;
  }

  /** The latest frame's wait beyond the quickest crossing, in milliseconds; 0 before any frame. */
  backlogMs(): number {
    return this.latest;
  }
}

/** What a station last reported about keeping up. */
export interface StationPaceNote extends PaceReading {
  backlogMs: number;
}

/** The send queue to one station that counts as falling behind: well under what the relay's endpoint drops a station at. */
const QUEUE_BEHIND_BYTES = 256 * 1024;
/** The send queue that counts as clear again. */
const QUEUE_CLEAR_BYTES = 32 * 1024;
const BACKLOG_BEHIND_MS = 1_000;
const BACKLOG_CLEAR_MS = 300;
/** A station's rate is not lowered again sooner than this after the last change, so the queue has time to answer it. */
const STEP_DOWN_HOLD_MS = 2_000;
/** A station's rate rises one step only after this long without falling behind. */
const STEP_UP_HOLD_MS = 10_000;
const MIN_RATE = 1;

/** What a {@link StationPacer} decided on its latest look. */
export type PaceStep = "down" | "up" | "hold";

/**
 * The rate one station is sent the fast Topics at, kept by the main screen. It
 * falls by half as soon as the station falls behind, by its send queue first and
 * its own report second, and rises by one a second at a time after it has kept up
 * for a while, never below once a second or above the rate the mod sends.
 */
export class StationPacer {
  private rate: number | null = null;
  private changedAt = Number.NEGATIVE_INFINITY;
  private lastForwarded = new Map<string, number>();
  note: StationPaceNote | null = null;

  /** The rate the station is held to, or null while it is sent everything. */
  heldRate(): number | null {
    return this.rate;
  }

  /**
   * Look at the station once: `queuedBytes` is what waits to go out to it (null
   * when that cannot be read), `modRate` the fast tier's rate now.
   */
  look(queuedBytes: number | null, modRate: number, now: number): PaceStep {
    const note = this.note;
    const queueBehind =
      queuedBytes !== null && queuedBytes > QUEUE_BEHIND_BYTES;
    const noteBehind =
      note !== null && (note.backlogMs > BACKLOG_BEHIND_MS || isBehind(note));
    const clear =
      (queuedBytes === null || queuedBytes < QUEUE_CLEAR_BYTES) &&
      (note === null || (note.backlogMs < BACKLOG_CLEAR_MS && !isBehind(note)));
    const current = this.rate ?? modRate;

    if (queueBehind || noteBehind) {
      if (now - this.changedAt < STEP_DOWN_HOLD_MS || current <= MIN_RATE) {
        return "hold";
      }
      this.rate = Math.max(MIN_RATE, Math.floor(current / 2));
      this.changedAt = now;
      return "down";
    }
    if (this.rate === null || !clear) return "hold";
    if (now - this.changedAt < STEP_UP_HOLD_MS) return "hold";
    this.rate = this.rate + 1 >= modRate ? null : this.rate + 1;
    this.changedAt = now;
    return "up";
  }

  /**
   * Whether a sample of a fast Topic valid at `validAt` (game seconds) goes to
   * the station at the rate it is held to. Every sample goes while it is not
   * held, and so does any sample earlier than the last one sent, which only a
   * rewind or a new timeline brings.
   */
  forwards(topic: string, validAt: number): boolean {
    const last = this.lastForwarded.get(topic);
    if (
      this.rate !== null &&
      last !== undefined &&
      validAt >= last &&
      validAt - last < 0.9 / this.rate
    ) {
      return false;
    }
    this.lastForwarded.set(topic, validAt);
    return true;
  }
}

/** The main screen must be behind on this many looks in a row before it lowers the mod's rate, so one slow moment does not. */
const HOST_BEHIND_LOOKS = 3;
const HOST_STEP_DOWN_HOLD_MS = 3_000;
const HOST_STEP_UP_HOLD_MS = 15_000;

/**
 * The most the main screen asks the mod to send the fast tier at, while the
 * main screen itself is behind. It halves after the screen has been behind a
 * few looks running and rises by one a second at a time once it has kept up
 * for a while, and is withdrawn once it reaches the rate the mod sent before.
 */
export class HostPacer {
  private cap: number | null = null;
  private uncapped = 0;
  private behindLooks = 0;
  private changedAt = Number.NEGATIVE_INFINITY;

  /**
   * Look at the main screen's pace once, with `modRate` the fast tier's rate
   * now. Returns the cap to ask the mod for when it changes (null to withdraw
   * it), and undefined when it stays.
   */
  look(
    reading: PaceReading,
    modRate: number,
    now: number,
  ): number | null | undefined {
    if (isBehind(reading)) {
      this.behindLooks += 1;
      const current = this.cap ?? modRate;
      if (
        this.behindLooks < HOST_BEHIND_LOOKS ||
        now - this.changedAt < HOST_STEP_DOWN_HOLD_MS ||
        current <= MIN_RATE
      ) {
        return undefined;
      }
      if (this.cap === null) this.uncapped = modRate;
      this.cap = Math.max(MIN_RATE, Math.floor(current / 2));
      this.changedAt = now;
      return this.cap;
    }
    this.behindLooks = 0;
    if (this.cap === null || now - this.changedAt < HOST_STEP_UP_HOLD_MS) {
      return undefined;
    }
    this.cap = this.cap + 1 >= this.uncapped ? null : this.cap + 1;
    this.changedAt = now;
    return this.cap;
  }
}
