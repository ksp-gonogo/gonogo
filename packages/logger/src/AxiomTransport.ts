import { Axiom } from "@axiomhq/js";
import type { LogEntry, LogTransport } from "./types.js";

/**
 * Minimal contract we depend on from the Axiom SDK. Lets tests inject a
 * fake without standing up the real client (and avoids the SDK reaching
 * for the network during unit tests).
 */
export interface AxiomIngestClient {
  ingest(dataset: string, events: object | object[]): void;
  flush(): Promise<void>;
}

export interface AxiomTransportOptions {
  /** Axiom dataset name. Required. */
  dataset: string;
  /**
   * Pre-built Axiom client. Provide this OR `token`. Tests typically
   * inject a mock; production builds pass `token` and let the transport
   * construct the SDK's `Axiom` client itself.
   */
  client?: AxiomIngestClient;
  /** Axiom API token. Used only when `client` is omitted. */
  token?: string;
  /** Custom Axiom URL (e.g. EU region or self-hosted). */
  url?: string;
  /** Org id for personal tokens. */
  orgId?: string;
  /**
   * Auto-flush on the browser `pagehide` event. Defaults to `true` in
   * environments that expose `addEventListener` and `false` otherwise.
   * Tests pass `false` to keep behaviour deterministic.
   */
  flushOnPageHide?: boolean;
}

/**
 * Logger transport that fans entries out to Axiom via `@axiomhq/js`. The
 * SDK auto-batches (1s / 1000 events) and retries transient failures, so
 * this wrapper is intentionally thin: convert {@link LogEntry} to JSON,
 * push to the client, and best-effort drain on tab close.
 *
 * Failures are swallowed — log delivery never crashes the app.
 */
export class AxiomTransport implements LogTransport {
  private readonly client: AxiomIngestClient;
  private readonly dataset: string;
  private pageHideHandler: (() => void) | null = null;

  constructor(options: AxiomTransportOptions) {
    if (!options.dataset) {
      throw new Error("AxiomTransport requires a dataset name");
    }
    if (!options.client && !options.token) {
      throw new Error("AxiomTransport requires either `client` or `token`");
    }

    this.dataset = options.dataset;
    if (options.client) {
      this.client = options.client;
    } else {
      this.client = new Axiom({
        token: options.token as string,
        url: options.url,
        orgId: options.orgId,
        // Silence the SDK's default `console.error` so a transient ingest
        // failure doesn't show up as a noisy error on the user's screen.
        // The console transport (i.e. `ConsoleLogger`) keeps its own log
        // visibility independent of remote delivery.
        onError: () => {},
      }) as unknown as AxiomIngestClient;
    }

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

  send(entries: readonly LogEntry[]): void {
    if (entries.length === 0) return;
    try {
      this.client.ingest(this.dataset, entries as unknown as object[]);
    } catch {
      // ignore — never let a logging path throw
    }
  }

  async flush(): Promise<void> {
    try {
      await this.client.flush();
    } catch {
      // ignore
    }
  }

  /** Detach the `pagehide` handler. Used in tests to release the listener. */
  dispose(): void {
    if (
      this.pageHideHandler &&
      typeof globalThis.removeEventListener === "function"
    ) {
      globalThis.removeEventListener("pagehide", this.pageHideHandler);
    }
    this.pageHideHandler = null;
  }
}
