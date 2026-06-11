import type { ConfigField, DataKey, DataSourceStatus } from "@gonogo/core";
import { PerfBudget, registerDataSource } from "@gonogo/core";
import type {
  KosData,
  KosManagedScript,
  KosScriptArg,
  ScriptableDataSource,
} from "@gonogo/data";
import { LocalStorageStore } from "@gonogo/data";
import type { KosCpu } from "./kos-menu-parser";
import { KosComputeManager, type KosTopicStatus } from "./kosCompute";
import { KosComputeSession } from "./kosComputeSession";
import { KosMenuPeekSession } from "./kosMenuPeekSession";

// Re-export the session collaborators so existing `from "./kos"` consumers
// continue to resolve the same symbols after they moved to sibling modules.
export { KosComputeSession } from "./kosComputeSession";
export type { KosMenuPeekInit } from "./kosMenuPeekSession";
export { KosMenuPeekSession } from "./kosMenuPeekSession";
export type { KosManagedScript, KosScriptArg };

export interface KosConfig extends Record<string, unknown> {
  /** Proxy host (our @gonogo/telnet-proxy server). */
  host: string;
  /** Proxy port. */
  port: number;
  /** kOS telnet host, as reached from the proxy. */
  kosHost: string;
  /** kOS telnet port. */
  kosPort: number;
  /**
   * CPU tagname that the centralised compute fanout dispatches to. Empty
   * string = none selected, loops surface a "no CPU" error and idle. The
   * legacy ad-hoc executeScript path takes its CPU as a parameter and is
   * unaffected.
   */
  activeCpu: string;
}

const DEFAULT_CONFIG: KosConfig = {
  host: "localhost",
  port: 3001,
  kosHost: "localhost",
  kosPort: 5410,
  activeCpu: "",
};
/**
 * Pre-merge, executeScript() lived on a separate `kos-compute` source with
 * its own localStorage key. We still read it as a fallback so users who
 * configured kos-compute but never opened the kos config don't lose their
 * proxy/kOS endpoint when the merge lands. New writes go to the current
 * store only — the legacy partial is folded into the store's defaults so
 * `get()` returns the merged shape.
 */
const LEGACY_KOS_COMPUTE_KEY = "gonogo.datasource.kos-compute";
const configStore = new LocalStorageStore<KosConfig>({
  key: "gonogo.datasource.kos",
  defaults: { ...DEFAULT_CONFIG, ...readStoredPartial(LEGACY_KOS_COMPUTE_KEY) },
});

/**
 * Milliseconds a single executeScript call will wait for its [KOSDATA] line.
 * Generous because a managed-script wrapper that needs to rewrite the file
 * runs ~140 LOG-to-disk ops on the kOS side, each one Unity-tick-bound — a
 * cold first dispatch after a bundled-script change can take several
 * seconds before RUNPATH even starts.
 */
const DEFAULT_CALL_TIMEOUT_MS = 30_000;

/**
 * Soft cap on kOS executeScript dispatch rate. Each script run holds a
 * CPU's REPL for ~hundreds of ms (RUNPATH + queue drain), so a sustained
 * dispatch rate above ~5/sec means widgets are stomping each other. At
 * 10/sec we want to know about it.
 */
const KOS_DISPATCH_BUDGET = new PerfBudget({
  name: "KosDataSource.executeScript dispatches/sec",
  threshold: 10,
  windowMs: 1000,
  unit: "dispatches",
});

/**
 * Default delay between detecting attach and draining the queue. Lets
 * kOS's Unity update loop detach the welcomeMenu so RUNPATH lands in the
 * CPU REPL and not the still-attached welcome menu input pump. Tests
 * override this to 0 since MockKosTelnet doesn't simulate the race.
 */
const DEFAULT_POST_ATTACH_DRAIN_DELAY_MS = 300;

interface KosDataSourceOptions {
  callTimeoutMs?: number;
  postAttachDrainDelayMs?: number;
}

