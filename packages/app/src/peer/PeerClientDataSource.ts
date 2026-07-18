import type {
  ConfigField,
  DataKey,
  DataSource,
  DataSourceStatus,
} from "@ksp-gonogo/core";
import { PerfBudget } from "@ksp-gonogo/core";
import type {
  DataKeyMeta,
  FlightChapterRecord,
  FlightRecord,
} from "@ksp-gonogo/data";
import { KeyedListenerSet, ListenerSet } from "@ksp-gonogo/data";
import { debugPeer } from "@ksp-gonogo/logger";
import type { PeerClientService } from "./PeerClientService";

interface FlightFixtureLike {
  format: unknown;
  flight: FlightRecord;
  schema: unknown[];
  samples: Record<string, [number, unknown][]>;
  chapters?: FlightChapterRecord[];
}

interface Sample {
  t: number;
  v: unknown;
}

interface SeriesRange {
  t: number[];
  v: unknown[];
}

/**
 * Soft cap on samples fanned out to local station-side subscribers from the
 * peer link. The host forwards Telemachus (~170 keys @ 4 Hz, worst-case
 * 680/sec) plus selective subs the station opts into, so 2500 leaves
 * comfortable headroom over realistic steady state while still catching a
 * runaway broadcast or a duplicated peer message.
 */
const PEER_CLIENT_SAMPLE_BUDGET = new PerfBudget({
  name: "PeerClient samples emitted/sec",
  threshold: 2500,
  windowMs: 1000,
  unit: "samples",
});

export class PeerClientDataSource implements DataSource {
  private subscribers = new KeyedListenerSet<[unknown]>();
  private sampleSubscribers = new KeyedListenerSet<[Sample]>();
  private statusListeners = new ListenerSet<[DataSourceStatus]>();
  private seenKeys = new Set<string>();
  private cachedSchema: DataKeyMeta[] = [];
  // Latest value per key so synchronous snapshot readers (e.g. a widget
  // resolving a `{ type: "telemetry" }` arg at dispatch time) see the same
  // freshness stations already get via subscribe callbacks.
  private lastValues = new Map<string, unknown>();
  status: DataSourceStatus = "disconnected";

  constructor(
    public id: string,
    public name: string,
    private client: PeerClientService,
  ) {
    // Re-send our current key subscriptions on each (re)connect — the
    // host's per-peer subscription state is wiped on disconnect, so we
    // need to restore it after a reconnect or the station goes silent.
    // Optional chain because test fixtures sometimes pass a partial
    // client mock that doesn't implement onConnectionStatus.
    client.onConnectionStatus?.((status) => {
      if (status !== "connected") return;
      const keys = Array.from(this.keyRefs.keys());
      if (keys.length > 0) {
        this.client.sendDataSubscribe?.(this.id, keys);
      }
    });
    client.onData((sourceId, key, value, t) => {
      if (sourceId !== this.id) return;
      if (!this.seenKeys.has(key)) {
        this.seenKeys.add(key);
        debugPeer("PCDS first data", {
          id: this.id,
          key,
          subscriberCount: this.subscribers.size(key),
        });
      }
      this.lastValues.set(key, value);
      PEER_CLIENT_SAMPLE_BUDGET.record();
      this.subscribers.fire(key, value);
      this.sampleSubscribers.fire(key, { t, v: value });
    });
    client.onSourceStatus((sourceId, status) => {
      if (sourceId !== this.id) return;
      this.status = status as DataSourceStatus;
      this.statusListeners.fire(this.status);
    });
  }

  connect() {
    this.status = "connected";
    this.statusListeners.fire("connected");
    return Promise.resolve();
  }

  disconnect() {}

  /**
   * Mirrors the host's enriched schema (label / unit / group) received via
   * the one-shot `schema` PeerJS message. Station-side config UIs read this
   * through `useDataSchema`.
   */
  setSchema(schema: DataKeyMeta[]): void {
    this.cachedSchema = schema;
  }

  schema(): DataKey[] {
    return this.cachedSchema;
  }

  /**
   * Synchronous snapshot of the most recent value for a key, or undefined
   * if none has arrived yet. Mirrors BufferedDataSource.getLatestValue so
   * consumers work identically on main and station regardless of transport.
   */
  getLatestValue(key: string): unknown | undefined {
    return this.lastValues.get(key);
  }
  configSchema(): ConfigField[] {
    return [];
  }
  configure() {}
  getConfig() {
    return {} as Record<string, unknown>;
  }
  setupInstructions() {
    return null;
  }

