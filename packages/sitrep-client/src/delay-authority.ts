import { type CommsDelay, CommsDelaySource } from "@ksp-gonogo/sitrep-sdk";

/**
 * The `comms.delay` channel topic — the CORE `SignalDelay` capability's
 * output (`mod/Gonogo.KSP/CommsCoreUplink.cs:DelayTopic`,
 * `mod/Sitrep.Host/ChannelEngine.cs:CommsDelayTopic`). It is a `TrueNow`
 * channel: the server never delays the value that DEFINES the delay, so the
 * SDK reads it un-gated and can trust it as the current one-way light-time.
 */
export const COMMS_DELAY_TOPIC = "comms.delay";

/** The minimal client surface `DelayAuthority` needs — just topic subscription. */
export interface DelaySubscribable {
  subscribe(topic: string, cb: (payload: unknown) => void): () => void;
}

/**
 * Extract the one-way delay (seconds) from a `comms.delay` payload, honoring
 * the contract's typed-absence rule
 * (`mod/Sitrep.Contract/Comms.cs:CommsDelay`): `CommsDelaySource.None` means
 * "no delay authority" and MUST read as 0 — never mistaken for a measured
 * zero-distance delay. Anything malformed / non-finite / negative also reads
 * as 0 (fail-safe to LAN-identical passthrough rather than fabricating a
 * horizon offset).
 */
function readOneWaySeconds(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0;
  const delay = payload as Partial<CommsDelay>;
  if (delay.source === CommsDelaySource.None) return 0;
  const seconds = delay.oneWaySeconds;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    return 0;
  }
  return seconds;
}

/**
 * The client-side delay authority (streaming-delay spec §7.3 Step 4). Holds
 * the latest `comms.delay.oneWaySeconds` off the wire and exposes it as a
 * `delaySeconds()` accessor wired into the ONE `ViewClock`
 * (`ViewClockOptions.delaySeconds`).
 *
 * **This is legibility, NOT enforcement.** The mod's reveal gate
 * (`ChannelEngine`, spec §4.0) has already withheld each channel's samples
 * until `UT <= now - delay`, so the raw timeline the client receives is
 * already delayed — for the SDK, a curl script, or a station relay alike.
 * This value does not re-gate anything; it only sizes the SDK's
 * PREDICT-FORWARD horizon: how far `utNowEstimate()` leads `confirmedEdgeUt()`
 * so a delayed vessel can be dead-reckoned to the predicted present and the
 * certainty-horizon snap is drawn in the right place (spec §3.3). Because
 * media (kerbcast `DelayedPlayoutBuffer`) reads the same clock, aligning this
 * one value aligns telemetry and video for free (spec §5.3).
 *
 * `comms.delay` is itself a `TrueNow` channel (it defines the delay, so it is
 * never gated by it) — the authority can trust the value it reads as current.
 */
export class DelayAuthority {
  private oneWaySeconds = 0;

  /**
   * Feed one `comms.delay` payload. `CommsDelaySource.None` (or a malformed
   * payload) resets to 0 — LAN-identical passthrough, byte-for-byte, since a
   * 0 delay makes `confirmedEdgeUt()` collapse onto `utNowEstimate()`.
   */
  observe(payload: unknown): void {
    this.oneWaySeconds = readOneWaySeconds(payload);
  }

  /**
   * The current one-way delay in seconds. Pass `authority.delaySeconds` (bound
   * below) straight into `ViewClockOptions.delaySeconds`. Bound as an arrow
   * field so the identity is stable across renders and `this` is preserved
   * when handed off as a bare function reference.
   */
  delaySeconds = (): number => this.oneWaySeconds;

  /**
   * Subscribe to `comms.delay` on `client`, keeping `delaySeconds()` current.
   * `TelemetryClient.subscribe` replays its sticky last value immediately, so
   * a late-attaching authority still learns the current delay on the next
   * delivery — no full-cycle wait. Returns the unsubscribe function.
   */
  attach(client: DelaySubscribable): () => void {
    return client.subscribe(COMMS_DELAY_TOPIC, (payload) =>
      this.observe(payload),
    );
  }
}
