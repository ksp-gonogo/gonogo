import type { Transport, TransportStatus } from "@ksp-gonogo/sitrep-client";
import type { ClientMessage, ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import type { ConnStatus, PeerClientService } from "../peer/PeerClientService";

/**
 * Maps the station's PeerJS connection status onto the `Transport` status
 * vocabulary. `"idle"` (never attempted) and `"connecting"` both read as
 * `"reconnecting"` — from a `Transport` consumer's point of view neither is
 * a hard failure, both are "not yet delivering frames but expected to be
 * soon", the same posture `WebSocketTransport` reports while its retry loop
 * is running.
 */
function toTransportStatus(status: ConnStatus): TransportStatus {
  switch (status) {
    case "connected":
      return "connected";
    case "disconnected":
      return "disconnected";
    case "idle":
    case "connecting":
    case "reconnecting":
      return "reconnecting";
  }
}

/**
 * A `Transport` (`@ksp-gonogo/sitrep-client`) fed by PeerJS instead of a live
 * WebSocket — the seam that lets a station mount an ordinary
 * `<SitrepTelemetryProvider transport={new PeerTransport(peerClientService)}>`
 * and get the exact same `TelemetryClient`/`TimelineStore`/`ViewClock`
 * pipeline the main screen uses, fed from `SitrepPeerRelay`'s forwarded
 * frames instead of a direct mod connection.
 *
 * Architecturally the closest sibling is `ReplayTransport`, not
 * `WebSocketTransport`: neither is the ORIGIN of the data, both are a
 * scheduled/event-driven re-delivery of `ServerMessage`s that arrived some
 * other way. Here that "some other way" is the host's own gated stream,
 * relayed verbatim over a PeerJS data channel — see
 * `docs/superpowers/plans/2026-07-12-station-stream-forwarding-plan.md` §5
 * for why relaying verbatim (no re-timestamping) is what keeps a station's
 * `ViewClock` fit to the identical `(validAt, deliveredAt)` observations the
 * host's own clock saw.
 *
 * `carriedChannels` is deliberately NOT implemented — the station doesn't
 * need to learn the carried set from the host at all, it imports the exact
 * same `DEFAULT_SITREP_CARRIED_TOPICS` constant the main screen does and
 * passes it as `<SitrepTelemetryProvider carriedChannels={...}>`'s explicit
 * prop. `predictConfirmEta` is also omitted: loss-inference for a station's
 * command dispatch would need the PeerJS round trip's own timing model
 * layered on top of the mod's courier model, not built for v1.
 *
 * That gap used to mean a command whose peer connection dropped mid-flight
 * (or that was dispatched with no live `conn` at all —
 * `PeerClientService.sendSitrepCommand` silently no-ops when `conn` is
 * null) had NO loss timer and hung `TelemetryClient.dispatch()`'s promise
 * forever, until the connection resumed or `TelemetryClient` was disposed
 * (see this class's own risk note in the station-forwarding plan
 * §"Risks"). Rather than build the full round-trip timing model, this class
 * settles pending commands itself on the two events that actually make a
 * command unanswerable:
 *   - `send()` is called for a `command-request` while not `"connected"` —
 *     synthesizes an `error` on the next microtask (never inline — see the
 *     `StubTransport`/`WebSocketTransport` convention every `Transport`
 *     follows: a real transport never resolves in the same tick as the
 *     send).
 *   - the connection status transitions AWAY FROM `"connected"` while
 *     commands are still in flight — every tracked `requestId` gets an
 *     `error` immediately, since a dropped peer link can't be trusted to
 *     still deliver a response that was already in flight when it dropped.
 */
export class PeerTransport implements Transport {
  private _status: TransportStatus;
  private readonly messageListeners = new Set<
    (message: ServerMessage) => void
  >();
  private readonly statusListeners = new Set<
    (status: TransportStatus) => void
  >();
  private readonly unsubs: Array<() => void>;
  /** `requestId`s of sitrep commands sent but not yet settled (response/error/drop). */
  private readonly pendingCommandIds = new Set<string>();

  constructor(private readonly client: PeerClientService) {
    this._status = toTransportStatus(client.getConnStatus());
    this.unsubs = [
      client.onSitrepFrame((message) => this.deliver(message)),
      client.onSitrepCommandResponse((requestId, result, meta) => {
        this.pendingCommandIds.delete(requestId);
        this.deliver({ type: "command-response", requestId, result, meta });
      }),
      client.onSitrepCommandError((requestId, code, message) => {
        this.pendingCommandIds.delete(requestId);
        this.deliver({ type: "error", requestId, code, message });
      }),
      client.onConnectionStatus((status) => {
        this.setStatus(toTransportStatus(status));
      }),
    ];
  }

  get status(): TransportStatus {
    return this._status;
  }

  send(message: ClientMessage): void {
    if (message.type === "command-request") {
      const { requestId } = message;
      if (this._status !== "connected") {
        // No live peer link to carry this over. Left alone, this would
        // silently vanish (`PeerClientService.sendSitrepCommand` no-ops on a
        // null `conn`) and strand `TelemetryClient.dispatch()`'s promise
        // forever, since this transport has no `predictConfirmEta` to arm a
        // loss timer. Fail fast instead, on a later tick so it never settles
        // synchronously within the caller's own `dispatch()` call.
        queueMicrotask(() =>
          this.deliver({
            type: "error",
            requestId,
            code: "E_PEER_DISCONNECTED",
            message: "no active peer connection to the host",
          }),
        );
        return;
      }
      this.pendingCommandIds.add(requestId);
      this.client.sendSitrepCommand(requestId, message.command, message.args);
      return;
    }
    // subscribe/unsubscribe: no-op on the wire. `SitrepPeerRelay` already
    // carries the full static `DEFAULT_SITREP_CARRIED_TOPICS` allowlist
    // unconditionally to every connected station once at least one is
    // connected — there's nothing to request yet. A real
    // sitrep-subscribe/unsubscribe pair (ref-counted host-side, mirroring
    // `retainPeerDrivenSub`) is the v2 bandwidth-headroom follow-up, not a
    // correctness requirement for v1 — see the plan's §2.
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatusChange(listener: (status: TransportStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Detach from `PeerClientService` and drop all listeners. Idempotent-safe (unsubs are themselves idempotent). */
  dispose(): void {
    for (const unsub of this.unsubs) unsub();
    this.messageListeners.clear();
    this.statusListeners.clear();
    this.pendingCommandIds.clear();
  }

  private setStatus(status: TransportStatus): void {
    if (this._status === status) return;
    const wasConnected = this._status === "connected";
    this._status = status;
    for (const listener of this.statusListeners) listener(status);

    // The link just dropped (or started reconnecting) while commands were
    // still in flight — none of them can be trusted to still arrive, and
    // with no `predictConfirmEta` there is no loss timer to eventually catch
    // this on its own. Settle every one of them now instead of leaving
    // `TelemetryClient.dispatch()`'s promise pending forever.
    if (
      wasConnected &&
      status !== "connected" &&
      this.pendingCommandIds.size > 0
    ) {
      const dropped = [...this.pendingCommandIds];
      this.pendingCommandIds.clear();
      for (const requestId of dropped) {
        this.deliver({
          type: "error",
          requestId,
          code: "E_PEER_DISCONNECTED",
          message: "peer connection dropped mid-flight",
        });
      }
    }
  }

  private deliver(message: ServerMessage): void {
    for (const listener of this.messageListeners) {
      try {
        listener(message);
      } catch (error) {
        // A throwing listener must not prevent sibling listeners from
        // receiving the message — same isolation contract as every other
        // `Transport` implementation (`WebSocketTransport`/`ReplayTransport`/
        // `StubTransport`).
        console.error("PeerTransport: message listener threw", error);
      }
    }
  }
}
