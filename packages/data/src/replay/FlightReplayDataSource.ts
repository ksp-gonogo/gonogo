import type {
  ConfigField,
  DataKey,
  DataSource,
  DataSourceStatus,
} from "@gonogo/core";
import type { Sample, SeriesRange } from "../types";
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
  /** Live value subscriber callbacks. */
  subs: Set<(value: unknown) => void>;
  /** Live timestamped sample subscriber callbacks (for `subscribeSamples`). */
  sampleSubs: Set<(sample: Sample) => void>;
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
        sampleSubs: new Set(),
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

  // ── BufferedDataSource-shape consumer surface ────────────────────────────
  //
  // The widget hooks (useDataSeries) call queryRange + subscribeSamples on
  // the registered "data" source — assuming it's a BufferedDataSource. To
  // let widgets work in replay mode wholesale, the replay source mimics
  // both. queryRange reads directly from the in-memory fixture (no store
  // round-trip needed); subscribeSamples is the timestamped fanout already
  // wired in `applyForwardTo`.

  /**
   * Inclusive at both ends. Slices the fixture's per-key tuple array to
   * `[tStart, tEnd]` and returns columnar arrays. Synchronous internally;
   * async-wrapped to match the BufferedDataSource contract.
   */
  async queryRange(
    key: string,
    tStart: number,
    tEnd: number,
  ): Promise<SeriesRange> {
    const series = this.fixture.samples[key];
    if (!series || series.length === 0) return { t: [], v: [] };
    const t: number[] = [];
    const v: unknown[] = [];
    for (const [ts, value] of series) {
      if (ts < tStart) continue;
      if (ts > tEnd) break;
      t.push(ts);
      v.push(value);
    }
    return { t, v };
  }

  /**
   * Timestamped variant of `subscribe`. Fires `{ t, v }` every time the
   * cursor advances past a tuple — the in-replay equivalent of
   * BufferedDataSource's per-sample fanout.
   */
  subscribeSamples(key: string, cb: (sample: Sample) => void): () => void {
    const state = this.ensureKeyState(key);
    state.sampleSubs.add(cb);
    return () => {
      state.sampleSubs.delete(cb);
    };
  }

  async execute(action: string): Promise<void> {
    // Replay sources don't drive game state — record the call so tests can
    // assert "the widget tried to fire X" without needing a real Telemachus.
    this.executeLog.push(action);
  }

  /**
   * No-op stub of `KosDataSource.executeScript` — present so kOS widgets
   * (KosFiles, KosWidget, TargetPicker's set-target) don't crash with
   * "method not found" when the replay source is swapped under the `"kos"`
   * registry slot. Returns an empty payload immediately. The widget layer
   * can still detect replay mode via `useReplayActive()` and short-circuit
   * before calling, but this guarantees a graceful failure if it doesn't.
   */
  async executeScript(
    _cpu: string,
    _script: string,
    args: unknown[],
    _managed?: unknown,
  ): Promise<Record<string, unknown>> {
    this.executeLog.push(`executeScript:${args.length}args`);
    return {};
  }

  /**
   * Stubs that mirror `KosDataSource`'s topic-status surface so widgets
   * using `useKosScriptStatus` don't blow up when the replay source is
   * registered under `"kos"`. Status is "running with no errors" — the
   * fixture playback IS the run.
   */
  getTopicStatus(_topicId: string): {
    lastGoodAt: number | null;
    scriptError: Error | null;
    parseError: Error | null;
    paused: boolean;
    running: boolean;
  } | null {
    return {
      lastGoodAt: this.currentT,
      scriptError: null,
      parseError: null,
      paused: false,
      running: false,
    };
  }

  onTopicStatusChange(_topicId: string, _cb: () => void): () => void {
    return () => {};
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
    if (t >= this.currentT) {
      // applyForwardTo emits any pending samples whose tuple[0] <= t,
      // and is a no-op once cursors are exhausted — safe even when
      // t === currentT on the very first seek (where launch-time samples
      // still need to fire).
      this.applyForwardTo(t);
      return;
    }
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
        const [tEmit, v] = series[lastIdx];
        state.cursor = lastIdx + 1;
        state.lastValue = v;
        state.hasLast = true;
        for (const cb of state.subs) cb(v);
        // Sample subscribers on rewind: surface the snapshot timestamp
        // (the actual recorded `t`, not the seek target) so consumers can
        // drop pre-seek points correctly.
        if (state.sampleSubs.size > 0) {
          const sample: Sample = { t: tEmit, v };
          for (const cb of state.sampleSubs) cb(sample);
        }
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

  /**
   * The earliest sample `t` not yet emitted across any key, or `null` when
   * the fixture has been fully replayed. Used by stepwise test helpers that
   * need to walk the fixture one sample at a time so React's effect cycle
   * runs between each.
   */
  nextPendingSampleT(): number | null {
    let earliest: number | null = null;
    for (const [key, state] of this.keyStates) {
      const series = this.fixture.samples[key];
      if (!series || state.cursor >= series.length) continue;
      const t = series[state.cursor][0];
      if (earliest === null || t < earliest) earliest = t;
    }
    return earliest;
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
        // Timestamped fanout for `subscribeSamples` consumers (useDataSeries).
        // Mirrors BufferedDataSource: same value goes to both surfaces.
        if (state.sampleSubs.size > 0) {
          const sample: Sample = { t: tuple[0], v: tuple[1] };
          for (const cb of state.sampleSubs) cb(sample);
        }
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
        sampleSubs: new Set(),
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
