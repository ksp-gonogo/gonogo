/** How long the relay waits between attempts to discover its public IP. */
export const DISCOVERY_RETRY_MS = 60_000;

export interface PublicServiceSupervisorOptions<H> {
  /** The service's name in the relay's messages, such as "endpoint". */
  name: string;
  /** Resolve the address the service advertises; rejects when it cannot be found. */
  discover: () => Promise<string>;
  /** Start the service on that address. `onExit` must be called if it later stops serving. */
  start: (publicIp: string, onExit: (reason: string) => void) => H;
  /** Called when the service cannot be started or dies after starting: the process should exit. */
  onFatal: (reason: string) => void;
  /** Called with each failed discovery, for the log. */
  onDiscoveryFailed?: (err: unknown) => void;
  /** What `pendingReason` says while no public IP has been found. */
  undiscoveredReason: string;
  retryMs?: number;
}

/**
 * Brings up a child service that advertises the relay's public address, and
 * keeps the relay's other routes independent of it. Without a public IP (no
 * internet, no pinned address) the service cannot start, but a LAN does not
 * need it, so the relay stays up, reports why the service is unavailable and
 * retries discovery every `retryMs`. A service that fails to spawn or stops
 * after running is fatal: only a restart fixes a missing binary or a taken
 * port.
 */
export class PublicServiceSupervisor<H extends { stop(): Promise<void> }> {
  handle: H | null = null;
  /** Why the service is not up yet, or null once it is running (or has been given up on). */
  pendingReason: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(private readonly opts: PublicServiceSupervisorOptions<H>) {}

  async begin(): Promise<void> {
    if (this.stopped) return;
    let publicIp: string;
    try {
      publicIp = await this.opts.discover();
    } catch (err) {
      this.opts.onDiscoveryFailed?.(err);
      this.pendingReason = this.opts.undiscoveredReason;
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
        `${this.opts.name} could not start: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.handle?.stop();
  }
}
