import type {
  ConfigField,
  DataKey,
  DataSource,
  DataSourceStatus,
} from "@gonogo/core";

/**
 * Base class for DataSource wrappers — sources that delegate the bulk of the
 * `DataSource` surface to an upstream `real` source while layering extra
 * behaviour on top (buffering, peer broadcast, etc.).
 *
 * Every method here is a plain forward to `this.real`. Subclasses override
 * what they care about. The base does not own any listener state — wrappers
 * that need their own subscriber sets compose `ListenerSet` / `KeyedListenerSet`
 * directly.
 *
 * `id` / `name` are accepted as constructor overrides so subclasses (notably
 * `BufferedDataSource`, which registers under a different id from its wrapped
 * source) can rename themselves without shadowing a getter.
 */
export abstract class DataSourceWrapper<
  TConfig extends Record<string, unknown> = Record<string, unknown>,
> implements DataSource<TConfig>
{
  readonly id: string;
  readonly name: string;
  protected readonly real: DataSource<TConfig>;

  constructor(
    real: DataSource<TConfig>,
    opts: { id?: string; name?: string } = {},
  ) {
    this.real = real;
    this.id = opts.id ?? real.id;
    this.name = opts.name ?? real.name;
  }

  get status(): DataSourceStatus {
    return this.real.status;
  }

  get affectedBySignalLoss(): boolean | undefined {
    return this.real.affectedBySignalLoss;
  }

  connect(): Promise<void> {
    return this.real.connect();
  }

  disconnect(): void {
    this.real.disconnect();
  }

  schema(): DataKey[] {
    return this.real.schema();
  }

  configSchema(): ConfigField[] {
    return this.real.configSchema();
  }

  configure(config: Record<string, unknown>): void {
    this.real.configure(config);
  }

  getConfig(): TConfig {
    return this.real.getConfig();
  }

  setupInstructions(): string | null {
    return this.real.setupInstructions?.() ?? null;
  }

  execute(action: string): Promise<void> {
    return this.real.execute(action);
  }

  subscribe(key: string, cb: (value: unknown) => void): () => void {
    return this.real.subscribe(key, cb);
  }

  onStatusChange(cb: (status: DataSourceStatus) => void): () => void {
    return this.real.onStatusChange(cb);
  }
}
