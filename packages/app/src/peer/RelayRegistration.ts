import { debugPeer } from "@gonogo/logger";
import { relayBaseUrl } from "./iceServers";

/** Heartbeat cadence for re-registering the share-code → peer-id mapping.
 *  Well within the relay's ~90s TTL so a single missed beat doesn't expire
 *  the entry. */
const HOST_HEARTBEAT_MS = 30_000;
const RELAY_POST_TIMEOUT_MS = 4_000;

export interface RelayRegistrationDeps {
  /** Host's stable operator-facing share-code. */
  getShareCode: () => string;
  /** Host's current broker peer id, or null before the broker `open`. */
  getPeerId: () => string | null;
  /** Operator's current technical-analytics consent. */
  getConsent: () => boolean;
  /** Fired whenever the relay-registered state flips. Idempotent on
   *  no-change (the unit dedups before calling). */
  onRegisteredChange: (registered: boolean) => void;
}

/**
 * Best-effort relay bookkeeping for the host: the `POST /host`
 * share-code → peer-id registration (diagnostics only under the
 * stable-host-id model), the `POST /analytics-config` consent broker, and
 * the periodic heartbeat that re-asserts both so a relay restart re-learns
 * the current state within one beat.
 *
 * Extracted from `PeerHostService` verbatim — same timeouts, same cadence,
 * same best-effort swallow-and-log behaviour. The service keeps the public
 * `relayRegistered` field and updates it from `onRegisteredChange`; this
 * unit owns the heartbeat timer and drives the two POSTs.
 */
export class RelayRegistration {
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: RelayRegistrationDeps) {}

  /**
   * POST the current `{ shareCode, peerId }` to the relay's host registry.
   * DIAGNOSTICS ONLY under the stable-host-id model — discovery no longer
   * depends on this (stations derive the broker id from the share code).
   * Best-effort: any failure (relay down, timeout, non-2xx) is logged at
   * debug and swallowed. No-op until the Peer has an id.
   */
  async register(): Promise<void> {
    const peerId = this.deps.getPeerId();
    if (!peerId) return;
    const shareCode = this.deps.getShareCode();
    const url = `${relayBaseUrl()}/host`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RELAY_POST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shareCode, peerId }),
        signal: controller.signal,
      });
      if (!res.ok) {
        debugPeer("host relay register non-ok", {
          status: res.status,
          shareCode,
        });
        this.deps.onRegisteredChange(false);
        return;
      }
      debugPeer("host registered with relay", {
        shareCode,
        peerId,
      });
      this.deps.onRegisteredChange(true);
    } catch (err) {
      // Relay unreachable is the common, expected case (no relay deployed,
      // local-only dev). Keep it at debug so it doesn't spam the ring buffer.
      debugPeer("host relay register failed", {
        message: err instanceof Error ? err.message : String(err),
      });
      this.deps.onRegisteredChange(false);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * POST the current consent to the relay's `/analytics-config` broker.
   * Best-effort: relay down / non-2xx is logged at debug and swallowed,
   * exactly like the host-registry POST. The heartbeat re-asserts this so
   * a relay restart re-learns the real value (the relay defaults to
   * disabled until first POST).
   */
  async postAnalyticsConfig(): Promise<void> {
    const url = `${relayBaseUrl()}/analytics-config`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RELAY_POST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: this.deps.getConsent() }),
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
   * Begin the periodic relay heartbeat so the share-code → peer-id mapping
   * doesn't expire (relay TTL ~90s). Idempotent — a second call while the
   * timer is live is a no-op. Cleared in `stopHeartbeat()`.
   */
  startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      void this.register();
      // Re-assert analytics consent on the same cadence so a relay restart
      // (which resets its in-memory config to disabled) re-learns the real
      // value within one heartbeat.
      void this.postAnalyticsConfig();
    }, HOST_HEARTBEAT_MS);
  }

  stopHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}
