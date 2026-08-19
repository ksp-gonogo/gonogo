import type {
  ConfigField,
  DataKey,
  DataSource,
  DataSourceStatus,
} from "../api/types";

export interface MockDataSourceOptions {
  id?: string;
  name?: string;
  keys?: DataKey[];
  /**
   * Set this to match a source whose samples stop arriving on signal loss, so a
   * buffering wrapper's signal-gate path is actually exercised rather than
   * skipped.
   */
  affectedBySignalLoss?: boolean;
  /** Optional spy / handler for `execute()` calls. */
  onExecute?: (action: string) => void | Promise<void>;
}

/**
 * Minimal in-memory `DataSource` for tests: drives arbitrary samples with no MSW
 * or WebSocket setup, and exposes `emit(key, value)` to push a value to every
 * subscriber.
 *
 * Published from here rather than `@ksp-gonogo/core` because 15 Uplink test files
 * construct one and that package is `private: true`. It names four types and no
 * behaviour, so there was nothing holding it up there.
 */
export class MockDataSource implements DataSource {
  readonly id: string;
  readonly name: string;
  affectedBySignalLoss?: boolean;
  status: DataSourceStatus = "disconnected";

  private readonly subs = new Map<string, Set<(v: unknown) => void>>();
  private readonly statusSubs = new Set<(s: DataSourceStatus) => void>();
  private readonly keys: DataKey[];
  private readonly onExecute?: (action: string) => void | Promise<void>;

  constructor(options: MockDataSourceOptions = {}) {
    this.id = options.id ?? "mock";
    this.name = options.name ?? "Mock";
    this.keys = options.keys ?? [];
    this.affectedBySignalLoss = options.affectedBySignalLoss;
    this.onExecute = options.onExecute;
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

  async execute(action: string): Promise<void> {
    if (this.onExecute) await this.onExecute(action);
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
