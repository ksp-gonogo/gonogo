import { safeRandomUuid } from "@ksp-gonogo/core";
import type { KosData, KosManagedScript, KosScriptArg } from "@ksp-gonogo/data";
import { KosScriptError } from "@ksp-gonogo/data";
import type { TelemetryClient } from "@ksp-gonogo/sitrep-client";
import type {
  CommandResult,
  KosProcessorInfo,
  KosRunArgs,
  KosRunResult,
} from "@ksp-gonogo/sitrep-sdk";
import { buildKosRunCommand } from "./kosWrapper";

/**
 * `KosDataSource.executeScript`'s Uplink implementation — dispatches the
 * kerboscript wrapper text (see `kosWrapper.ts`'s `buildKosRunCommand`) via
 * the `kos.run` command and resolves with the correlated `kos.run.<coreId>`
 * result. This is the ONLY transport `executeScript` uses — there is no
 * telnet path anymore.
 *
 * The `kos.processors` push channel it subscribes to for tagname → coreId
 * resolution doubles as the app's CPU-discovery feed: `onProcessorsChanged`
 * surfaces the processor list (which carries each CPU's `tag`) to the
 * screen-side registry. The subscription is STANDING — established the
 * moment a `TelemetryClient` is adopted (`adopt`, driven eagerly by the
 * `KosCpuDiscovery` mount) and held for that client's lifetime — so
 * discovery works whenever a sitrep stream is mounted, not only while a
 * `kos.run` dispatch is pending.
 *
 * Mirrors the proven wire pattern from
 * `mod/Gonogo.Kos/client/src/shared/useKosRun.ts` (dispatch → ack → wait
 * for the correlated channel frame → resolve/reject), but as plain,
 * non-hook code driving a `TelemetryClient` handed in by the caller —
 * `KosDataSource` is a plain class, not a React component.
 */

const PROCESSORS_TOPIC = "kos.processors";

const DEFAULT_TIMEOUT_MS = 30_000;

interface QueuedRun {
  script: string;
  args: KosScriptArg[];
  managed: KosManagedScript | null;
  resolve: (data: KosData) => void;
  reject: (err: Error) => void;
}

interface InFlightRun {
  requestId: string;
  call: QueuedRun;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Per-CPU FIFO in front of `kos.run` dispatches to a single `coreId`. A kOS
 * CPU's REPL is single-threaded — only one command may be in flight — so
 * calls to the SAME core are serialised here; calls to different cores get
 * their own queue and run in parallel.
 */
class KosUplinkCpuQueue {
  private queue: QueuedRun[] = [];
  private inFlight: InFlightRun | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly client: TelemetryClient,
    private readonly coreId: number,
    private readonly timeoutMs: number,
  ) {
    this.unsubscribe = client.subscribe(`kos.run.${coreId}`, (payload) => {
      this.handleResult(payload as KosRunResult);
    });
  }

  enqueue(
    script: string,
    args: KosScriptArg[],
    managed: KosManagedScript | null,
  ): Promise<KosData> {
    return new Promise<KosData>((resolve, reject) => {
      this.queue.push({ script, args, managed, resolve, reject });
      this.drain();
    });
  }

  /** Reject every queued/in-flight call and drop the channel subscription. */
  dispose(reason: string): void {
    this.unsubscribe();
    if (this.inFlight) {
      clearTimeout(this.inFlight.timer);
      this.inFlight.call.reject(new Error(reason));
      this.inFlight = null;
    }
    for (const call of this.queue) call.reject(new Error(reason));
    this.queue = [];
  }

