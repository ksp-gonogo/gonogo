import { debugPeer, logger } from "@gonogo/logger";

/**
 * Longer retry gap when the broker reports our station peer id is still
 * held. The broker's id TTL is on the order of 30–60 s, so a short
 * 2 s loop just generates noise. 8 s keeps the log usable without
 * missing the window when the broker finally releases the id.
 */
const UNAVAILABLE_ID_RETRY_MS = 8_000;

/** PeerJS error shape — `.type` is the one load-bearing field we read. */
interface PeerJsError extends Error {
  type?: string;
}

function isPeerJsError(e: unknown): e is PeerJsError {
  return e instanceof Error && typeof (e as PeerJsError).type === "string";
}

export interface RetryPolicyDeps {
  /** Default retry interval, used when no error-type override is in play. */
  retryIntervalMs: number;
  /** Total wall-clock window after which the policy gives up. */
  retryTimeoutMs: number;

  /** Tear down the current Peer + DataConnection — called before a retry. */
  tearDown(): void;
  /** Reject any pending request/response promises with `reason`. */
  rejectPending(reason: string): void;
  /** Push a connection-status update upstream. */
  emitStatus(status: "reconnecting" | "disconnected"): void;
  /** Open a fresh Peer (and DataConnection) — called when the retry timer fires. */
  reopen(): void;

  /** Identifier used in the "id still held by broker" warning log.
   *  Function so callers can hand in a current value — `PeerClientService`
   *  re-rolls the id every retry, and a captured snapshot would log
   *  whichever id we started with. */
  stationPeerId: () => string;
  /** Currently-targeted host id, used in "host unavailable" log. */
  hostPeerId(): string | null;
}

/**
 * Owns the reconnect state machine + duplicate-error-log dedup for
 * `PeerClientService`. Holds the retry timer and the "first time we saw
 * this PeerJS error type" memo so a sustained `unavailable-id` condition
 * doesn't flood the console on every loop.
 */
export class RetryPolicy {
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryStart: number | null = null;
  private intentionalDisconnect = false;
  /** Last observed PeerJS error-type string — suppresses duplicate noisy
   *  logs when the same condition (e.g. `unavailable-id`) persists across
   *  retries. */
  private lastErrorType: string | null = null;
  /** ms override applied to the next retry. Set by error-type-specific
   *  handling; cleared back to `retryIntervalMs` after one use. */
  private nextRetryOverrideMs: number | null = null;

  constructor(private readonly deps: RetryPolicyDeps) {}

  /** Reset transient state when the consumer kicks off a fresh connect cycle. */
  beginConnect(): void {
    this.intentionalDisconnect = false;
    this.retryStart = null;
  }

  /** Mark a successful conn open so future retries get a fresh time budget. */
  onConnected(): void {
    this.retryStart = null;
    this.lastErrorType = null;
  }

  /**
   * Classify the PeerJS error, log meaningfully (deduplicated per
   * error-type so sustained conditions like "unavailable-id" emit one
   * line rather than flooding the console on every retry), then defer
   * to `handleUnexpectedClose` to schedule the next attempt.
   */
  handlePeerError(err: unknown): void {
    const type = isPeerJsError(err) ? (err.type ?? null) : null;
    const repeat = type !== null && type === this.lastErrorType;

    if (!repeat) {
      if (type === "unavailable-id") {
        logger.warn(
          `[PeerClient] station peer id is still held by the broker — retrying slowly until it releases`,
          { stationPeerId: this.deps.stationPeerId() },
        );
      } else if (type === "peer-unavailable") {
        logger.info(
          `[PeerClient] host ${this.deps.hostPeerId()} unavailable — will retry`,
        );
      } else {
        logger.error(
          "[PeerClient] peer error",
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    } else {
      debugPeer("PeerClient repeat error", {
        type,
        message: err instanceof Error ? err.message : String(err),
      });
    }

    if (type === "unavailable-id") {
      this.nextRetryOverrideMs = UNAVAILABLE_ID_RETRY_MS;
    }
    this.lastErrorType = type;
    this.handleUnexpectedClose();
  }

  /**
   * Schedule the next retry attempt unless we've intentionally disconnected
   * or already given up. Idempotent — a second call while a retry is
   * already pending is a no-op.
   */
  handleUnexpectedClose(): void {
    if (this.intentionalDisconnect) return;
    if (this.retryTimer !== null) return;

    this.deps.tearDown();
    this.deps.rejectPending("peer connection closed");

    if (this.retryStart === null) this.retryStart = Date.now();
    if (Date.now() - this.retryStart >= this.deps.retryTimeoutMs) {
      logger.warn("[PeerClient] giving up on reconnect");
      this.retryStart = null;
      this.lastErrorType = null;
      this.nextRetryOverrideMs = null;
      this.deps.emitStatus("disconnected");
      return;
    }

    this.deps.emitStatus("reconnecting");
    const delay = this.nextRetryOverrideMs ?? this.deps.retryIntervalMs;
    this.nextRetryOverrideMs = null;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.deps.reopen();
    }, delay);
  }

  /**
   * Stop any pending retry; a subsequent `handleUnexpectedClose` will be
   * suppressed until `beginConnect` is called again.
   */
  cancel(): void {
    this.intentionalDisconnect = true;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
}
