import type {
  ConfigField,
  DataKey,
  DataSourceStatus,
  KosProcessorInfo,
  TelemetryClient,
} from "@ksp-gonogo/sitrep-sdk";
import {
  createPerfBudget,
  getActiveTelemetryClient,
  LocalStorageStore,
  registerDataSource,
  registerUplinkHandle,
} from "@ksp-gonogo/sitrep-sdk";
import type { KosData, KosScriptArg } from "../shared/kos-data-parser";
import type {
  KosManagedScript,
  ScriptableDataSource,
} from "../shared/ScriptableDataSource";
import { KosUplinkExecutor } from "./kosUplinkExecutor";

export type { KosManagedScript, KosScriptArg };

export interface KosConfig extends Record<string, unknown> {
  /**
   * CPU tagname, retained for config back-compat with the pre-Uplink
   * `kos-compute` source's saved settings. `executeScript` takes its CPU
   * as an explicit parameter and does not read this field — nothing in
   * this source currently does.
   */
  activeCpu: string;
}

const DEFAULT_CONFIG: KosConfig = {
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
const KOS_DISPATCH_BUDGET = createPerfBudget({
  name: "KosDataSource.executeScript dispatches/sec",
  threshold: 10,
  windowMs: 1000,
  unit: "dispatches",
});

interface KosDataSourceOptions {
  callTimeoutMs?: number;
  /**
   * Accepted for source-construction back-compat (existing tests pass it);
   * no longer used now that dispatch rides the `kos.run` Uplink rather than a
   * telnet REPL that needed a post-attach settle delay.
   */
  postAttachDrainDelayMs?: number;
}

/**
 * Single kOS data source: exposes `executeScript(cpu, script, args)` for
 * widgets that run kOS scripts on individual CPUs (dispatched over the
 * `kos.run` Uplink — see `kosUplinkExecutor.ts`), and surfaces CPU
 * discovery off the mod's native `kos.processors` push channel
 * (`onProcessorsChanged`). Carries no subscribable data keys of its own —
 * `schema()`/`subscribe()` are empty stubs satisfying the `DataSource`
 * contract.
 *
 * No persistent socket is held by this source. Everything rides the sitrep
 * telemetry stream: `executeScript` correlates a `kos.run.<coreId>` result,
 * and discovery stands up the moment a `TelemetryClient` is adopted
 * (`attachTelemetryClient`, driven by the `KosCpuDiscovery` mount).
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

  // The ONLY transport executeScript() dispatches through: the kos.run
  // Uplink command + kos.run.<coreId> channel. Also owns the standing
  // kos.processors subscription that feeds CPU discovery. See
  // kosUplinkExecutor.ts.
  private readonly uplinkExecutor: KosUplinkExecutor;

  constructor(config?: KosConfig, opts: KosDataSourceOptions = {}) {
    this.cfg = config ?? configStore.get();
    this.callTimeoutMs = opts.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    this.uplinkExecutor = new KosUplinkExecutor({
      timeoutMs: this.callTimeoutMs,
    });
    // Drive the status pill off kos.processors liveness — a fresh CPU list
    // (or its disappearance) is exactly the signal that the stream is up and
    // kOS is present.
    this.uplinkExecutor.onProcessorsChanged(() => this.recomputeStatus());
  }

  // --- Connection ---
  //
  // No socket of its own — the sitrep stream is mounted by
  // `SitrepTelemetryProvider`. Discovery and dispatch both ride whichever
  // `TelemetryClient` is adopted (see `attachTelemetryClient`). Status is
  // derived from `kos.processors` liveness once a stream is present.

  connect(): Promise<void> {
    const client = getActiveTelemetryClient();
    if (client) this.attachTelemetryClient(client);
    return Promise.resolve();
  }

  /**
   * Adopt the active sitrep `TelemetryClient` for kOS discovery + dispatch.
   * Establishes the STANDING `kos.processors` subscription so CPU discovery
   * works whenever a stream is mounted — not only while a `kos.run` dispatch
   * is pending. Idempotent for the same client; driven eagerly by the
   * `KosCpuDiscovery` mount on every client change.
   */
  attachTelemetryClient(client: TelemetryClient): void {
    this.uplinkExecutor.adopt(client);
    this.recomputeStatus();
  }

  /**
   * Subscribe to CPU-list changes off the mod's native `kos.processors`
   * push channel. Fires with the full processor snapshot (each entry
   * carries `tag`/`coreId`) whenever the list changes, and replays the
   * current snapshot synchronously on subscribe. The screen-side discovery
   * hook maps `procs.map(p => p.tag)` into the CPU registry.
   */
  onProcessorsChanged(cb: (procs: KosProcessorInfo[]) => void): () => void {
    return this.uplinkExecutor.onProcessorsChanged(cb);
  }

  disconnect(): void {
    this.uplinkExecutor.dispose();
    this.setStatus("disconnected");
  }

  // --- Data ---
  //
  // This source carries no subscribable data keys of its own — the
  // centralised kOS compute fanout that used to back these (kos.compute.*)
  // was removed as dead code (zero consumers once the kOS widgets were
  // streamlined to KosTerminal alone). Stubs kept to satisfy `DataSource`.

  schema(): DataKey[] {
    return [];
  }

  subscribe(_key: string, _cb: (value: unknown) => void): () => void {
    return () => {};
  }

  onStatusChange(cb: (status: DataSourceStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  /**
   * Subscribe to config changes (the active-CPU selection). The callback
   * fires every time `configure()` persists a new value.
   */
  onConfigChange(cb: () => void): () => void {
    this.configListeners.add(cb);
    return () => this.configListeners.delete(cb);
  }

  execute(action: string): Promise<void> {
    // No generic action is defined on this source — ad-hoc scripts go
    // through executeScript() directly, which carries enough structure
    // (cpu/script/args) that the generic action channel doesn't.
    return Promise.reject(
      new Error(
        `KosDataSource.execute: unknown action "${action}". Use executeScript() for ad-hoc scripts.`,
      ),
    );
  }

  // --- Public widget API ---

  /**
   * Run a script on the named CPU and resolve with its parsed [KOSDATA]
   * object, dispatched over the `kos.run` Uplink command (see
   * `kosUplinkExecutor.ts`) — the ONLY transport this method uses. Calls
   * to the same CPU are serialised by a per-core FIFO queue; calls to
   * different CPUs run in parallel. Rejects if the CPU's tagname doesn't
   * resolve to a known `coreId`, no `kos.run.<coreId>` result arrives
   * within the call timeout, or no telemetry stream is mounted at all
   * (`kOS Uplink not connected`).
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
    const client = getActiveTelemetryClient();
    if (!client) {
      return Promise.reject(
        new Error(
          "kOS Uplink not connected — no telemetry stream is mounted, so executeScript has no transport to dispatch on.",
        ),
      );
    }
    return this.uplinkExecutor.run(client, cpu, script, args, managed ?? null);
  }

  // --- Config ---

  configSchema(): ConfigField[] {
    return [
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
      activeCpu: this.cfg.activeCpu,
    };
  }

  configure(config: Record<string, unknown>): void {
    this.applyConfig(config, true);
  }

  /**
   * Apply a first-run seeded config WITHOUT persisting — same notify path as
   * `configure`.
   */
  applySeededConfig(config: Record<string, unknown>): void {
    this.applyConfig(config, false);
  }

  private applyConfig(config: Record<string, unknown>, persist: boolean): void {
    this.cfg = {
      activeCpu:
        typeof config.activeCpu === "string"
          ? config.activeCpu
          : this.cfg.activeCpu,
    };
    if (persist) configStore.set(this.cfg);
    this.recomputeStatus();
    this.configListeners.forEach((cb) => {
      cb();
    });
  }

  // --- Status ---

  private recomputeStatus(): void {
    // Derived from the sitrep stream / kos.processors liveness the executor
    // tracks — connected once a CPU list has landed on the stream,
    // reconnecting while a stream is mounted but no CPU has reported yet,
    // disconnected when no stream is adopted at all.
    if (this.uplinkExecutor.hasLiveProcessors) {
      this.setStatus("connected");
    } else if (this.uplinkExecutor.hasClient) {
      this.setStatus("reconnecting");
    } else {
      this.setStatus("disconnected");
    }
  }

  private setStatus(status: DataSourceStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.statusListeners.forEach((cb) => {
      cb(status);
    });
  }

  // Host-side relay handle for station peer-relayed calls (see
  // PeerHostService.handleUplinkRelay / PeerClientDataSource.relay). Only
  // the "executeScript" method is exposed today — the kOS-specific
  // isScriptError-via-errorMeta unwrap is the calling client's own
  // responsibility, not this source's.
  async relay(method: string, args: unknown): Promise<unknown> {
    if (method === "executeScript") {
      const a = args as {
        cpu: string;
        script: string;
        args: KosScriptArg[];
        managed?: KosManagedScript;
      };
      return this.executeScript(a.cpu, a.script, a.args, a.managed);
    }
    throw new Error(`kos relay handle: unknown method "${method}"`);
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
registerUplinkHandle("kos", kosSource);