  private drain(): void {
    if (this.inFlight) return;
    const next = this.queue.shift();
    if (!next) return;
    const requestId = safeRandomUuid();
    const command = buildKosRunCommand(next.script, next.args, next.managed);
    const timer = setTimeout(() => {
      this.onTimeout(requestId);
    }, this.timeoutMs);
    this.inFlight = { requestId, call: next, timer };

    const { result } = this.client.dispatch("kos.run", {
      coreId: this.coreId,
      requestId,
      command,
    } satisfies KosRunArgs);

    result
      .then((ack) => {
        const r = ack as CommandResult | undefined;
        if (r && r.success === false) {
          this.settleFailure(
            requestId,
            new Error(
              `kos.run: command rejected for CPU ${this.coreId} (errorCode ${r.errorCode})`,
            ),
          );
        }
        // success:true carries no payload of its own — the real result
        // arrives asynchronously on kos.run.<coreId>, handled below.
      })
      .catch((err: unknown) => {
        this.settleFailure(
          requestId,
          err instanceof Error ? err : new Error(String(err)),
        );
      });
  }

  private handleResult(payload: KosRunResult): void {
    // Correlate by requestId — a foreign/stale id (a duplicate, the sticky
    // replay of some earlier call, or a result meant for a call we already
    // timed out) must not settle the CURRENT in-flight call.
    if (!this.inFlight || this.inFlight.requestId !== payload.requestId) {
      return;
    }
    const { call, timer } = this.inFlight;
    clearTimeout(timer);
    this.inFlight = null;
    if (payload.error != null) {
      // Both parse-time kOS errors and explicit [KOSERROR] blocks arrive
      // this way from the mod (KosRunManager.Complete) — KosScriptError so
      // useKosWidget's consecutive-error breaker counts it, same as the
      // telnet path's explicit/implicit error handling.
      call.reject(new KosScriptError(payload.error));
    } else {
      call.resolve((payload.fields ?? {}) as KosData);
    }
    this.drain();
  }

  private onTimeout(requestId: string): void {
    if (!this.inFlight || this.inFlight.requestId !== requestId) return;
    const { call } = this.inFlight;
    this.inFlight = null;
    call.reject(
      new Error(
        `kos.run: CPU ${this.coreId} did not respond within ${this.timeoutMs}ms`,
      ),
    );
    this.drain();
  }

  private settleFailure(requestId: string, err: Error): void {
    if (!this.inFlight || this.inFlight.requestId !== requestId) return;
    const { call, timer } = this.inFlight;
    clearTimeout(timer);
    this.inFlight = null;
    call.reject(err);
    this.drain();
  }
}

/**
 * Owns the tagname → coreId lookup (via the mod's native `kos.processors`
 * push channel) and one `KosUplinkCpuQueue` per resolved core. One instance
 * lives for the lifetime of `KosDataSource`; `run()` re-adopts whichever
 * `TelemetryClient` the caller hands in each call, tearing down every
 * subscription/queue tied to a previous client if it has changed (a fresh
 * `TelemetryProvider` mount invalidates old subscriptions and any
 * in-flight correlation against the old transport).
 */
export class KosUplinkExecutor {
  private readonly timeoutMs: number;
  private client: TelemetryClient | null = null;
  private processorsUnsub: (() => void) | null = null;
  private readonly coreIdByTag = new Map<string, number>();
  private readonly queues = new Map<number, KosUplinkCpuQueue>();
  // Last processor snapshot delivered on `kos.processors`, retained so a
  // late `onProcessorsChanged` subscriber (the screen-side discovery hook,
  // which registers after mount) gets the current CPU list immediately
  // instead of waiting for the next push. Reset on client change (dispose).
  private lastProcessors: KosProcessorInfo[] = [];
  private readonly processorsListeners = new Set<
    (procs: KosProcessorInfo[]) => void
  >();

  constructor(opts: { timeoutMs?: number } = {}) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Adopt `client` for discovery WITHOUT dispatching a run — the eager
   * entry point the `KosCpuDiscovery` mount calls so the `kos.processors`
   * subscription (and thus CPU discovery) stands up as soon as a sitrep
   * stream is mounted. Idempotent for the same client; a different client
   * tears down the old subscriptions first (see `adoptClient`).
   */
  adopt(client: TelemetryClient): void {
    this.adoptClient(client);
  }

