import type {
  ConfigField,
  DataKey,
  DataSource,
  DataSourceStatus,
} from "@gonogo/core";
import { debugPeer } from "@gonogo/core";
import type { DataKeyMeta } from "@gonogo/data";
import type { PeerClientService } from "./PeerClientService";

interface Sample {
  t: number;
  v: unknown;
}

interface SeriesRange {
  t: number[];
  v: unknown[];
}

export class PeerClientDataSource implements DataSource {
  private subscribers = new Map<string, Set<(value: unknown) => void>>();
  private sampleSubscribers = new Map<string, Set<(sample: Sample) => void>>();
  private statusListeners = new Set<(status: DataSourceStatus) => void>();
  private seenKeys = new Set<string>();
  private cachedSchema: DataKeyMeta[] = [];
  // Latest value per key so synchronous snapshot readers (e.g. useKosWidget
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
          subscriberCount: this.subscribers.get(key)?.size ?? 0,
        });
      }
      this.lastValues.set(key, value);
      this.subscribers.get(key)?.forEach((cb) => {
        cb(value);
      });
      this.sampleSubscribers.get(key)?.forEach((cb) => {
        cb({ t, v: value });
      });
    });
    client.onSourceStatus((sourceId, status) => {
      if (sourceId !== this.id) return;
      this.status = status as DataSourceStatus;
      this.statusListeners.forEach((cb) => {
        cb(this.status);
      });
    });
  }

  connect() {
    this.status = "connected";
    this.statusListeners.forEach((cb) => {
      cb("connected");
    });
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
   * consumers like useKosWidget work identically on main and station.
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
    let bucket = this.subscribers.get(key);
    if (!bucket) {
      bucket = new Set();
      this.subscribers.set(key, bucket);
    }
    bucket.add(cb);
    return () => bucket.delete(cb);
  }

  onStatusChange(cb: (status: DataSourceStatus) => void) {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  async execute(action: string) {
    this.client.sendExecute(this.id, action);
  }

  /**
   * Tunnel a kOS compute script execution up to the host. The host invokes
   * its local KosDataSource.executeScript and replies with the parsed
   * [KOSDATA] object. Only meaningful on the station-side mirror of the
   * "kos" source — calling it on a different source id still sends a
   * request, but the host will reply with an error (the protocol routes
   * to "kos" specifically by design).
   */
  async executeScript(
    cpu: string,
    script: string,
    args: Array<number | string | boolean>,
  ): Promise<Record<string, unknown>> {
    return this.client.sendKosExecute(cpu, script, args);
  }

  /**
   * Timestamped variant of subscribe. Used by `useDataSeries` on station
   * screens so live samples carry the host's clock alongside the value.
   */
  subscribeSamples(key: string, cb: (sample: Sample) => void) {
    let bucket = this.sampleSubscribers.get(key);
    if (!bucket) {
      bucket = new Set();
      this.sampleSubscribers.set(key, bucket);
    }
    bucket.add(cb);
    this.refKey(key);
    return () => {
      const b = this.sampleSubscribers.get(key);
      if (!b) return;
      b.delete(cb);
      if (b.size === 0) this.sampleSubscribers.delete(key);
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
