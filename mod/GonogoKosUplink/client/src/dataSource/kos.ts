import type { KosProcessorInfo, TelemetryClient } from "@ksp-gonogo/sitrep-sdk";
import {
  createPerfBudget,
  getActiveTelemetryClient,
  registerUplinkHandle,
} from "@ksp-gonogo/sitrep-sdk";
import type { KosData, KosScriptArg } from "../shared/kos-data-parser";
import type { KosManagedScript } from "../shared/ScriptableDataSource";
import { KosUplinkExecutor } from "./kosUplinkExecutor";

export type { KosManagedScript, KosScriptArg };

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
 * Plain kOS Uplink client: exposes `executeScript(cpu, script, args)` for
 * widgets that run kOS scripts on individual CPUs (dispatched over the
 * `kos.run` Uplink — see `kosUplinkExecutor.ts`), and surfaces CPU
 * discovery off the mod's native `kos.processors` push channel
 * (`onProcessorsChanged`). Registered only via `registerUplinkHandle("kos",
 * kosSource)` — NOT `registerDataSource` — so it never appears in the
 * generic Data Sources panel; kOS's own health surfaces via the mod-side
 * `IUplinkHealthReporter` (`KosHealth`) instead. Same SPI-free shape as
 * other first-party Uplinks that carry no subscribable data keys of their
 * own.
 *
 * No persistent socket is held by this source. Everything rides the sitrep
 * telemetry stream: `executeScript` correlates a `kos.run.<coreId>` result,
 * and discovery stands up the moment a `TelemetryClient` is adopted
 * (`attachTelemetryClient`, driven by the `KosCpuDiscovery` mount).
 */
export class KosDataSource {
  id = "kos";
  name = "kOS";

  private readonly callTimeoutMs: number;

  // The ONLY transport executeScript() dispatches through: the kos.run
  // Uplink command + kos.run.<coreId> channel. Also owns the standing
  // kos.processors subscription that feeds CPU discovery. See
  // kosUplinkExecutor.ts.
  private readonly uplinkExecutor: KosUplinkExecutor;

  constructor(opts: KosDataSourceOptions = {}) {
    this.callTimeoutMs = opts.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    this.uplinkExecutor = new KosUplinkExecutor({
      timeoutMs: this.callTimeoutMs,
    });
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
  }

  /**
   * Subscribe to CPU-list changes off the mod's native `kos.processors`
   * push channel. Fires with the full processor snapshot (each entry
   * carries `tag`/`coreId`) whenever the list changes, and replays the
   * current snapshot synchronously on subscribe. `KosCpuDiscovery` maps
   * `procs.map(p => p.tag)` into the CPU registry.
   */
  onProcessorsChanged(cb: (procs: KosProcessorInfo[]) => void): () => void {
    return this.uplinkExecutor.onProcessorsChanged(cb);
  }

  /** Tear down the standing subscription and reject any in-flight dispatch. */
  disconnect(): void {
    this.uplinkExecutor.dispose();
  }

  // --- Public widget API ---

  /**
   * Run a script on the named CPU and resolve with its parsed [KOSDATA]
   * object, dispatched over the `kos.run` Uplink (see `kosUplinkExecutor.ts`)
   * — the ONLY transport this method uses. Calls to the same CPU are
   * serialised by a per-core FIFO queue; calls to different CPUs run in
   * parallel. Rejects if the CPU's tagname doesn't resolve to a known
   * `coreId`, no `kos.run.<coreId>` result arrives within the call timeout,
   * or no telemetry stream is mounted at all (`kOS Uplink not connected`).
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

export const kosSource = new KosDataSource();
registerUplinkHandle("kos", kosSource);
