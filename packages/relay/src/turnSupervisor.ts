import type { CoturnHandle } from "./coturnManager.js";

/** How long the relay waits between attempts to discover its public IP. */
export const DISCOVERY_RETRY_MS = 60_000;

export interface TurnSupervisorOptions {
  /** Resolve the address coturn advertises; rejects when it cannot be found. */
  discover: () => Promise<string>;
  /** Start coturn on that address. `onExit` must be called if it later stops serving. */
  start: (externalIp: string, onExit: (reason: string) => void) => CoturnHandle;
  /** Called when coturn cannot be started or dies after starting: the process should exit. */
  onFatal: (reason: string) => void;
  /** Called with each failed discovery, for the log. */
  onDiscoveryFailed?: (err: unknown) => void;
  retryMs?: number;
}

/**
 * Brings coturn up and keeps the relay's other routes independent of it.
 * Without a public IP (no internet, no pinned address) coturn cannot start,
 * but a LAN does not need it, so the relay stays up, reports why the relay server is
 * unavailable and retries discovery every `retryMs`. A coturn that fails to
 * spawn or stops after running is fatal: only a restart fixes a missing
 * binary or a taken port.
 */
export class TurnSupervisor {
  handle: CoturnHandle | null = null;
  /** Why the relay server is not up yet, or null once it is running (or has been given up on). */
  pendingReason: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(private readonly opts: TurnSupervisorOptions) {}

  async begin(): Promise<void> {
    if (this.stopped) return;
    let externalIp: string;
    try {
      externalIp = await this.opts.discover();
    } catch (err) {
      this.opts.onDiscoveryFailed?.(err);
      this.pendingReason =
        "public IP not discovered; set TURN_EXTERNAL_IP or restore internet access";
      const retryMs = this.opts.retryMs ?? DISCOVERY_RETRY_MS;
      this.timer = setTimeout(() => void this.begin(), retryMs);
      this.timer.unref?.();
      return;
    }
    if (this.stopped) return;
    try {
      this.handle = this.opts.start(externalIp, this.opts.onFatal);
      this.pendingReason = null;
    } catch (err) {
      this.pendingReason = null;
      this.opts.onFatal(
        `coturn could not start: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.handle?.stop();
  }
}
