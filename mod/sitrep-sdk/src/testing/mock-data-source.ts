import type {
  ConfigField,
  DataKey,
  DataSource,
  DataSourceStatus,
} from "../api/types";

/**
 * Options for a new `MockDataSource`. Useful for naming a mock source and
 * choosing the keys it offers a widget under test.
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
   * Whether the app drops this source's values while the vessel has
   * no signal, as it does for telemetry from a vessel. Set it in a test of how
   * something behaves across a loss of signal.
   */
  affectedBySignalLoss?: boolean;
}

/**
 * A {@link DataSource} held in memory, for tests. `emit(key, value)` sends a
 * value to every subscriber of the key.
 *
 * Give two mocks different `id`s: the default is `"mock"`, so two defaults are
 * the same id. Useful for testing how a widget shows a value from a source that
 * is not the Sitrep stream. Used by the test setup of the components package.
 *
 * @example Driving a subscriber from a test
 * ```ts
 * import { MockDataSource } from "@ksp-gonogo/sitrep-sdk/testing";
 *
 * const source = new MockDataSource({
 *   id: "weather",
 *   keys: [{ key: "wind", description: "Wind speed" }],
 * });
 * const seen: unknown[] = [];
 * const stop = source.subscribe("wind", (value) => seen.push(value));
 * source.emit("wind", 12);
 * stop();
 * // seen is [12]
 * ```
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
