import type { DataSourceStatus } from "@ksp-gonogo/core";
import { logger } from "@ksp-gonogo/logger";
import type { KosCpu } from "./kos-menu-parser";
import { parseKosMenu, parseListChanged } from "./kos-menu-parser";

/**
 * Long-lived "menu peek" ws — opens a kOS proxy connection that never
 * selects a CPU, just reads the welcome menu and watches for "List of
 * CPU's has Changed" redraws. Feeds the discovery callback so the
 * registry stays populated even when no widget is attached.
 *
 * Holds one of kOS's MAX_CONNECTIONS slots (default 5) for the
 * lifetime of the data source. Worth it for users who configure kOS:
 * the picker, the online indicator, and "describe each CPU once"
 * workflow all need this list to exist before any widget runs.
 */
export interface KosMenuPeekInit {
  proxyHost: string;
  proxyPort: number;
  kosHost: string;
  kosPort: number;
  onCpusDiscovered: (cpus: KosCpu[]) => void;
}

export class KosMenuPeekSession {
  private readonly init: KosMenuPeekInit;
  private ws: WebSocket | null = null;
  private buffer = "";
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelayMs = INITIAL_RETRY_DELAY_MS;
  private closed = false;
  /** Last menu text we acted on — debounce identical re-renders. */
  private lastMenuKey = "";
  /**
   * Connection status surfaced to KosDataSource so the data-source pill
   * reflects "kOS proxy reachable" even when no widget has an active
   * compute session. Without this, the pill would flicker to
   * "disconnected" between compute-session cycles even though the
   * menu-peek WS is wide open.
   */
  status: DataSourceStatus = "disconnected";
  private readonly statusListeners = new Set<
    (status: DataSourceStatus) => void
  >();

  constructor(init: KosMenuPeekInit) {
    this.init = init;
  }

  onStatusChange(cb: (status: DataSourceStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  private setStatus(next: DataSourceStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const cb of this.statusListeners) cb(next);
  }

  open(): void {
    if (this.closed) return;
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return;
    this.clearRetryTimer();
    // Mirror KosComputeSession.ensureOpen — the proxy is the same /kos
    // endpoint, but we never send a selection number, so kOS holds us in
    // welcomeMenu state and re-emits the list on vessel changes.
    const url =
      `ws://${this.init.proxyHost}:${this.init.proxyPort}/kos` +
      `?host=${encodeURIComponent(this.init.kosHost)}` +
      `&port=${this.init.kosPort}` +
      `&cols=80&rows=10000`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      logger.tag("kos").debug("menu peek ws construction failed; will retry", {
        error: err instanceof Error ? err.message : String(err),
      });
      this.setStatus("reconnecting");
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    this.buffer = "";
    this.setStatus("reconnecting");
    ws.addEventListener("message", (e) => {
      const text =
        typeof (e as MessageEvent).data === "string"
          ? (e as MessageEvent).data
          : String((e as MessageEvent).data);
      this.onMessage(text);
    });
    ws.addEventListener("open", () => {
      // Reset backoff once we've successfully connected.
      this.retryDelayMs = INITIAL_RETRY_DELAY_MS;
      this.setStatus("connected");
    });
    ws.addEventListener("close", () => {
      this.ws = null;
      if (this.closed) {
        this.setStatus("disconnected");
      } else {
        this.setStatus("reconnecting");
        this.scheduleRetry();
      }
    });
    ws.addEventListener("error", () => {
      // Stay quiet on the log front — proxy down is the steady state
      // for users without it running, and per-session reconnects would
      // surface anything else. The close event that follows handles
      // the status transition.
    });
  }

  close(): void {
    this.closed = true;
    this.clearRetryTimer();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* already closed */
      }
      this.ws = null;
    }
    this.setStatus("disconnected");
  }

  private onMessage(text: string): void {
    if (parseListChanged(text)) {
      // Vessel switched / CPU set changed — drop the old menu text so we
      // parse the redraw cleanly.
      this.buffer = "";
    }
    this.buffer += text;
    const menu = parseKosMenu(this.buffer);
    if (menu === null) return;
    // Debounce: kOS re-paints the menu more than once per render cycle.
    // Hash on tagnames (the only field discovery cares about).
    const key = menu.cpus.map((c) => `${c.number}:${c.tagname}`).join("|");
    if (key === this.lastMenuKey) return;
    this.lastMenuKey = key;
    this.init.onCpusDiscovered(menu.cpus);
  }

  private scheduleRetry(): void {
    this.clearRetryTimer();
    if (this.closed) return;
    const delay = this.retryDelayMs;
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, MAX_RETRY_DELAY_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
}

const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;
