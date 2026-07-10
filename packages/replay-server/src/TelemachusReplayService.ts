import {
  type FlightFixture,
  FlightReplayDataSource,
} from "@ksp-gonogo/data/replay";

/**
 * Per-connection wire-format adapter for a `FlightReplayDataSource`. One
 * service instance is created per WebSocket connection. The service:
 *
 * - Tracks which keys this connection has subscribed to.
 * - Receives parsed Telemachus subscribe / unsubscribe messages.
 * - Buffers samples coming out of the replay source and flushes them at
 *   the connection's requested rate (default 500 ms — matching
 *   Telemachus's own default).
 *
 * Decoupled from any specific WebSocket library so it can be unit-tested
 * by hand (no Fastify, no real `ws`). The Fastify route in `server.ts`
 * wires it up.
 */
export interface TelemachusInbound {
  /** Subscribe to additional keys. Telemachus wire: `{ "+": ["v.altitude"] }`. */
  add?: string[];
  /** Unsubscribe from keys. Telemachus wire: `{ "-": ["v.altitude"] }`. */
  remove?: string[];
  /** Sample rate for this connection in milliseconds. Default 500. */
  rate?: number;
}

export interface TelemachusReplayServiceOptions {
  /** Send a wire-format message back to the client. */
  send: (payload: Record<string, unknown>) => void;
  /** Shared replay source — typically one per server, fanned out to N connections. */
  replay: FlightReplayDataSource;
}

const DEFAULT_RATE_MS = 500;

export class TelemachusReplayService {
  private readonly send: (payload: Record<string, unknown>) => void;
  private readonly replay: FlightReplayDataSource;
  /** key → unsubscribe function on the replay source. */
  private readonly subs = new Map<string, () => void>();
  /** Pending key → latest value, flushed on every rate tick. */
  private readonly pending = new Map<string, unknown>();
  private rateMs = DEFAULT_RATE_MS;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(opts: TelemachusReplayServiceOptions) {
    this.send = opts.send;
    this.replay = opts.replay;
    this.startTimer();
  }

  /**
   * Apply an inbound message. Telemachus's protocol bundles add/remove/rate
   * into a single message so we accept all three at once.
   */
  applyMessage(msg: TelemachusInbound): void {
    if (this.closed) return;
    if (msg.rate !== undefined && Number.isFinite(msg.rate) && msg.rate > 0) {
      this.rateMs = msg.rate;
      this.restartTimer();
    }
    if (msg.add) for (const key of msg.add) this.subscribe(key);
    if (msg.remove) for (const key of msg.remove) this.unsubscribe(key);
  }

  /** Tear down all replay subscriptions and stop the flush timer. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const unsub of this.subs.values()) unsub();
    this.subs.clear();
    this.pending.clear();
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private subscribe(key: string): void {
    if (this.subs.has(key)) return;
    const unsub = this.replay.subscribe(key, (value: unknown) => {
      this.pending.set(key, value);
    });
    this.subs.set(key, unsub);
  }

  private unsubscribe(key: string): void {
    const unsub = this.subs.get(key);
    if (!unsub) return;
    unsub();
    this.subs.delete(key);
    this.pending.delete(key);
  }

  private startTimer(): void {
    this.timer = setInterval(() => {
      this.flush();
    }, this.rateMs);
  }

  private restartTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.startTimer();
  }

  private flush(): void {
    if (this.pending.size === 0) return;
    const payload: Record<string, unknown> = {};
    for (const [key, value] of this.pending) payload[key] = value;
    this.pending.clear();
    this.send(payload);
  }
}

/**
 * Parse a raw Telemachus inbound message. Telemachus uses `+`/`-` keys
 * which aren't valid JS identifiers, so we normalise to `add`/`remove`
 * here. Returns `null` for malformed payloads — the caller should drop
 * them silently rather than crash the connection.
 */
export function parseTelemachusInbound(raw: string): TelemachusInbound | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const out: TelemachusInbound = {};
  const add = obj["+"];
  const remove = obj["-"];
  if (Array.isArray(add))
    out.add = add.filter((k): k is string => typeof k === "string");
  if (Array.isArray(remove))
    out.remove = remove.filter((k): k is string => typeof k === "string");
  if (typeof obj.rate === "number") out.rate = obj.rate;
  return out;
}

export interface FixtureReplayHostOptions {
  fixture: FlightFixture;
  /** Wall-clock playback rate. 1 = real-time. Defaults to 1. */
  rate?: number;
  /** Tick interval the replay source advances at. Defaults 250 ms. */
  tickMs?: number;
}

/**
 * Construct a single shared replay source from a fixture and start it
 * playing immediately. One host wraps N per-connection services — they
 * all subscribe through this same source.
 */
export async function createFixtureReplayHost(
  opts: FixtureReplayHostOptions,
): Promise<FlightReplayDataSource> {
  const replay = new FlightReplayDataSource({
    fixture: opts.fixture,
    autoplay: true,
    rate: opts.rate ?? 1,
    tickMs: opts.tickMs ?? 250,
  });
  await replay.connect();
  return replay;
}