/**
 * Single kOS data source: holds the proxy + kOS endpoint config, exposes
 * `executeScript(cpu, script, args)` for widgets that need to run kOS
 * scripts on individual CPUs, and notifies subscribers when the config
 * changes so live terminals can reconnect against the new endpoint.
 *
 * No persistent ws is held by this source. The KosTerminal widget opens
 * its own ws via `KosProxyContext`; per-CPU executeScript sessions open
 * lazily on demand and tear down when the source disconnects. This keeps
 * the proxy from holding a permanent telnet session that nothing reads.
 */
export class KosDataSource implements ScriptableDataSource<KosConfig> {
  id = "kos";
  name = "kOS";
  status: DataSourceStatus = "disconnected";
  // kOS runs on the vessel; comm blackouts surface as their own errors at
  // dispatch time, so this source is deliberately exempt from the buffering
  // signal-loss gate.
  affectedBySignalLoss = false;

  private readonly statusListeners = new Set<
    (status: DataSourceStatus) => void
  >();
  private readonly configListeners = new Set<() => void>();
  private cfg: KosConfig;
  private readonly callTimeoutMs: number;
  private readonly postAttachDrainDelayMs: number;
  private remoteVersion: { version: string; buildTime: string } | null = null;
  private readonly remoteVersionListeners = new Set<
    (info: { version: string; buildTime: string } | null) => void
  >();
  private remoteVersionFetchInFlight = false;

  // Per-CPU executeScript sessions, keyed by tagname.
  private readonly sessions = new Map<string, KosComputeSession>();

  // Centralised compute fanout — owns kos.compute.* schema/subscribe/execute.
  // Constructed eagerly (no I/O on its own) so subscribe() can route topics
  // before the source is connect()ed.
  private readonly compute: KosComputeManager;

  // Long-lived menu-peek session — populates discovery without needing a
  // widget. Re-created in configure() against the new endpoint.
  private peekSession: KosMenuPeekSession | null = null;
  private peekSessionStatusUnsub: (() => void) | null = null;
  // Cached menu-peek status so recomputeStatus can factor in "kOS proxy
  // is reachable even if no compute session is mid-cycle" — matches the
  // KosTerminal widget's lived experience that the proxy is up.
  private peekSessionStatus: DataSourceStatus = "disconnected";

  /**
   * Subscribers notified every time a session has a fresh CPU menu —
   * the parsed list of every kOS CPU on the active vessel. Used by
   * the screen-side discovery hook to populate the registry; sessions
   * fan out into here so a single subscriber sees menus from every
   * open CPU session.
   */
  private readonly cpuDiscoveryListeners = new Set<(cpus: KosCpu[]) => void>();

  constructor(config?: KosConfig, opts: KosDataSourceOptions = {}) {
    this.cfg = config ?? configStore.get();
    this.callTimeoutMs = opts.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    this.postAttachDrainDelayMs =
      opts.postAttachDrainDelayMs ?? DEFAULT_POST_ATTACH_DRAIN_DELAY_MS;
    this.compute = new KosComputeManager({
      executeScript: (cpu, script, args, managed) =>
        this.executeScript(cpu, script, args, managed),
      getActiveCpu: () => this.cfg.activeCpu,
    });
  }

  // --- Connection (no-op; sessions open lazily) ---

  connect(): Promise<void> {
    void this.refreshRemoteVersion();
    this.startPeekSession();
    return Promise.resolve();
  }

  private startPeekSession(): void {
    if (this.peekSession) return;
    const peek = new KosMenuPeekSession({
      proxyHost: this.cfg.host,
      proxyPort: this.cfg.port,
      kosHost: this.cfg.kosHost,
      kosPort: this.cfg.kosPort,
      onCpusDiscovered: (cpus) => {
        for (const cb of this.cpuDiscoveryListeners) cb(cpus);
      },
    });
    this.peekSession = peek;
    this.peekSessionStatusUnsub = peek.onStatusChange((status) => {
      this.peekSessionStatus = status;
      this.recomputeStatus();
    });
    this.peekSessionStatus = peek.status;
    peek.open();
    this.recomputeStatus();
  }

