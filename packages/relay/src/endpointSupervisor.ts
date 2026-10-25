/** How long the relay waits between attempts to discover its public IP. */
export const DISCOVERY_RETRY_MS = 60_000;

import type { EndpointHandle } from "./endpointManager.js";

/** What `pendingReason` says while no public IP has been found. */
export const UNDISCOVERED =
  "public IP not discovered; set PUBLIC_IP or restore internet access";

export interface EndpointSupervisorOptions {
  /** Resolve the address the endpoint advertises; rejects when it cannot be found. */
  discover: () => Promise<string>;
  /** Start the endpoint on that address. `onExit` must be called if it later stops serving. */
  start: (publicIp: string, onExit: (reason: string) => void) => EndpointHandle;
  /** Called when the endpoint cannot be started or dies after starting: the process should exit. */
  onFatal: (reason: string) => void;
  /** Called with each failed discovery, for the log. */
  onDiscoveryFailed?: (err: unknown) => void;
  retryMs?: number;
}

/**
 * Brings up the station endpoint, which advertises the relay's public address,
 * and keeps the relay's other routes independent of it. Without a public IP (no
 * internet, no pinned address) the endpoint cannot start, but a LAN does not
 * need it, so the relay stays up, reports why the endpoint is unavailable and
 * retries discovery every `retryMs`. An endpoint that fails to spawn or stops
 * after running is fatal: only a restart fixes a missing binary or a taken
 * port.
 */
export class EndpointSupervisor {
  handle: EndpointHandle | null = null;
  /** Why the endpoint is not up yet, or null once it is running (or has been given up on). */
  pendingReason: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(private readonly opts: EndpointSupervisorOptions) {}

  async begin(): Promise<void> {
    if (this.stopped) return;
    let publicIp: string;
    try {
      publicIp = await this.opts.discover();
    } catch (err) {
      this.opts.onDiscoveryFailed?.(err);
      this.pendingReason = UNDISCOVERED;
      const retryMs = this.opts.retryMs ?? DISCOVERY_RETRY_MS;
      this.timer = setTimeout(() => void this.begin(), retryMs);
      this.timer.unref?.();
      return;
    }
    if (this.stopped) return;
    try {
      this.handle = this.opts.start(publicIp, this.opts.onFatal);
      this.pendingReason = null;
    } catch (err) {
      this.pendingReason = null;
      this.opts.onFatal(
        `endpoint could not start: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.handle?.stop();
  }
}
