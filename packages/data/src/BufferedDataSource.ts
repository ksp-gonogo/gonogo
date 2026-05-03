import type { DataSource, DataSourceStatus } from "@gonogo/core";
import { PerfBudget } from "@gonogo/core";
import { DataSourceWrapper } from "./DataSourceWrapper";
import { getDerivedKeys } from "./derive";
import { FlightDetector } from "./flightDetector";
import {
  isScriptable,
  type ScriptableDataSource,
} from "./kos/ScriptableDataSource";
import { KeyedListenerSet, ListenerSet } from "./ListenerSet";
import { debugFlight } from "./logger";
import type { FlightFixture } from "./replay/FlightFixture";
import { exportFlightToFixture } from "./replay/fixtureIO";
import { enrichKey } from "./schema/telemachusMeta";
import type { Store } from "./storage/Store";
import type { DataKeyMeta, FlightRecord, Sample, SeriesRange } from "./types";

/**
 * Soft cap on samples flowing into the buffered layer. Telemachus runs
 * at 4 Hz across ~170 keys (worst-case 680/sec when every key changes
 * each tick), plus a handful of derived keys and a brief replay burst
 * on subscribe. Mid-flight refreshes routinely flirted with the old
 * 1500 limit; 3000 still catches a true regression (e.g. duplicated
 * samples or a runaway WS rate) without false-alarming on normal load.
 */
const BUFFERED_SAMPLE_BUDGET = new PerfBudget({
  name: "BufferedDataSource samples in/sec",
  threshold: 3000,
  windowMs: 1000,
  unit: "samples",
});

type Clock = () => number;

interface Options {
  /** Source id under which this buffered layer is registered. Defaults to `"data"`. */
  id?: string;
  /** Human name. Defaults to a derived value. */
  name?: string;
  /** Upstream data source to wrap (e.g. the telemachus source). */
  source: DataSource;
  /** Persistence. Usually an `IndexedDbStore`; `MemoryStore` in tests. */
  store: Store;
  /**
   * Number of samples kept in memory per key for `getLatest()`. 500 covers
   * ~2 minutes at 4Hz, enough for the graph widget's initial window
   * without awaiting a `queryRange` round-trip.
   */
  inMemoryLimit?: number;
  /** Injectable clock, mostly for tests. Defaults to `Date.now`. */
  now?: Clock;
}

interface SampleRow {
  t: number;
  v: unknown;
}

/**
 * Wraps a live `DataSource`, persists every sample into a `Store` keyed by
 * inferred flight id, and exposes both live subscriptions (matching the
 * DataSource contract) and columnar range queries (the graph widget's
 * primary read path).
 *
 * Subscription semantics mirror the wrapped source: callbacks fire on new
 * samples only, not on subscribe. For historical backfill, callers use
 * `queryRange` or the `useDataSeries` hook (which composes both).
 *
 * Flight identification runs off `v.name` + `v.missionTime` for now; a
 * `vesselUid` sourced from kOS (Phase 6) will take precedence once
 * available. The detector is seeded from persisted flights on `connect()`
 * so we resume rather than duplicate after a reload.
 */
export class BufferedDataSource extends DataSourceWrapper {
  private readonly store: Store;
  private readonly detector = new FlightDetector();
  private readonly inMemoryLimit: number;
  private readonly now: Clock;

  private latestName: string | null = null;

  /** Latest known sample (t + v) per raw key, used by the derivation engine. */
  private readonly lastRawSample = new Map<string, Sample>();
  /** Last inputs array passed to each derived fn, for the `previous` argument. */
  private readonly derivedPrevious = new Map<string, Sample[] | null>();
  /**
   * Last emitted value per key (raw + derived). Replayed synchronously on
   * `subscribe()` so late subscribers (e.g. widgets that mount after the
   * upstream WS push has already landed) see the current reading instead of
   * waiting for the next sample.
   */
  private readonly lastEmittedValue = new Map<string, unknown>();

