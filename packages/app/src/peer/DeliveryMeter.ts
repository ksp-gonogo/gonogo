import { logger } from "@ksp-gonogo/logger";
import type { PeerMessage } from "./protocol";

const deliveryLogger = logger.tag("peer:delivery");

/** How long one measurement runs before its line is logged. */
const DEFAULT_WINDOW_MS = 60_000;

/** The most channels one line lists, those with the longest gaps first, so a station that carries every Topic still logs one bounded entry. */
const MAX_CHANNELS_LOGGED = 40;

export interface ChannelDelivery {
  /** Frames seen in the window. */
  n: number;
  /** Frames per second over the window. */
  fps: number;
  /** The longest silence on this channel in the window, in milliseconds, including the time since its last frame at the window's end. */
  maxGapMs: number;
}

/**
 * The channel a peer message travels on: a Sitrep frame by its Topic, any
 * other message by its type. Replayed frames describe the past and return
 * `undefined`, so they never count as delivery.
 */
export function deliveryChannel(msg: PeerMessage): string | undefined {
  if (msg.type === "sitrep-frame") {
    if (msg.replay) return undefined;
    const inner = msg.message;
    return `sitrep:${"topic" in inner ? inner.topic : inner.type}`;
  }
  if (msg.type === "data") return `data:${msg.sourceId}`;
  return msg.type;
}

interface ChannelState {
  last: number;
  n: number;
  maxGap: number;
}

/**
 * Counts frames per channel and the longest gap between them over a fixed
 * window, and logs one line per window. Used on the main screen (frames sent
 * to stations) and on a station (frames received from the main screen), so a
 * choppy link shows as the same two numbers at both ends.
 */
export class DeliveryMeter {
  private readonly channels = new Map<string, ChannelState>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private windowStart = 0;

  constructor(
    private readonly side: "host" | "station",
    private readonly windowMs: number = DEFAULT_WINDOW_MS,
    private readonly now: () => number = Date.now,
  ) {}

  record(channel: string): void {
    const t = this.now();
    const state = this.channels.get(channel);
    if (!state) {
      this.channels.set(channel, { last: t, n: 1, maxGap: 0 });
      return;
    }
    state.n++;
    state.maxGap = Math.max(state.maxGap, t - state.last);
    state.last = t;
  }

  start(): void {
    if (this.timer) return;
    this.windowStart = this.now();
    this.timer = setInterval(() => this.flush(), this.windowMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.channels.clear();
  }

  /** Logs the window just ended and starts the next. Public for tests. */
  flush(): Record<string, ChannelDelivery> {
    const t = this.now();
    const seconds = Math.max((t - this.windowStart) / 1000, 0.001);
    const out: Record<string, ChannelDelivery> = {};
    for (const [name, s] of this.channels) {
      out[name] = {
        n: s.n,
        fps: Math.round((s.n / seconds) * 10) / 10,
        maxGapMs: Math.max(s.maxGap, t - s.last),
      };
      if (s.n === 0) {
        this.channels.delete(name);
        continue;
      }
      s.n = 0;
      s.maxGap = 0;
    }
    this.windowStart = t;
    const listed = Object.entries(out)
      .sort((a, b) => b[1].maxGapMs - a[1].maxGapMs)
      .slice(0, MAX_CHANNELS_LOGGED);
    if (listed.length > 0) {
      deliveryLogger.info(
        `[peer:delivery] ${this.side} channels=${Object.keys(out).length}`,
        {
          side: this.side,
          windowSeconds: Math.round(seconds),
          channels: Object.fromEntries(listed),
        },
      );
    }
    return out;
  }
}
