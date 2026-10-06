import type {
  ConfigField,
  DataKey,
  DataSource,
  DataSourceStatus,
} from "../api/types";

/**
 * A base class for a {@link DataSource} that passes every call on to another
 * source, `real`, and adds behaviour of its own, such as recording. Override
 * only what you change. It keeps no listeners of its own; use
 * {@link ListenerSet} or {@link KeyedListenerSet} for those.
 *
 * `id` and `name` can be given to the constructor, so a wrapper can register
 * under its own id.
 *
 * @category Flight recording
 */
export abstract class DataSourceWrapper<
  Config extends Record<string, unknown> = Record<string, unknown>,
> implements DataSource<Config>
{
  readonly id: string;
  readonly name: string;
  protected readonly real: DataSource<Config>;

  constructor(
    real: DataSource<Config>,
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

  getConfig(): Config {
    return this.real.getConfig();
  }

  setupInstructions(): string | null {
    return this.real.setupInstructions?.() ?? null;
  }

  subscribe(key: string, cb: (value: unknown) => void): () => void {
    return this.real.subscribe(key, cb);
  }

  onStatusChange(cb: (status: DataSourceStatus) => void): () => void {
    return this.real.onStatusChange(cb);
  }
}