  private readonly buffers = new Map<string, SampleRow[]>();
  private readonly keySubscribers = new KeyedListenerSet<[unknown]>();
  private readonly sampleSubscribers = new KeyedListenerSet<[Sample]>();
  private readonly statusSubscribers = new ListenerSet<[DataSourceStatus]>();
  private readonly flightSubscribers = new ListenerSet<[FlightRecord | null]>();

  private upstreamUnsubs: Array<() => void> = [];
  private upstreamStatusUnsub: (() => void) | null = null;
  private lastEmittedCurrent: FlightRecord | null = null;

  /**
   * Keys we've subscribed to upstream because of `connect()` — i.e. every
   * key the wrapped source advertises in `schema()`. Tracked so demand
   * subscribes can skip them.
   */
  private readonly upfrontKeys = new Set<string>();
  /**
   * Indexed/dynamic keys (e.g. `b.name[1]`) aren't in the upstream
   * schema, so they don't get subscribed at connect-time. When a widget
   * calls subscribe() for one of these, we forward the subscribe to the
   * upstream and ref-count callers so we can tear it down once the last
   * widget leaves. Without this the upstream WS never carries the key
   * and the widget waits forever.
   */
  private readonly demandSubs = new Map<
    string,
    { count: number; unsub: () => void }
  >();

  /**
   * CommNet signal state tracked internally off `comm.connected` samples.
   * The gate only activates after we've observed a `comm.connected: true`
   * AT LEAST ONCE and then seen it flip to `false`. Cold-start `false`
   * values (Telemachus on a vessel with no antenna, CommNet disabled in
   * difficulty, or transient null-deref responses) must NOT be trusted as
   * a signal-loss event — otherwise widgets freeze the moment the station
   * connects. Only a confirmed live-to-dead transition counts.
   *
   * Default `true` so non-signal-affected sources (`kos`) aren't held back.
   */
  private signalConnected = true;
  private hasConfirmedConnection = false;

  constructor(opts: Options) {
    super(opts.source, {
      id: opts.id ?? "data",
      name: opts.name ?? `Buffered ${opts.source.name}`,
    });
    this.store = opts.store;
    this.inMemoryLimit = opts.inMemoryLimit ?? 500;
    this.now = opts.now ?? Date.now;
  }

  /** Alias for `this.real` for readability inside this wrapper. */
  private get source(): DataSource {
    return this.real;
  }

  // --- DataSource surface ------------------------------------------------

  /**
   * Sets up the wrapper's subscriptions to the wrapped source. Does NOT
   * call `source.connect()` — the wrapped source's connection lifecycle
   * belongs to whoever registered it. Typically both sources are
   * registered independently and the caller's "connect all registered
   * sources" loop connects each exactly once.
   */
  async connect(): Promise<void> {
    // Hydrate detector with any flights that already exist in the store so
    // we resume rather than duplicate across reloads.
    const known = await this.store.listFlights();
    this.detector.hydrate(known);

    // Subscribe to every key the upstream exposes. We don't filter — the
    // graph widget may want any of them. Telemachus schema is static so
    // this is a fixed cost at connect time. Indexed keys (e.g.
    // `b.name[1]`) live outside the schema; they're picked up via demand
    // subscribes from `subscribe()` below.
    for (const { key } of this.source.schema()) {
      this.upfrontKeys.add(key);
      const unsub = this.source.subscribe(key, (value) => {
        this.handleSample(key, value);
      });
      this.upstreamUnsubs.push(unsub);
    }

    this.upstreamStatusUnsub = this.source.onStatusChange((status) => {
      this.statusSubscribers.fire(status);
    });
  }

