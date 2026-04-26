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
    if (!this.subscribers.has(key)) this.subscribers.set(key, new Set());
    this.subscribers.get(key)?.add(cb);
    return () => this.subscribers.get(key)?.delete(cb);
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
    return () => {
      const b = this.sampleSubscribers.get(key);
      if (!b) return;
      b.delete(cb);
      if (b.size === 0) this.sampleSubscribers.delete(key);
    };
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
}