  subscribe(key: string, cb: (value: unknown) => void) {
    const removeLocal = this.addLocalSubscriber(key, cb);
    this.refKey(key);
    // Sticky cache — emit the most recently received value to this new
    // subscriber synchronously so a second widget subscribing to a key
    // an earlier widget already requested doesn't sit on `undefined`
    // waiting for the next change. Mirrors BufferedDataSource's
    // last-value replay (line ~258 of BufferedDataSource.ts). Without
    // this, low-rate keys like v.body / v.situationString stay blank on
    // any widget mounted after the first to subscribe.
    if (this.lastValues.has(key)) cb(this.lastValues.get(key));
    return () => {
      removeLocal();
      this.unrefKey(key);
    };
  }

  /**
   * Internal — register a subscriber without touching the wire. Lets
   * `subscribeCollection` reuse the per-key routing logic while still
   * batching the network subscribe/unsubscribe into a single message.
   */
  private addLocalSubscriber(
    key: string,
    cb: (value: unknown) => void,
  ): () => void {
    return this.subscribers.add(key, cb);
  }

  onStatusChange(cb: (status: DataSourceStatus) => void) {
    return this.statusListeners.add(cb);
  }

  async execute(action: string) {
    this.client.sendExecute(this.id, action);
  }

  /**
   * Tunnel a single call up to whatever handle the host's Uplink registered
   * for this source's id (via `registerUplinkHandle` — see
   * `PeerHostService.handleUplinkRelay`). Purely a station-side convenience
   * forwarder: `method`/`args`/the resolved result are opaque here, each
   * Uplink's own client code owns casting them to its real shape.
   */
  relay(method: string, args: unknown): Promise<unknown> {
    return this.client.sendUplinkRelay(this.id, method, args);
  }

  /**
   * Timestamped variant of subscribe. Used by `useDataSeries` on station
   * screens so live samples carry the host's clock alongside the value.
   */
  subscribeSamples(key: string, cb: (sample: Sample) => void) {
    const removeLocal = this.sampleSubscribers.add(key, cb);
    this.refKey(key);
    return () => {
      removeLocal();
      this.unrefKey(key);
    };
  }

  // ── Selective subscription bookkeeping ───────────────────────────────────
  // Refcount per key across both subscribe() and subscribeSamples().
  // Transitions:
  //   0 → 1  : tell the host we want this key
  //   1 → 0  : tell the host we're done
  // The host ignores these messages while the peer is in broadcast-all
  // mode, so it's safe to send even before peer-data-mode is delivered.
  private keyRefs = new Map<string, number>();

  private refKey(key: string): void {
    const next = (this.keyRefs.get(key) ?? 0) + 1;
    this.keyRefs.set(key, next);
    if (next === 1) {
      this.client.sendDataSubscribe?.(this.id, [key]);
    }
  }

  private unrefKey(key: string): void {
    const next = (this.keyRefs.get(key) ?? 0) - 1;
    if (next <= 0) {
      this.keyRefs.delete(key);
      this.client.sendDataUnsubscribe?.(this.id, [key]);
    } else {
      this.keyRefs.set(key, next);
    }
  }

  /**
   * Route a historical range query through PeerJS to the host's buffered
   * data layer. Resolves with the host's columnar response; rejects if the
   * peer drops or the host has no queryRange support for this source.
   */
  async queryRange(
    key: string,
    tStart: number,
    tEnd: number,
    flightId?: string,
  ): Promise<SeriesRange> {
    return this.client.sendQueryRange(this.id, key, tStart, tEnd, flightId);
  }

  // ── Flight history (proxied to host BufferedDataSource via PeerJS RPC) ──
  //
  // Mirrors BufferedDataSource's flight surface so FlightsManager renders
  // identically on the station. `getCurrentFlight` + `onFlightChange` are
  // the synchronous-snapshot pair `useFlight()` consumes; mutations and
  // queries round-trip through `sendFlightRpc`.

  getCurrentFlight(): FlightRecord | null {
    return this.client.getCurrentFlight();
  }

  onFlightChange(cb: (flight: FlightRecord | null) => void): () => void {
    return this.client.onFlightChange(cb);
  }

