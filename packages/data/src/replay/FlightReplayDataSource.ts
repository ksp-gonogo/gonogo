import type {
  ConfigField,
  DataKey,
  DataSource,
  DataSourceStatus,
} from "@gonogo/core";
import { type FlightFixture, fixtureDurationMs } from "./FlightFixture";

/**
 * Drives a recorded or synthesized flight back through the standard
 * `DataSource` interface. The same fixture runs in two modes:
 *
 * - **Manual** (default, `autoplay: false`) — tests advance the clock with
 *   `advance(ms)` or `seek(ms)`. Deterministic, no fake timers needed,
 *   side-effect-free.
 * - **Wall-clock** (`autoplay: true`) — internal `setInterval` advances the
 *   clock at `rate × wall-time`. Useful for the dev shim that runs the
 *   whole app against a recording without KSP.
 *
 * Subscribe semantics match `BufferedDataSource`: late subscribers receive
 * the last-emitted value for their key synchronously inside `subscribe()`.
 *
 * Times are tracked in absolute fixture milliseconds (matching the on-disk
 * sample tuples). The "elapsed since launch" view is exposed by the
 * `now()` / `duration()` helpers for UI seek bars.
 */
export interface FlightReplayDataSourceOptions {
  fixture: FlightFixture;
  /** DataSource id. Defaults to `"data"` so it slots in where Telemachus would. */
  id?: string;
  name?: string;
  /**
   * When true, start a wall-clock timer in `connect()` that advances the
   * replay automatically. Tests should leave this false and drive the
   * clock manually.
   */
  autoplay?: boolean;
  /**
   * Wall-clock playback rate. 1 = real time, 10 = 10× speed. Ignored when
   * `autoplay` is false.
   */
  rate?: number;
  /**
   * Tick interval when autoplaying, milliseconds. Defaults to 250ms which
   * matches Telemachus's default sample rate.
   */
  tickMs?: number;
  affectedBySignalLoss?: boolean;
}

const DEFAULT_TICK_MS = 250;

interface KeyState {
  /** Index of the next sample to emit. */
  cursor: number;
  /** Last value we've handed to subscribers — replayed on late subscribe. */
  lastValue: unknown;
  /** Whether `lastValue` is meaningful (i.e. at least one sample emitted). */
  hasLast: boolean;
  /** Live subscriber callbacks. */
  subs: Set<(value: unknown) => void>;
}

export class FlightReplayDataSource implements DataSource {
  readonly id: string;
  readonly name: string;
  readonly affectedBySignalLoss?: boolean;
  status: DataSourceStatus = "disconnected";

  private readonly fixture: FlightFixture;
  private readonly keyStates = new Map<string, KeyState>();
  private readonly statusSubs = new Set<(s: DataSourceStatus) => void>();
  /** Recorded `execute()` action strings — useful for test assertions. */
  readonly executeLog: string[] = [];

  private readonly autoplay: boolean;
  private readonly rate: number;
  private readonly tickMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private playing = false;
  private wallAnchorMs = 0;
  private fixtureAnchorMs = 0;
  /** Current absolute fixture time in ms (last value handed to advance). */
  private currentT: number;

  constructor(opts: FlightReplayDataSourceOptions) {
    this.fixture = opts.fixture;
    this.id = opts.id ?? "data";
    this.name = opts.name ?? `Replay: ${opts.fixture.flight.vesselName}`;
    this.affectedBySignalLoss = opts.affectedBySignalLoss;
    this.autoplay = opts.autoplay ?? false;
    this.rate = opts.rate ?? 1;
    this.tickMs = opts.tickMs ?? DEFAULT_TICK_MS;
    this.currentT = opts.fixture.flight.launchedAt;
    for (const key of Object.keys(opts.fixture.samples)) {
      this.keyStates.set(key, {
        cursor: 0,
        lastValue: undefined,
        hasLast: false,
        subs: new Set(),
      });
    }
  }

