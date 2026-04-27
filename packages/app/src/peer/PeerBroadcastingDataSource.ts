import type {
  ConfigField,
  DataKey,
  DataSource,
  DataSourceStatus,
} from "@gonogo/core";
import { debugPeer } from "@gonogo/core";
import type { PeerHostService } from "./PeerHostService";

interface Sample {
  t: number;
  v: unknown;
}

interface SeriesRange {
  t: number[];
  v: unknown[];
}

type SampleAware = {
  subscribeSamples: (key: string, cb: (sample: Sample) => void) => () => void;
};

type QueryRangeAware = {
  queryRange: (key: string, from: number, to: number) => Promise<SeriesRange>;
};

type CollectionAware = {
  subscribeCollection: (
    keys: readonly string[],
    cb: (values: unknown[]) => void,
  ) => () => void;
};

type ExecuteScriptAware = {
  executeScript: (
    cpu: string,
    script: string,
    args: Array<number | string | boolean>,
  ) => Promise<Record<string, unknown>>;
};

type LatestValueAware = {
  getLatestValue: (key: string) => unknown;
};

type ConfigChangeAware = {
  onConfigChange: (cb: () => void) => () => void;
};

function hasSubscribeSamples(
  source: DataSource,
): source is DataSource & SampleAware {
  return (
    typeof (source as Partial<SampleAware>).subscribeSamples === "function"
  );
}

function hasQueryRange(
  source: DataSource,
): source is DataSource & QueryRangeAware {
  return typeof (source as Partial<QueryRangeAware>).queryRange === "function";
}

function hasSubscribeCollection(
  source: DataSource,
): source is DataSource & CollectionAware {
  return (
    typeof (source as Partial<CollectionAware>).subscribeCollection ===
    "function"
  );
}

function hasExecuteScript(
  source: DataSource,
): source is DataSource & ExecuteScriptAware {
  return (
    typeof (source as Partial<ExecuteScriptAware>).executeScript === "function"
  );
}

function hasGetLatestValue(
  source: DataSource,
): source is DataSource & LatestValueAware {
  return (
    typeof (source as Partial<LatestValueAware>).getLatestValue === "function"
  );
}

function hasOnConfigChange(
  source: DataSource,
): source is DataSource & ConfigChangeAware {
  return (
    typeof (source as Partial<ConfigChangeAware>).onConfigChange === "function"
  );
}

export class PeerBroadcastingDataSource implements DataSource {
  private seenKeys = new Set<string>();

  constructor(
    private real: DataSource,
    host: PeerHostService,
  ) {
    const schemaKeys = real.schema();
    debugPeer("PBDS wrap", {
      id: real.id,
      schemaKeyCount: schemaKeys.length,
      sampleAware: hasSubscribeSamples(real),
    });
    // Subscribe to every schema key for the lifetime of the wrapper — we do
    // NOT unsubscribe in disconnect(). Reason: MainScreen's StrictMode
    // mount→unmount→mount cycle calls wrapper.disconnect() between the two
    // setups; if we unsubbed, the broadcast callbacks would be gone on the
    // second mount (real.connect() doesn't re-run the wrapper constructor),
    // and the station would see zero telemetry. The wrapper is registered in
    // the registry for the lifetime of the app, so lifetime-of-wrapper is the
    // correct scope for broadcasting.
    for (const { key } of schemaKeys) {
      if (hasSubscribeSamples(real)) {
        real.subscribeSamples(key, ({ t, v: value }) => {
          if (!this.seenKeys.has(key)) {
            this.seenKeys.add(key);
            debugPeer("PBDS first value", { id: this.id, key });
          }
          host.broadcast({ type: "data", sourceId: this.id, key, value, t });
        });
      } else {
        real.subscribe(key, (value) => {
          if (!this.seenKeys.has(key)) {
            this.seenKeys.add(key);
            debugPeer("PBDS first value", { id: this.id, key });
          }
          host.broadcast({
            type: "data",
            sourceId: this.id,
            key,
            value,
            t: Date.now(),
          });
        });
      }
    }

    this.real.onStatusChange((status) => {
      host.broadcast({ type: "status", sourceId: this.id, status });
    });
  }

