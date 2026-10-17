import { debugPeer } from "@ksp-gonogo/logger";
import { relayBaseUrl } from "./iceServers";

/** Heartbeat cadence for re-asserting analytics consent, so a relay restart
 *  (which resets its in-memory config to disabled) re-learns the real value
 *  within one beat. */
const HOST_HEARTBEAT_MS = 30_000;
const RELAY_POST_TIMEOUT_MS = 4_000;

export interface RelayRegistrationDeps {
  /** Operator's current technical-analytics consent. */
  getConsent: () => boolean;
  /** The analytics run the relay stamps on its own entries, while analytics is on. */
  getRunId: () => string | undefined;
}

/**
 * Best-effort relay bookkeeping for the host: the `POST /analytics-config`
 * consent broker and the periodic heartbeat that re-asserts it.
 */
export class RelayRegistration {
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: RelayRegistrationDeps) {}

  /**
   * Post the current consent to the relay's `/analytics-config` broker.
   * Best-effort: relay down / non-2xx is logged at debug and swallowed,
   * The heartbeat re-asserts this so a relay restart re-learns the real
   * value (the relay defaults to disabled until first post).
   */
  async postAnalyticsConfig(): Promise<void> {
    const url = `${relayBaseUrl()}/analytics-config`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RELAY_POST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: this.deps.getConsent(),
          runId: this.deps.getRunId(),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        debugPeer("host analytics-config POST non-ok", { status: res.status });
      }
    } catch (err) {
      debugPeer("host analytics-config POST failed", {
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Begin the periodic consent heartbeat. Idempotent: a second call while
   * the timer is live is a no-op. Cleared in `stopHeartbeat()`.
   */
  startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      void this.postAnalyticsConfig();
    }, HOST_HEARTBEAT_MS);
  }

  stopHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}