  private stopPeekSession(): void {
    if (!this.peekSession) return;
    this.peekSession.close();
    this.peekSession = null;
    this.peekSessionStatusUnsub?.();
    this.peekSessionStatusUnsub = null;
    this.peekSessionStatus = "disconnected";
    this.recomputeStatus();
  }

  /**
   * One-shot HTTP probe of the proxy's `/version` endpoint. Stored on the
   * source for the DataSourceStatus widget to surface a per-source pill.
   * Errors are swallowed — an unreachable proxy already shows "disconnected"
   * via the per-session status; the version probe shouldn't add noise.
   */
  private async refreshRemoteVersion(): Promise<void> {
    if (this.remoteVersionFetchInFlight) return;
    this.remoteVersionFetchInFlight = true;
    try {
      const res = await fetch(
        `http://${this.cfg.host}:${this.cfg.port}/version`,
        { method: "GET" },
      );
      if (!res.ok) return;
      const body = (await res.json()) as {
        version?: string;
        buildTime?: string;
      };
      if (typeof body.version !== "string") return;
      const next = {
        version: body.version,
        buildTime: typeof body.buildTime === "string" ? body.buildTime : "",
      };
      const prev = this.remoteVersion;
      if (prev?.version === next.version && prev.buildTime === next.buildTime) {
        return;
      }
      this.remoteVersion = next;
      for (const cb of this.remoteVersionListeners) cb(next);
    } catch {
      /* proxy unreachable — handled by per-session status */
    } finally {
      this.remoteVersionFetchInFlight = false;
    }
  }

  getRemoteVersion(): { version: string; buildTime: string } | null {
    return this.remoteVersion;
  }

  onRemoteVersionChange(
    cb: (info: { version: string; buildTime: string } | null) => void,
  ): () => void {
    this.remoteVersionListeners.add(cb);
    return () => this.remoteVersionListeners.delete(cb);
  }

  /**
   * Subscribe to CPU-menu discovery events. Fires every time any open
   * session parses a complete kOS top-level menu — the list represents
   * every CPU on the currently-loaded vessel(s). Subscribers can
   * stamp these into a per-screen registry.
   *
   * Note: only fires while a kOS session is alive. If no widget is
   * attached, no menu is read and no discovery happens.
   */
  onCpusDiscovered(cb: (cpus: KosCpu[]) => void): () => void {
    this.cpuDiscoveryListeners.add(cb);
    return () => this.cpuDiscoveryListeners.delete(cb);
  }

  disconnect(): void {
    this.compute.dispose();
    for (const s of this.sessions.values()) s.close();
    this.sessions.clear();
    this.stopPeekSession();
    this.setStatus("disconnected");
  }

  // --- Data ---

  schema(): DataKey[] {
    return this.compute.schema();
  }

  subscribe(key: string, cb: (value: unknown) => void): () => void {
    return this.compute.subscribe(key, cb);
  }

  /**
   * Pipe every per-field emission from the centralised compute fanout to
   * an external sink. Used by the app shell to capture kOS samples into
   * `BufferedDataSource` so they persist into the flight history and are
   * available for in-app replay. Pass `null` to detach. Idempotent.
   */
  setSampleSink(sink: ((key: string, value: unknown) => void) | null): void {
    this.compute.setSampleSink(sink);
  }

  /** Snapshot of a centralised compute topic's status. Used by `useKosScriptStatus`. */
  getTopicStatus(topicId: string): KosTopicStatus | null {
    return this.compute.getTopicStatus(topicId);
  }

  onTopicStatusChange(topicId: string, cb: () => void): () => void {
    return this.compute.onTopicStatusChange(topicId, cb);
  }