  onFlightListChange(cb: () => void): () => void {
    return this.client.onFlightListChange(cb);
  }

  listFlights(): Promise<FlightRecord[]> {
    return this.client.sendFlightRpc<FlightRecord[]>({ op: "list" });
  }

  getFlight(id: string): Promise<FlightRecord | null> {
    return this.client.sendFlightRpc<FlightRecord | null>({ op: "get", id });
  }

  exportFlight(id: string): Promise<FlightFixtureLike> {
    // Bigger timeout — fixtures of long flights run into a few MB which
    // can take real time to traverse the IndexedDB cursor + serialise.
    return this.client.sendFlightRpc<FlightFixtureLike>(
      { op: "export", id },
      60_000,
    );
  }

  deleteFlight(id: string): Promise<void> {
    return this.client
      .sendFlightRpc({ op: "delete", id })
      .then(() => undefined);
  }

  clearAllFlights(): Promise<void> {
    return this.client.sendFlightRpc({ op: "clearAll" }).then(() => undefined);
  }

  setFlightStarred(id: string, starred: boolean): Promise<void> {
    return this.client
      .sendFlightRpc({ op: "setStarred", id, starred })
      .then(() => undefined);
  }

  pruneFlightsKeepLatest(opts: { keepCount: number }): Promise<string[]> {
    return this.client.sendFlightRpc<string[]>({
      op: "pruneKeepLatest",
      keepCount: opts.keepCount,
    });
  }

  addChapter(
    flightId: string,
    chapter: Omit<FlightChapterRecord, "id"> & { id?: string },
  ): Promise<FlightRecord | null> {
    return this.client.sendFlightRpc<FlightRecord | null>({
      op: "addChapter",
      flightId,
      chapter,
    });
  }

  updateChapter(
    flightId: string,
    chapterId: string,
    patch: Partial<Omit<FlightChapterRecord, "id">>,
  ): Promise<FlightRecord | null> {
    return this.client.sendFlightRpc<FlightRecord | null>({
      op: "updateChapter",
      flightId,
      chapterId,
      patch,
    });
  }

  removeChapter(
    flightId: string,
    chapterId: string,
  ): Promise<FlightRecord | null> {
    return this.client.sendFlightRpc<FlightRecord | null>({
      op: "removeChapter",
      flightId,
      chapterId,
    });
  }

  /**
   * Match BufferedDataSource's `subscribeCollection`: subscribe to a fixed
   * set of keys and fire a single callback with the current value array
   * whenever any of them changes. Each broadcast sample flows through the
   * same per-key subscribers the host wired up, so the station sees the same
   * group-update cadence as the main screen.
   */
  subscribeCollection(
    keys: readonly string[],
    cb: (values: unknown[]) => void,
  ): () => void {
    const snapshot: unknown[] = new Array<unknown>(keys.length).fill(undefined);
    // Wire the per-key routing first WITHOUT calling refKey() per
    // iteration — that would emit one peer-data-subscribe message per
    // key. Instead, batch the keys into a single subscribe message via
    // refKeysBulk after the locals are wired.
    const removes = keys.map((key, i) =>
      this.addLocalSubscriber(key, (value) => {
        snapshot[i] = value;
        cb(snapshot.slice());
      }),
    );
    this.refKeysBulk(keys);
    return () => {
      for (const u of removes) u();
      this.unrefKeysBulk(keys);
    };
  }

  /** Bulk-refcount + send a single batched peer-data-subscribe. */
  private refKeysBulk(keys: readonly string[]): void {
    const newlyAdded: string[] = [];
    for (const key of keys) {
      const next = (this.keyRefs.get(key) ?? 0) + 1;
      this.keyRefs.set(key, next);
      if (next === 1) newlyAdded.push(key);
    }
    if (newlyAdded.length > 0) {
      this.client.sendDataSubscribe?.(this.id, newlyAdded);
    }
  }

  private unrefKeysBulk(keys: readonly string[]): void {
    const newlyRemoved: string[] = [];
    for (const key of keys) {
      const cur = this.keyRefs.get(key) ?? 0;
      const next = cur - 1;
      if (next <= 0) {
        this.keyRefs.delete(key);
        newlyRemoved.push(key);
      } else {
        this.keyRefs.set(key, next);
      }
    }
    if (newlyRemoved.length > 0) {
      this.client.sendDataUnsubscribe?.(this.id, newlyRemoved);
    }
  }
}