  /**
   * Tears down the wrapper's subscriptions. The wrapped source is NOT
   * disconnected here — same reasoning as `connect`.
   */
  disconnect(): void {
    for (const u of this.upstreamUnsubs) u();
    this.upstreamUnsubs = [];
    for (const d of this.demandSubs.values()) d.unsub();
    this.demandSubs.clear();
    this.upfrontKeys.clear();
    this.upstreamStatusUnsub?.();
    this.upstreamStatusUnsub = null;
  }

  schema(): DataKeyMeta[] {
    const raw: DataKeyMeta[] = this.source.schema().map((dk) => ({
      ...dk,
      ...enrichKey(dk.key),
    }));
    const derived: DataKeyMeta[] = getDerivedKeys().map((def) => ({
      key: def.id,
      ...def.meta,
    }));
    return [...raw, ...derived];
  }

  subscribe(key: string, cb: (value: unknown) => void): () => void {
    const removeLocal = this.keySubscribers.add(key, cb);

    // For keys NOT covered by the upfront schema sub (indexed keys like
    // `b.name[1]`), demand-subscribe upstream so values actually flow.
    // Reference-counted so multiple widgets share a single upstream sub.
    if (!this.upfrontKeys.has(key)) {
      const existing = this.demandSubs.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        const unsub = this.source.subscribe(key, (value) => {
          this.handleSample(key, value);
        });
        this.demandSubs.set(key, { count: 1, unsub });
      }
    }