  onStatusChange(cb: (status: DataSourceStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  /**
   * Subscribe to config changes (host/port/kosHost/kosPort updates). The
   * callback fires every time `configure()` persists a new value. Used
   * by KosTerminal to drop and reopen its xterm session against the new
   * endpoint, otherwise an open terminal would stay pinned to whatever
   * host it connected against at mount.
   */
  onConfigChange(cb: () => void): () => void {
    this.configListeners.add(cb);
    return () => this.configListeners.delete(cb);
  }

  async execute(action: string): Promise<void> {
    // Centralised compute actions: kos.compute.<topicId>.{dispatchNow,reEnable}.
    if (await this.compute.execute(action)) return;
    // Anything else still goes through executeScript() directly — the generic
    // action channel doesn't carry enough structure for ad-hoc scripts.
    throw new Error(
      `KosDataSource.execute: unknown action "${action}". Use executeScript() for ad-hoc scripts or kos.compute.<id>.{dispatchNow,reEnable} for managed feeds.`,
    );
  }

  setupInstructions(): string {
    return "The kOS proxy bridges telnet to WebSocket. Run it locally:\n\n  podman compose up -d\n\n(or: docker compose up -d)\n\nfrom the gonogo project root.";
  }

  // --- Public widget API ---

  /**
   * Run a script on the named CPU and resolve with its parsed [KOSDATA]
   * object. Calls to the same CPU are serialised by a per-session FIFO
   * queue; calls to different CPUs run in parallel. Rejects if no
   * [KOSDATA] arrives within the call timeout or the session dies.
   *
   * If `managed` is provided, the dispatch is wrapped in a check-and-write
   * preamble that keeps `script` on the kOS volume in sync with the
   * bundled `managed.body` (versioned via `managed.version` against a
   * `<script>.ver` sidecar). Without `managed`, `script` is treated as a
   * pre-existing path on the kOS volume — same behaviour as before.
   */
  executeScript(
    cpu: string,
    script: string,
    args: KosScriptArg[],
    managed?: KosManagedScript,
  ): Promise<KosData> {
    KOS_DISPATCH_BUDGET.record();
    const session = this.getOrCreateSession(cpu);
    return session.enqueue(script, args, managed);
  }

  // --- Config ---

  configSchema(): ConfigField[] {
    return [
      {
        key: "host",
        label: "Proxy Host",
        type: "text",
        placeholder: "localhost",
      },
      { key: "port", label: "Proxy Port", type: "number", placeholder: "3001" },
      {
        key: "kosHost",
        label: "kOS Host",
        type: "text",
        placeholder: "localhost",
      },
      {
        key: "kosPort",
        label: "kOS Port",
        type: "number",
        placeholder: "5410",
      },
      {
        key: "activeCpu",
        label: "Active CPU",
        type: "text",
        placeholder: "datastream",
      },
    ];
  }

  getConfig(): KosConfig {
    return {
      host: this.cfg.host,
      port: this.cfg.port,
      kosHost: this.cfg.kosHost,
      kosPort: this.cfg.kosPort,
      activeCpu: this.cfg.activeCpu,
    };
  }

  configure(config: Record<string, unknown>): void {
    this.applyConfig(config, true);
  }

  /**
   * Apply a first-run seeded kOS host WITHOUT persisting — see
   * `seedKosHost`. Same teardown/notify path as `configure`, so any live
   * terminal or compute loop re-dials against the seeded endpoint.
   */
  applySeededConfig(config: Record<string, unknown>): void {
    this.applyConfig(config, false);
  }

  private applyConfig(config: Record<string, unknown>, persist: boolean): void {
    const prevActiveCpu = this.cfg.activeCpu;
    this.cfg = {
      host: typeof config.host === "string" ? config.host : this.cfg.host,
      port:
        typeof config.port === "number"
          ? config.port
          : Number(config.port) || this.cfg.port,
      kosHost:
        typeof config.kosHost === "string" ? config.kosHost : this.cfg.kosHost,
      kosPort:
        typeof config.kosPort === "number"
          ? config.kosPort
          : Number(config.kosPort) || this.cfg.kosPort,
      activeCpu:
        typeof config.activeCpu === "string"
          ? config.activeCpu
          : this.cfg.activeCpu,
    };
    if (persist) configStore.set(this.cfg);
    // Tear down any open per-CPU sessions — they'd still be pointed at the
    // old endpoint. Next executeScript() will open fresh sessions against
    // the new config. Then notify config listeners (KosTerminal) so live
    // terminals reconnect too.
    for (const s of this.sessions.values()) s.close();
    this.sessions.clear();
    if (this.cfg.activeCpu !== prevActiveCpu) {
      this.compute.onActiveCpuChanged();
    }
    // Restart the menu-peek against the new endpoint. Skipped on the
    // disconnected branch (peekSession is null then).
    if (this.peekSession) {
      this.stopPeekSession();
      this.startPeekSession();
    }
    // Drop the cached proxy version — next /version probe runs against the
    // new endpoint.
    if (this.remoteVersion !== null) {
      this.remoteVersion = null;
      for (const cb of this.remoteVersionListeners) cb(null);
    }
    void this.refreshRemoteVersion();
    this.recomputeStatus();
    this.configListeners.forEach((cb) => {
      cb();
    });
  }

  // --- executeScript session management ---

  private getOrCreateSession(cpu: string): KosComputeSession {
    let session = this.sessions.get(cpu);
    if (session) return session;
    session = new KosComputeSession({
      cpu,
      proxyHost: this.cfg.host,
      proxyPort: this.cfg.port,
      kosHost: this.cfg.kosHost,
      kosPort: this.cfg.kosPort,
      callTimeoutMs: this.callTimeoutMs,
      postAttachDrainDelayMs: this.postAttachDrainDelayMs,
      onStatusChange: () => this.recomputeStatus(),
      onCpusDiscovered: (cpus) => {
        for (const cb of this.cpuDiscoveryListeners) cb(cpus);
      },
    });
    this.sessions.set(cpu, session);
    this.recomputeStatus();
    return session;
  }

  private recomputeStatus(): void {
    // Aggregate across BOTH the menu-peek session (long-lived, no CPU
    // attached — proves "proxy reachable") AND every per-CPU compute
    // session. The KosTerminal widget connects via KosProxyContext
    // independently of this aggregation; its working state is reflected
    // here through the menu-peek which talks to the same proxy/URL.
    //
    // Pre-rework: status was driven only by `this.sessions` (compute
    // sessions). Every compute-session close flipped the source to
    // "disconnected" between the WS close and the next executeScript-
    // triggered ensureOpen ~5s later, so the data-source banner spent
    // most of its life lying about a working kOS connection. Including
    // the menu-peek's connected state holds the banner stable while
    // compute sessions cycle through reconnects in the background.
    const statuses: Array<DataSourceStatus> = [
      this.peekSessionStatus,
      ...[...this.sessions.values()].map((s) => s.status),
    ];
    if (statuses.some((s) => s === "connected")) {
      this.setStatus("connected");
    } else if (statuses.some((s) => s === "reconnecting")) {
      this.setStatus("reconnecting");
    } else {
      this.setStatus("disconnected");
    }
  }

  // --- Status ---

  private setStatus(status: DataSourceStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.statusListeners.forEach((cb) => {
      cb(status);
    });
  }
}

function readStoredPartial(key: string): Partial<KosConfig> {
  try {
    const stored = globalThis.localStorage?.getItem(key);
    if (!stored) return {};
    return JSON.parse(stored) as Partial<KosConfig>;
  } catch {
    return {};
  }
}

export const kosSource = new KosDataSource();
registerDataSource(kosSource);

/**
 * First-run seeding from the bundle's `KSP_HOST` (via the relay's
 * `/bootstrap-config`). Seeds the KSP-side telnet host VERBATIM — the
 * in-container proxy is the thing dialling it, so container-internal names
 * like `host.containers.internal` are correct here (unlike the browser-side
 * Telemachus/kerbcam seeds). In-memory only; any user-saved kOS config
 * (current or legacy kos-compute key) wins.
 */
export function seedKosHost(kosHost: string): void {
  if (configStore.isStored()) return;
  if (Object.keys(readStoredPartial(LEGACY_KOS_COMPUTE_KEY)).length > 0) return;
  if (kosSource.getConfig().kosHost === kosHost) return;
  kosSource.applySeededConfig({ kosHost });
}
