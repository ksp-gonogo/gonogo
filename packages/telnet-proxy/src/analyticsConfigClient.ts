/**
 * Subscribes to the relay's `/analytics-config/stream` SSE feed and reports
 * the current consent to a callback. A `fetch`-based reader (not the global
 * `EventSource`, which isn't guaranteed in Node and isn't cleanly mockable)
 * so MSW can intercept it at the network boundary in tests.
 *
 * Fail-soft + privacy-first: the relay is optional infrastructure. Until a
 * value is received the consent stays whatever the caller defaulted to
 * (disabled). A dropped stream reconnects with a fixed backoff; a stop()
 * aborts cleanly.
 */

export interface AnalyticsConfigClientOptions {
  relayUrl: string;
  onConsent: (enabled: boolean) => void;
  /** Reconnect delay after the stream drops. Default 5s. */
  reconnectMs?: number;
  /** Injectable fetch for tests; defaults to the global. */
  fetchImpl?: typeof fetch;
  /** Logger hooks; default to no-ops so tests stay quiet. */
  log?: { info?: (m: string) => void; warn?: (m: string) => void };
}

export class AnalyticsConfigClient {
  private readonly url: string;
  private readonly onConsent: (enabled: boolean) => void;
  private readonly reconnectMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly log: NonNullable<AnalyticsConfigClientOptions["log"]>;
  private controller: AbortController | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(opts: AnalyticsConfigClientOptions) {
    this.url = `${opts.relayUrl.replace(/\/$/, "")}/analytics-config/stream`;
    this.onConsent = opts.onConsent;
    this.reconnectMs = opts.reconnectMs ?? 5_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.log = opts.log ?? {};
  }

  /** Open the stream and keep it open, reconnecting on drop. */
  start(): void {
    this.stopped = false;
    void this.connect();
  }

  /** Abort the stream and cancel any pending reconnect. */
  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.controller?.abort();
    this.controller = null;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, this.reconnectMs);
    this.reconnectTimer.unref?.();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.controller = new AbortController();
    try {
      const res = await this.fetchImpl(this.url, {
        headers: { accept: "text/event-stream" },
        signal: this.controller.signal,
      });
      if (!res.ok || !res.body) {
        this.log.warn?.(
          `[analytics-config] stream returned ${res.status} — retrying`,
        );
        this.scheduleReconnect();
        return;
      }
      this.log.info?.("[analytics-config] subscribed to relay consent stream");
      await this.readStream(res.body);
      // Stream ended cleanly (server closed) — reconnect unless we stopped.
      this.scheduleReconnect();
    } catch (err) {
      if (this.stopped) return;
      this.log.warn?.(
        `[analytics-config] stream error (${
          err instanceof Error ? err.message : String(err)
        }) — retrying`,
      );
      this.scheduleReconnect();
    }
  }

  private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by a blank line.
      let sep = buffer.indexOf("\n\n");
      while (sep !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        this.handleEvent(rawEvent);
        sep = buffer.indexOf("\n\n");
      }
    }
  }

  private handleEvent(rawEvent: string): void {
    for (const line of rawEvent.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      try {
        const parsed = JSON.parse(data) as { enabled?: unknown };
        if (typeof parsed.enabled === "boolean") {
          this.onConsent(parsed.enabled);
        }
      } catch {
        // Ignore malformed frames — never crash the proxy on a bad event.
      }
    }
  }
}