  /**
   * True once a `TelemetryClient` is adopted AND the mod has reported at
   * least one CPU on `kos.processors` — i.e. the sitrep stream is live and
   * kOS is actually present. Drives `KosDataSource`'s status pill.
   */
  get hasLiveProcessors(): boolean {
    return this.client !== null && this.lastProcessors.length > 0;
  }

  /** True once a `TelemetryClient` has been adopted (stream mounted). */
  get hasClient(): boolean {
    return this.client !== null;
  }

  /**
   * Subscribe to CPU-list changes. Fires with the full processor snapshot
   * (each entry carries `tag`/`coreId`) every time `kos.processors` pushes a
   * new list, and replays the current snapshot synchronously on subscribe so
   * a late subscriber isn't blank until the next push. Returns an unsubscribe.
   */
  onProcessorsChanged(cb: (procs: KosProcessorInfo[]) => void): () => void {
    this.processorsListeners.add(cb);
    if (this.lastProcessors.length > 0) cb(this.lastProcessors);
    return () => this.processorsListeners.delete(cb);
  }

  /**
   * Run `script` on `cpu` (a tagname) via the `kos.run` Uplink. Rejects
   * immediately — no telnet fallback — if `cpu` doesn't resolve to a known
   * `coreId` yet (the `kos.processors` channel hasn't reported it, or it's
   * genuinely not a live CPU).
   */
  run(
    client: TelemetryClient,
    cpu: string,
    script: string,
    args: KosScriptArg[],
    managed: KosManagedScript | null,
  ): Promise<KosData> {
    this.adoptClient(client);
    const coreId = this.coreIdByTag.get(cpu);
    if (coreId === undefined) {
      return Promise.reject(
        new Error(
          `kos.run: no known CPU with tagname "${cpu}" — waiting on kos.processors, or the tagname is wrong`,
        ),
      );
    }
    return this.getOrCreateQueue(coreId).enqueue(script, args, managed);
  }

  /** Tear down every subscription and queue, rejecting any in-flight/queued call. */
  dispose(): void {
    this.processorsUnsub?.();
    this.processorsUnsub = null;
    for (const queue of this.queues.values()) {
      queue.dispose("kos: Uplink executor disposed");
    }
    this.queues.clear();
    this.coreIdByTag.clear();
    this.lastProcessors = [];
    this.client = null;
  }

  private adoptClient(client: TelemetryClient): void {
    if (this.client === client) return;
    // A different TelemetryClient instance (reconnect / provider remount)
    // invalidates every subscription and correlation tied to the old one.
    this.dispose();
    this.client = client;
    this.processorsUnsub = client.subscribe(PROCESSORS_TOPIC, (payload) => {
      this.handleProcessors(payload as KosProcessorInfo[] | undefined);
    });
  }

  private handleProcessors(info: KosProcessorInfo[] | undefined): void {
    if (!Array.isArray(info)) return;
    // Full-snapshot channel — replace, don't merge, so a CPU that goes
    // away (reboot / unload) stops resolving instead of sticking around
    // on a stale coreId.
    this.coreIdByTag.clear();
    for (const p of info) {
      if (p.tag) this.coreIdByTag.set(p.tag, p.coreId);
    }
    this.lastProcessors = info;
    for (const cb of this.processorsListeners) cb(info);
  }

  private getOrCreateQueue(coreId: number): KosUplinkCpuQueue {
    const existing = this.queues.get(coreId);
    if (existing) return existing;
    if (!this.client) {
      // Unreachable in practice — adoptClient() always runs first in run()
      // — but keeps this method safe to call standalone.
      throw new Error("kos.run: no active telemetry client");
    }
    const queue = new KosUplinkCpuQueue(this.client, coreId, this.timeoutMs);
    this.queues.set(coreId, queue);
    return queue;
  }
}