    // Replay the last-known value so late subscribers aren't stuck on
    // `undefined` until the next sample arrives.
    if (this.lastEmittedValue.has(key)) {
      cb(this.lastEmittedValue.get(key));
    }
    return () => {
      removeLocal();
      const demand = this.demandSubs.get(key);
      if (demand) {
        demand.count -= 1;
        if (demand.count <= 0) {
          demand.unsub();
          this.demandSubs.delete(key);
        }
      }
    };
  }

  onStatusChange(cb: (status: DataSourceStatus) => void): () => void {
    return this.statusSubscribers.add(cb);
  }

  // Conditional getter so `isScriptable(buffered)` reflects whether the
  // wrapped source actually supports executeScript — matches the
  // PeerBroadcastingDataSource pattern.
  get executeScript(): ScriptableDataSource["executeScript"] | undefined {
    if (!isScriptable(this.source)) return undefined;
    return this.source.executeScript.bind(this.source);
  }

  // --- Buffered-layer extensions ----------------------------------------

  /**
   * Columnar range query. Always hits the store, so pending writes are
   * flushed first. Defaults `flightId` to the current flight when omitted.
   */
  async queryRange(
    key: string,
    tStart: number,
    tEnd: number,
    flightId?: string,
  ): Promise<SeriesRange> {
    const id = flightId ?? this.detector.getCurrent()?.id;
    if (!id) return { t: [], v: [] };
    return this.store.queryRange(id, key, tStart, tEnd);
  }

  /**
   * Latest single emitted value for a key, or undefined if none seen yet.
   * Synchronous — used where widgets need a snapshot without subscribing
   * (e.g. resolving telemetry args at kOS script dispatch time).
   */
  getLatestValue(key: string): unknown | undefined {
    return this.lastEmittedValue.get(key);
  }

  /**
   * Latest N samples for a key from the in-memory ring buffer. Synchronous
   * — useful for the graph widget's first paint before any async query
   * completes. May return fewer samples than requested, including zero.
   */
  getLatest(key: string, n = this.inMemoryLimit): SeriesRange {
    const buf = this.buffers.get(key);
    if (!buf || buf.length === 0) return { t: [], v: [] };
    const start = Math.max(0, buf.length - n);
    const slice = buf.slice(start);
    return {
      t: slice.map((r) => r.t),
      v: slice.map((r) => r.v),
    };
  }

  /**
   * Subscribe to a fixed set of keys and receive a single callback with an
   * array of all current values whenever any of them changes. Keeps the
   * coalescing and relabelling inside the data layer — consumers treat a
   * group of related keys (e.g. per-stage fuel masses) as one value with
   * one hook call.
   *
   * `values[i]` is `undefined` until `keys[i]` has emitted at least once.
   * On subscribe, the last-known value for each key is replayed via
   * `subscribe()`, so the callback typically fires once per already-seen
   * key during setup and then once per change afterwards.
   */
  subscribeCollection(
    keys: readonly string[],
    cb: (values: unknown[]) => void,
  ): () => void {
    const snapshot: unknown[] = new Array<unknown>(keys.length).fill(undefined);
    const unsubs: Array<() => void> = [];
    keys.forEach((key, i) => {
      unsubs.push(
        this.subscribe(key, (value) => {
          snapshot[i] = value;
          cb(snapshot.slice());
        }),
      );
    });
    return () => {
      unsubs.forEach((u) => {
        u();
      });
    };
  }

  /**
   * Timestamped variant of `subscribe`. Fires on every sample with both
   * the store-side timestamp and value — used by `useDataSeries` so its
   * appended points share the store's clock (matters in tests where the
   * store uses an injected `now()`).
   */
  subscribeSamples(key: string, cb: (sample: Sample) => void): () => void {
    return this.sampleSubscribers.add(key, cb);
  }

  onFlightChange(cb: (flight: FlightRecord | null) => void): () => void {
    return this.flightSubscribers.add(cb);
  }

  listFlights(): Promise<FlightRecord[]> {
    return this.store.listFlights();
  }

  getFlight(id: string): Promise<FlightRecord | null> {
    return this.store.getFlight(id);
  }

  /**
   * Export a recorded flight as a portable `FlightFixture` — every sample
   * across every schema-known key, packaged with the flight metadata.
   * Suitable for `JSON.stringify()` and round-tripping through the replay
   * pipeline (or out to a `.json` file on disk).
   */
  exportFlight(id: string): Promise<FlightFixture> {
    const schema = this.schema();
    return exportFlightToFixture(this.store, id, {
      keys: schema.map((k) => k.key),
      schema,
    });
  }

  getCurrentFlight(): FlightRecord | null {
    return this.detector.getCurrent();
  }

  async deleteFlight(id: string): Promise<void> {
    const wasCurrent = this.detector.getCurrent()?.id === id;
    this.detector.forget(id);
    await this.store.deleteFlight(id);
    if (wasCurrent) this.emitFlightChange();
  }

  async clearAllFlights(): Promise<void> {
    this.detector.forgetAll();
    await this.store.clearAllFlights();
    this.buffers.clear();
    this.lastRawSample.clear();
    this.derivedPrevious.clear();
    this.lastEmittedValue.clear();
    this.emitFlightChange();
  }

  // --- Internal ----------------------------------------------------------

  private handleSample(key: string, value: unknown): void {
    BUFFERED_SAMPLE_BUDGET.record();
    // Signal-state tracker: `comm.connected` updates our gate regardless of
    // the gate's current state (this is the one key that must always flow
    // through, otherwise we'd never see the restore event). We require a
    // confirmed `true` at least once before a later `false` activates the
    // gate — otherwise widgets would freeze on any cold-start scenario
    // where Telemachus reports `false` before the vessel has a link.
    if (key === "comm.connected") {
      if (value === true) {
        this.signalConnected = true;
        this.hasConfirmedConnection = true;
      } else if (value === false && this.hasConfirmedConnection) {
        this.signalConnected = false;
      }
      // Any other value (null, undefined, transient) leaves the gate alone.
    }

    // CommNet blackout gate. When the wrapped source is signal-affected
    // (Telemachus) and we've confirmed a prior live link that has since
    // dropped, drop anything that isn't a `comm.*` key — not persisted to
    // the store, not fanned out to live or sample subscribers, doesn't
    // update lastEmittedValue. Widgets freeze at their pre-blackout value;
    // historical queries show a clean gap.
    if (
      this.source.affectedBySignalLoss &&
      this.hasConfirmedConnection &&
      !this.signalConnected &&
      !key.startsWith("comm.")
    ) {
      return;
    }

    // Cache the identity inputs regardless — the detector needs both and
    // they may arrive in separate callbacks within the same WS message.
    // `v.missionTime` drives the detector directly so we only cache name.
    if (key === "v.name" && typeof value === "string") {
      this.latestName = value;
    }

    const t = this.now();

    // Track latest raw sample for the derivation engine.
    this.lastRawSample.set(key, { t, v: value });

    // Run the detector off v.missionTime as the driver — it ticks every
    // frame with a numeric value, and by the time it arrives in a given
    // WS message, v.name has already been processed.
    if (key === "v.missionTime" && this.latestName !== null) {
      const before = this.detector.getCurrent();
      const decision = this.detector.observe({
        vesselName: this.latestName,
        missionTime: value as number,
        now: t,
      });
      void this.store.upsertFlight(decision.flight);
      if (!before || before.id !== decision.flight.id) {
        this.emitFlightChange();
      }
    }

    const current = this.detector.getCurrent();

    // Append to store + in-memory buffer only if we've identified a flight.
    // Samples arriving before v.name/v.missionTime have landed are dropped
    // — a short warmup on first connect.
    if (current) {
      void this.store.appendSample(current.id, key, t, value);
      this.pushToBuffer(key, t, value);
    } else {
      debugFlight("drop-pre-flight", { key });
    }

    // Fan out to live subscribers regardless of whether we have a flight;
    // useDataValue callers get live values during warmup.
    this.lastEmittedValue.set(key, value);
    this.keySubscribers.fire(key, value);

    // Fan out timestamped samples (only when a flight is established —
    // useDataSeries consumers don't want pre-flight noise).
    if (current) {
      this.sampleSubscribers.fire(key, { t, v: value });
    }

    // Run derived keys that depend on this raw key.
    this.runDerivedKeys(key, current?.id ?? null);
  }

  private runDerivedKeys(changedKey: string, flightId: string | null): void {
    for (const def of getDerivedKeys()) {
      if (!def.inputs.includes(changedKey)) continue;

      // All inputs must have been seen at least once before we fire.
      const inputSamples: Sample[] = [];
      let allSeen = true;
      for (const inputKey of def.inputs) {
        const s = this.lastRawSample.get(inputKey);
        if (!s) {
          allSeen = false;
          break;
        }
        inputSamples.push(s);
      }
      if (!allSeen) continue;

      const previous = this.derivedPrevious.get(def.id) ?? null;
      const result = def.fn(inputSamples, previous);
      this.derivedPrevious.set(def.id, inputSamples);

      if (result === undefined) continue;

      const derivedT = this.now();

      if (flightId) {
        void this.store.appendSample(flightId, def.id, derivedT, result);
        this.pushToBuffer(def.id, derivedT, result);
      }

      this.lastEmittedValue.set(def.id, result);
      this.keySubscribers.fire(def.id, result);

      if (flightId) {
        this.sampleSubscribers.fire(def.id, { t: derivedT, v: result });
      }
    }
  }

  private pushToBuffer(key: string, t: number, v: unknown): void {
    let buf = this.buffers.get(key);
    if (!buf) {
      buf = [];
      this.buffers.set(key, buf);
    }
    buf.push({ t, v });
    if (buf.length > this.inMemoryLimit) {
      // Trim from the front in chunks of 1 — cheap enough at 4Hz; move
      // to a circular buffer if this ever shows up in profiling.
      buf.shift();
    }
  }

  private emitFlightChange(): void {
    const next = this.detector.getCurrent();
    if (next === this.lastEmittedCurrent) return;
    this.lastEmittedCurrent = next;
    // Reset derivation state across flight boundaries so rates don't
    // straddle two flights.
    this.derivedPrevious.clear();
    this.flightSubscribers.fire(next);
  }
}
