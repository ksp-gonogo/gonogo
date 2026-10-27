import { AxiomFetchClient } from "./AxiomFetchClient.js";
import { collapseContext } from "./collapseContext.js";
import { scrubEntry } from "./scrub.js";
import type { LogEntry, LogTransport } from "./types.js";

/**
 * Minimal contract we depend on from the Axiom SDK. Lets tests inject a
 * fake without standing up the real client (and avoids the SDK reaching
 * for the network during unit tests).
 */
export interface AxiomIngestClient {
  ingest(dataset: string, events: object | readonly object[]): void;
  /**
   * Sends everything handed to `ingest`. Rejects when delivery failed, in
   * which case the client keeps the events for the next call. `keepalive`
   * asks the browser to finish the request after the page has closed.
   */
  flush(options?: { keepalive?: boolean }): Promise<void>;
}

export interface AxiomTransportOptions {
  /** Axiom dataset name. Required. */
  dataset: string;
  /**
   * Pre-built Axiom client. Provide this or `token`. Tests typically
   * inject a mock; production builds pass `token` and let the transport
   * construct the SDK's `Axiom` client itself.
   */
  client?: AxiomIngestClient;
  /** Axiom API token. Used only when `client` is omitted. */
  token?: string;
  /** Custom Axiom URL (e.g. Eu region or self-hosted). */
  url?: string;
  /** Org id for personal tokens. */
  orgId?: string;
  /**
   * Auto-flush on the browser `pagehide` event. Defaults to `true` in
   * environments that expose `addEventListener` and `false` otherwise.
   * Tests pass `false` to keep behaviour deterministic.
   */
  flushOnPageHide?: boolean;
  /** How long lines are held to go out as one request. Defaults to 1000. */
  flushIntervalMs?: number;
  /**
   * Called when a delivery attempt fails, before it is retried. Omitted,
   * failures are silent.
   */
  onError?: (error: unknown) => void;
}

/**
 * Logger transport that fans entries out to Axiom. Lines are held for a
 * second and sent together; an error line goes at once. A failed send keeps
 * its lines and is retried with a growing delay and whenever the browser
 * reports it is online again, and the page closing sends what is waiting
 * as a request that outlives the page.
 *
 * Entries are scrubbed of share codes, addresses, host names, peer ids and
 * URLs before they leave, and a context object whose keys come from data is
 * collapsed to a JSON string so it cannot add fields to the dataset. Failures are swallowed, log delivery never crashes
 * the app.
 */
export class AxiomTransport implements LogTransport {
  /** Max entries per `ingest` call: bounds a one-shot backfill so a full
   *  ring-buffer flush is split across several requests. */
  private static readonly MAX_BATCH = 500;
  private static readonly RETRY_START_MS = 2000;
  private static readonly RETRY_MAX_MS = 60_000;
  private readonly client: AxiomIngestClient;
  private readonly dataset: string;
  private queue: object[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly flushIntervalMs: number;
  private pageHideHandler: (() => void) | null = null;
  private onlineHandler: (() => void) | null = null;
  private inFlight: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelayMs = AxiomTransport.RETRY_START_MS;
  private readonly onError: ((error: unknown) => void) | undefined;

  constructor(options: AxiomTransportOptions) {
    if (!options.dataset) {
      throw new Error("AxiomTransport requires a dataset name");
    }

    this.dataset = options.dataset;
    this.flushIntervalMs = options.flushIntervalMs ?? 1000;
    this.onError = options.onError;
    this.client = AxiomTransport.resolveClient(options);

    const wantPageHide =
      options.flushOnPageHide ??
      typeof globalThis.addEventListener === "function";
    if (wantPageHide && typeof globalThis.addEventListener === "function") {
      this.pageHideHandler = () => {
        void this.flush({ keepalive: true });
      };
      globalThis.addEventListener("pagehide", this.pageHideHandler);
    }
    if (typeof globalThis.addEventListener === "function") {
      this.onlineHandler = () => {
        void this.flush();
      };
      globalThis.addEventListener("online", this.onlineHandler);
    }
  }

  private static resolveClient(
    options: AxiomTransportOptions,
  ): AxiomIngestClient {
    if (options.client) return options.client;
    if (options.token) {
      return new AxiomFetchClient({
        token: options.token,
        url: options.url,
        orgId: options.orgId,
      });
    }
    throw new Error("AxiomTransport requires either `client` or `token`");
  }

  send(unscrubbed: readonly LogEntry[]): void {
    if (unscrubbed.length === 0) return;
    try {
      /*
       * Every event passes through here, so scrubbing here covers every call
       * site. `_time` is the field Axiom files an event under; without it the
       * event is filed at the moment it arrived, which puts a backfill of the
       * whole pre-consent buffer at the moment analytics was switched on.
       */
      for (const e of unscrubbed) {
        this.queue.push({
          _time: e.timestamp,
          ...collapseContext(scrubEntry(e)),
        });
      }
      if (
        this.queue.length >= AxiomTransport.MAX_BATCH ||
        unscrubbed.some((e) => e.level === "error")
      ) {
        void this.flush();
        return;
      }
      /*
       * The SDK sends at once whenever its last request is over a second old,
       * so handing it each line as it is logged makes one request per line.
       * Holding lines here and handing them over together makes one.
       */
      this.timer ??= setTimeout(() => {
        void this.flush();
      }, this.flushIntervalMs);
    } catch {
      // ignore: never let a logging path throw
    }
  }

  /**
   * Sends what is queued. A flush that starts while another is under way
   * waits for it, so the caller sees any failure reported before it resolves.
   */
  flush(options?: { keepalive?: boolean }): Promise<void> {
    const run = this.inFlight
      ? this.inFlight.then(() => this.deliver(options))
      : this.deliver(options);
    this.inFlight = run;
    void run.then(() => {
      if (this.inFlight === run) this.inFlight = null;
    });
    return run;
  }

  private async deliver(options?: { keepalive?: boolean }): Promise<void> {
    try {
      if (this.timer !== null) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      const queued = this.queue;
      this.queue = [];
      for (let i = 0; i < queued.length; i += AxiomTransport.MAX_BATCH) {
        this.client.ingest(
          this.dataset,
          queued.slice(i, i + AxiomTransport.MAX_BATCH),
        );
      }
      await this.client.flush(options);
      this.retryDelayMs = AxiomTransport.RETRY_START_MS;
      this.clearRetry();
    } catch (error) {
      try {
        this.onError?.(error);
      } catch {
        // ignore
      }
      this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, this.retryDelayMs);
    this.retryDelayMs = Math.min(
      this.retryDelayMs * 2,
      AxiomTransport.RETRY_MAX_MS,
    );
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** Detach the `pagehide` and `online` handlers and stop any retry. */
  dispose(): void {
    if (
      this.pageHideHandler &&
      typeof globalThis.removeEventListener === "function"
    ) {
      globalThis.removeEventListener("pagehide", this.pageHideHandler);
    }
    this.pageHideHandler = null;
    if (
      this.onlineHandler &&
      typeof globalThis.removeEventListener === "function"
    ) {
      globalThis.removeEventListener("online", this.onlineHandler);
    }
    this.onlineHandler = null;
    this.clearRetry();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
