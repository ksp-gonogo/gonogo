import type { DataSource } from "@gonogo/core";
import type { ScriptableDataSource } from "@gonogo/data";
import { DataSourceWrapper, isScriptable } from "@gonogo/data";
import { debugPeer } from "@gonogo/logger";
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
  queryRange: (
    key: string,
    from: number,
    to: number,
    flightId?: string,
  ) => Promise<SeriesRange>;
};

type CollectionAware = {
  subscribeCollection: (
    keys: readonly string[],
    cb: (values: unknown[]) => void,
  ) => () => void;
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

export class PeerBroadcastingDataSource extends DataSourceWrapper {
  private seenKeys = new Set<string>();

  constructor(real: DataSource, host: PeerHostService) {
    super(real);
    const schemaKeys = real.schema();
    debugPeer("PBDS wrap", {
      id: real.id,
      schemaKeyCount: schemaKeys.length,
      sampleAware: hasSubscribeSamples(real),
    });
    // Tell the host where to find this source's latest cached values for
    // peer-data-subscribe back-fill. The real source has the cache; the
    // wrapper forwards via DataSourceWrapper.getLatestValue. Registering
    // by id keys back-fill on host-side identity rather than the global
    // data-source registry, which can be overwritten by station-side
    // PCDS construction in same-process tests. Optional-chain because
    // some tests inject a host stub without the back-fill API.
    host.registerSourceForBackfill?.(real.id, this);
    // Subscribe to every schema key for the lifetime of the wrapper — we do
    // NOT unsubscribe in disconnect(). Reason: MainScreen's StrictMode
    // mount→unmount→mount cycle calls wrapper.disconnect() between the two
    // setups; if we unsubbed, the broadcast callbacks would be gone on the
    // second mount (real.connect() doesn't re-run the wrapper constructor),
    // and the station would see zero telemetry. The wrapper is registered in
    // the registry for the lifetime of the app, so lifetime-of-wrapper is the
    // correct scope for broadcasting.
    // Use the plain `subscribe` path for the broadcast loop, even when
    // the wrapped source supports `subscribeSamples`. BufferedDataSource
    // gates `sampleSubscribers.fire` on flight detection — pre-flight
    // samples never reach `subscribeSamples` consumers, which means
    // low-change-rate keys that emit before the FlightDetector
    // establishes a current flight (v.body, v.situationString, sci.*,
    // career.*, s.sensor.*) are silently dropped from the broadcast
    // wire. A station mounting a widget after launch sees them as
    // permanently undefined.
    //
    // `subscribe` fires from `keySubscribers`, which `handleSample`
    // calls unconditionally. Cost is host-side timestamp loss — receivers
    // fall back to Date.now(), a few ms of skew on station-side live
    // charts. Acceptable trade for not silently losing values.
    //
    // Safe to do this before `buffered.connect()` thanks to the
    // schema-aware guard in BufferedDataSource.subscribe (see comment
    // there): a schema key won't trigger a demand-sub, so no
    // double-fire when connect's upfront subscription lands.
    for (const { key } of schemaKeys) {
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

    this.real.onStatusChange((status) => {
      host.broadcast({ type: "status", sourceId: this.id, status });
    });
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
    flightId?: string,
  ): Promise<SeriesRange> {
    if (hasQueryRange(this.real)) {
      return this.real.queryRange(key, from, to, flightId);
    }
    return { t: [], v: [] };
  }

  // Conditional getter so `isScriptable(wrapper)` reflects whether the
  // wrapped source actually supports executeScript — the host's
  // kos-execute-request handler (and useKosWidget on main) both narrow
  // through `isScriptable`.
  get executeScript(): ScriptableDataSource["executeScript"] | undefined {
    if (!isScriptable(this.real)) return undefined;
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

  onFlightListChange(cb: () => void): () => void {
    const real = this.real as {
      onFlightListChange?: (cb: () => void) => () => void;
    };
    return real.onFlightListChange?.(cb) ?? (() => {});
  }

  listFlights(): Promise<unknown[]> {
    const real = this.real as { listFlights?: () => Promise<unknown[]> };
    return real.listFlights?.() ?? Promise.resolve([]);
  }

  getFlight(id: string): Promise<unknown> {
    const real = this.real as {
      getFlight?: (id: string) => Promise<unknown>;
    };
    return real.getFlight?.(id) ?? Promise.resolve(null);
  }

  exportFlight(id: string): Promise<unknown> {
    const real = this.real as {
      exportFlight?: (id: string) => Promise<unknown>;
    };
    if (!real.exportFlight) {
      return Promise.reject(
        new Error("exportFlight not supported by wrapped source"),
      );
    }
    return real.exportFlight(id);
  }

  deleteFlight(id: string): Promise<void> {
    const real = this.real as {
      deleteFlight?: (id: string) => Promise<void>;
    };
    return real.deleteFlight?.(id) ?? Promise.resolve();
  }

  clearAllFlights(): Promise<void> {
    const real = this.real as { clearAllFlights?: () => Promise<void> };
    return real.clearAllFlights?.() ?? Promise.resolve();
  }

  setFlightStarred(id: string, starred: boolean): Promise<void> {
    const real = this.real as {
      setFlightStarred?: (id: string, starred: boolean) => Promise<void>;
    };
    return real.setFlightStarred?.(id, starred) ?? Promise.resolve();
  }

  pruneFlightsKeepLatest(opts: { keepCount: number }): Promise<string[]> {
    const real = this.real as {
      pruneFlightsKeepLatest?: (opts: {
        keepCount: number;
      }) => Promise<string[]>;
    };
    return real.pruneFlightsKeepLatest?.(opts) ?? Promise.resolve([]);
  }

  addChapter(flightId: string, chapter: unknown): Promise<unknown> {
    const real = this.real as {
      addChapter?: (flightId: string, chapter: unknown) => Promise<unknown>;
    };
    return real.addChapter?.(flightId, chapter) ?? Promise.resolve(null);
  }

  updateChapter(
    flightId: string,
    chapterId: string,
    patch: unknown,
  ): Promise<unknown> {
    const real = this.real as {
      updateChapter?: (
        flightId: string,
        chapterId: string,
        patch: unknown,
      ) => Promise<unknown>;
    };
    return (
      real.updateChapter?.(flightId, chapterId, patch) ?? Promise.resolve(null)
    );
  }

  removeChapter(flightId: string, chapterId: string): Promise<unknown> {
    const real = this.real as {
      removeChapter?: (flightId: string, chapterId: string) => Promise<unknown>;
    };
    return real.removeChapter?.(flightId, chapterId) ?? Promise.resolve(null);
  }
}
