import type {
  ConfigField,
  DataKey,
  DataSource,
  DataSourceStatus,
} from "../api/types";

/**
 * Options for a new `MockDataSource`.
 *
 * @category Test doubles
 */
export interface MockDataSourceOptions {
  /** The source's id. Absent, `"mock"`. */
  id?: string;
  /** The source's display name. Absent, `"Mock"`. */
  name?: string;
  /** The keys `schema()` reports. Absent, none. */
  keys?: DataKey[];
  /**
   * Whether the app drops this source's values while the craft has no
   * signal, as it does for telemetry from a craft. Set it in a test of how something
   * behaves across a loss of signal.
   */
  affectedBySignalLoss?: boolean;
}

/**
 * A {@link DataSource} held in memory, for tests. `emit(key, value)` sends a
 * value to every subscriber of the key.
 *
 * @category Test doubles
 */
export class MockDataSource implements DataSource {
  readonly id: string;
  readonly name: string;
  affectedBySignalLoss?: boolean;
  status: DataSourceStatus = "disconnected";

  private readonly subs = new Map<string, Set<(v: unknown) => void>>();
  private readonly statusSubs = new Set<(s: DataSourceStatus) => void>();
  private readonly keys: DataKey[];

  constructor(options: MockDataSourceOptions = {}) {
    this.id = options.id ?? "mock";
    this.name = options.name ?? "Mock";
    this.keys = options.keys ?? [];
    this.affectedBySignalLoss = options.affectedBySignalLoss;
  }

  async connect(): Promise<void> {
    this.status = "connected";
    this.statusSubs.forEach((cb) => {
      cb("connected");
    });
  }

  disconnect(): void {
    this.status = "disconnected";
    this.statusSubs.forEach((cb) => {
      cb("disconnected");
    });
  }

  schema(): DataKey[] {
    return this.keys;
  }

  subscribe(key: string, cb: (v: unknown) => void): () => void {
    let bucket = this.subs.get(key);
    if (!bucket) {
      bucket = new Set();
      this.subs.set(key, bucket);
    }
    bucket.add(cb);
    return () => {
      bucket?.delete(cb);
    };
  }

  onStatusChange(cb: (s: DataSourceStatus) => void): () => void {
    this.statusSubs.add(cb);
    return () => {
      this.statusSubs.delete(cb);
    };
  }

  configSchema(): ConfigField[] {
    return [];
  }

  configure(_config: Record<string, unknown>): void {}

  getConfig(): Record<string, unknown> {
    return {};
  }

  /** Push a value to every subscriber of `key`. */
  emit(key: string, value: unknown): void {
    this.subs.get(key)?.forEach((cb) => {
      cb(value);
    });
  }

  /** Push a status change without toggling connect/disconnect state. */
  setStatus(status: DataSourceStatus): void {
    this.status = status;
    this.statusSubs.forEach((cb) => {
      cb(status);
    });
  }
}
