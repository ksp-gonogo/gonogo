import { Axiom } from "@axiomhq/js";
import { scrubEntry } from "./scrub.js";
import type { LogEntry, LogTransport } from "./types.js";

/**
 * Minimal contract we depend on from the Axiom SDK. Lets tests inject a
 * fake without standing up the real client (and avoids the SDK reaching
 * for the network during unit tests).
 */
export interface AxiomIngestClient {
  ingest(dataset: string, events: object | readonly object[]): void;
  flush(): Promise<void>;
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
   * Called when the SDK fails to deliver a batch. Only used when the
   * transport builds the client from `token`. Omitted, failures are silent.
   */
  onError?: (error: unknown) => void;
}

/**
 * Logger transport that fans entries out to Axiom via `@axiomhq/js`. The
 * SDK auto-batches (1s / 1000 events) and retries transient failures, so
 * this wrapper is intentionally thin: convert {@link LogEntry} to JSON,
 * push to the client, and best-effort drain on tab close.
 *
 * Entries are scrubbed of share codes, addresses, host names, peer ids and
 * URLs before they leave. Failures are swallowed, log delivery never crashes
 * the app.
 */
export class AxiomTransport implements LogTransport {
  /** Max entries per `ingest` call: bounds a one-shot backfill so a full
   *  ring-buffer flush is split across several requests. */
  private static readonly MAX_BATCH = 500;
  private readonly client: AxiomIngestClient;
  private readonly dataset: string;
  private queue: object[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly flushIntervalMs: number;
  private pageHideHandler: (() => void) | null = null;

  constructor(options: AxiomTransportOptions) {
    if (!options.dataset) {
      throw new Error("AxiomTransport requires a dataset name");
    }

    this.dataset = options.dataset;
    this.flushIntervalMs = options.flushIntervalMs ?? 1000;
    this.client = AxiomTransport.resolveClient(options);

    const wantPageHide =
      options.flushOnPageHide ??
      typeof globalThis.addEventListener === "function";
    if (wantPageHide && typeof globalThis.addEventListener === "function") {
      this.pageHideHandler = () => {
        void this.flush();
      };
      globalThis.addEventListener("pagehide", this.pageHideHandler);
    }
  }

  private static resolveClient(
    options: AxiomTransportOptions,
  ): AxiomIngestClient {
    if (options.client) return options.client;
    if (options.token) {
      return new Axiom({
        token: options.token,
        url: options.url,
        orgId: options.orgId,
        // Silence the SDK's default `console.error` so a transient ingest
        // failure doesn't show up as a noisy error on the user's screen.
        // The console transport (i.e. `ConsoleLogger`) keeps its own log
        // visibility independent of remote delivery.
        onError: options.onError ?? (() => {}),
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
        this.queue.push({ _time: e.timestamp, ...scrubEntry(e) });
      }
      if (this.queue.length >= AxiomTransport.MAX_BATCH) {
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

  async flush(): Promise<void> {
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
      await this.client.flush();
    } catch {
      // ignore
    }
  }

  /** Detach the `pagehide` handler. */
  dispose(): void {
    if (
      this.pageHideHandler &&
      typeof globalThis.removeEventListener === "function"
    ) {
      globalThis.removeEventListener("pagehide", this.pageHideHandler);
    }
    this.pageHideHandler = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