  // ── DataSource lifecycle ─────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.setStatus("connected");
    if (this.autoplay) this.play();
  }

  disconnect(): void {
    this.pause();
    this.setStatus("disconnected");
  }

  // ── DataSource read API ──────────────────────────────────────────────────

  schema(): DataKey[] {
    return [...this.fixture.schema];
  }

  subscribe(key: string, cb: (value: unknown) => void): () => void {
    const state = this.ensureKeyState(key);
    state.subs.add(cb);
    // Match BufferedDataSource: replay last-known value synchronously so
    // late subscribers don't sit on `undefined` waiting for the next sample.
    if (state.hasLast) cb(state.lastValue);
    return () => {
      state.subs.delete(cb);
    };
  }

  onStatusChange(cb: (s: DataSourceStatus) => void): () => void {
    this.statusSubs.add(cb);
    return () => {
      this.statusSubs.delete(cb);
    };
  }

  async execute(action: string): Promise<void> {
    // Replay sources don't drive game state — record the call so tests can
    // assert "the widget tried to fire X" without needing a real Telemachus.
    this.executeLog.push(action);
  }

  configSchema(): ConfigField[] {
    return [];
  }

  configure(): void {}

  getConfig(): Record<string, unknown> {
    return {};
  }

  // ── Replay control ───────────────────────────────────────────────────────

  /** Begin advancing the clock automatically against wall-time. No-op if already playing. */
  play(): void {
    if (this.playing) return;
    this.playing = true;
    this.wallAnchorMs = Date.now();
    this.fixtureAnchorMs = this.currentT;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      const wallElapsed = Date.now() - this.wallAnchorMs;
      const fixtureT = this.fixtureAnchorMs + wallElapsed * this.rate;
      this.seek(fixtureT);
      if (fixtureT >= this.fixture.flight.lastSampleAt) this.pause();
    }, this.tickMs);
  }

  /** Stop the wall-clock timer. The current position is preserved. */
  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Move the clock forward by `dt` ms. Synchronous; emits any samples whose
   * `t` falls in (currentT, currentT + dt]. Tests should prefer this over
   * `seek` because it never rewinds and never re-emits.
   */
  advance(dt: number): void {
    if (dt <= 0) return;
    this.applyForwardTo(this.currentT + dt);
  }

  /**
   * Move the clock to the absolute fixture time `t`. Forward seeks emit any
   * skipped samples (so widgets see every transition); rewinds reset all
   * cursors and re-emit the latest sample at-or-before `t` so subscribers
   * land in the right state for that moment.
   */
  seek(t: number): void {
    if (t > this.currentT) {
      this.applyForwardTo(t);
      return;
    }
    if (t === this.currentT) return;
    // Rewind — restart cursors and re-emit a snapshot.
    for (const [key, state] of this.keyStates) {
      state.cursor = 0;
      state.hasLast = false;
      state.lastValue = undefined;
      const series = this.fixture.samples[key];
      if (!series) continue;
      // Emit every sample at-or-before t so subscribers receive the last
      // value for the key (matches a fresh-load replay). Fan out only the
      // FINAL value to avoid triggering visual storms on a rewind.
      let lastIdx = -1;
      for (let i = 0; i < series.length; i++) {
        if (series[i][0] > t) break;
        lastIdx = i;
      }
      if (lastIdx >= 0) {
        const [, v] = series[lastIdx];
        state.cursor = lastIdx + 1;
        state.lastValue = v;
        state.hasLast = true;
        for (const cb of state.subs) cb(v);
      }
    }
    this.currentT = t;
  }

  /** Current absolute fixture time, milliseconds. */
  now(): number {
    return this.currentT;
  }

  /** Total fixture duration in milliseconds (last sample - launchedAt). */
  duration(): number {
    return fixtureDurationMs(this.fixture);
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private applyForwardTo(targetT: number): void {
    for (const [key, state] of this.keyStates) {
      const series = this.fixture.samples[key];
      if (!series) continue;
      while (state.cursor < series.length) {
        const tuple = series[state.cursor];
        if (tuple[0] > targetT) break;
        state.cursor += 1;
        state.lastValue = tuple[1];
        state.hasLast = true;
        for (const cb of state.subs) cb(tuple[1]);
      }
    }
    this.currentT = targetT;
  }

  private ensureKeyState(key: string): KeyState {
    let state = this.keyStates.get(key);
    if (!state) {
      state = {
        cursor: 0,
        lastValue: undefined,
        hasLast: false,
        subs: new Set(),
      };
      this.keyStates.set(key, state);
    }
    return state;
  }

  private setStatus(next: DataSourceStatus): void {
    if (next === this.status) return;
    this.status = next;
    for (const cb of this.statusSubs) cb(next);
  }
}