  get id() {
    return this.real.id;
  }
  get name() {
    return this.real.name;
  }
  get status() {
    return this.real.status;
  }

  connect() {
    return this.real.connect();
  }

  disconnect() {
    return this.real.disconnect();
  }

  schema(): DataKey[] {
    return this.real.schema();
  }
  configSchema(): ConfigField[] {
    return this.real.configSchema();
  }
  configure(config: Record<string, unknown>) {
    return this.real.configure(config);
  }
  getConfig() {
    return this.real.getConfig();
  }
  setupInstructions() {
    return this.real.setupInstructions?.() ?? null;
  }

  // Clean pass-through — broadcasting is fully decoupled from UI subscriptions.
  subscribe(key: string, cb: (value: unknown) => void) {
    return this.real.subscribe(key, cb);
  }

  onStatusChange(cb: (status: DataSourceStatus) => void) {
    return this.real.onStatusChange(cb);
  }

  async execute(action: string) {
    return this.real.execute(action);
  }

  // The BufferedDataSource extensions `useDataSeries` expects. When the wrapped
  // source doesn't implement them (e.g. a raw telemachus source wrapped for
  // broadcasting), fall back to the base `subscribe` contract and return empty
  // history so the hook keeps working.
  subscribeSamples(key: string, cb: (sample: Sample) => void) {
    if (hasSubscribeSamples(this.real)) {
      return this.real.subscribeSamples(key, cb);
    }
    return this.real.subscribe(key, (value) => {
      cb({ t: Date.now(), v: value });
    });
  }

  async queryRange(
    key: string,
    from: number,
    to: number,
  ): Promise<SeriesRange> {
    if (hasQueryRange(this.real)) {
      return this.real.queryRange(key, from, to);
    }
    return { t: [], v: [] };
  }

  // Conditional getters so `typeof wrapper.executeScript === "function"`
  // reflects whether the wrapped source actually supports the method — the
  // host's kos-execute-request handler (and useKosWidget on main) both gate
  // on that exact check.
  get executeScript(): ExecuteScriptAware["executeScript"] | undefined {
    if (!hasExecuteScript(this.real)) return undefined;
    return this.real.executeScript.bind(this.real);
  }

  get getLatestValue(): LatestValueAware["getLatestValue"] | undefined {
    if (!hasGetLatestValue(this.real)) return undefined;
    return this.real.getLatestValue.bind(this.real);
  }

  // Forward kos config-change subscriptions through the wrapper. KosTerminal
  // does `getDataSource("kos")?.onConfigChange?.(...)` to reset itself when
  // the user updates the kOS host; on the main screen the registry returns
  // this wrapper, so without forwarding the optional chain silently no-ops
  // and the terminal would stay pinned to the old endpoint.
  get onConfigChange(): ConfigChangeAware["onConfigChange"] | undefined {
    if (!hasOnConfigChange(this.real)) return undefined;
    return this.real.onConfigChange.bind(this.real);
  }

  subscribeCollection(
    keys: readonly string[],
    cb: (values: unknown[]) => void,
  ): () => void {
    if (hasSubscribeCollection(this.real)) {
      return this.real.subscribeCollection(keys, cb);
    }
    // Fall back to individual subscribes for sources that don't support
    // batched collection (e.g. a raw Telemachus wrapper without buffering).
    const snapshot: unknown[] = new Array<unknown>(keys.length).fill(undefined);
    const unsubs: Array<() => void> = [];
    keys.forEach((key, i) => {
      unsubs.push(
        this.real.subscribe(key, (value) => {
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

  /*
   * Flight-aware methods aren't part of the `DataSource` interface, but
   * the buffered source they wrap defines them. Forward them through so
   * widgets like FlightsManager keep working when this wrapper is the
   * registered source for `data` (i.e. on the main screen with peer
   * hosting active).
   */
  getCurrentFlight(): unknown {
    const real = this.real as { getCurrentFlight?: () => unknown };
    return real.getCurrentFlight?.() ?? null;
  }

  onFlightChange(cb: () => void): () => void {
    const real = this.real as {
      onFlightChange?: (cb: () => void) => () => void;
    };
    return real.onFlightChange?.(cb) ?? (() => {});
  }
}
