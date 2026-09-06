import type {
  LostCommand,
  Transport,
  TransportStatus,
  UndeliveredCommand,
} from "@ksp-gonogo/sitrep-client";
import type { ClientMessage, ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import {
  COMMAND_LOST,
  COMMAND_UNDELIVERED,
  hydratePayload,
} from "@ksp-gonogo/sitrep-sdk";
import type { ConnStatus, PeerClientService } from "../peer/PeerClientService";

/**
 * Maps the station's PeerJS connection status onto the `Transport` status
 * vocabulary. `"idle"` (never attempted) and `"connecting"` both read as
 * `"reconnecting"`: from a `Transport` consumer's point of view neither is
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
 * WebSocket: the seam that lets a station mount an ordinary
 * `<SitrepTelemetryProvider transport={new PeerTransport(peerClientService)}>`
 * and get the exact same `TelemetryClient`/`TimelineStore`/`ViewClock`
 * pipeline the main screen uses, fed from `SitrepPeerRelay`'s forwarded
 * frames instead of a direct mod connection.
 *
 * Architecturally the closest sibling is `ReplayTransport`, not
 * `WebSocketTransport`: neither is the ORIGIN of the data, both are a
 * scheduled/event-driven re-delivery of `ServerMessage`s that arrived some
 * other way. Here that "some other way" is the host's own gated stream,
 * relayed verbatim over a PeerJS data channel; see
 * `docs/superpowers/plans/2026-07-12-station-stream-forwarding-plan.md` §5
 * for why relaying verbatim (no re-timestamping) is what keeps a station's
 * `ViewClock` fit to the identical `(validAt, deliveredAt)` observations the
 * host's own clock saw.
 *
 * `carriedChannels` is deliberately NOT implemented, the station doesn't
 * need to learn the carried set from the host at all, it imports the exact
 * same `DEFAULT_SITREP_CARRIED_TOPICS` constant the main screen does and
 * passes it as `<SitrepTelemetryProvider carriedChannels={...}>`'s explicit
 * prop. `predictConfirmEta` is also omitted: loss-inference for a station's
 * command dispatch would need the PeerJS round trip's own timing model
 * layered on top of the mod's courier model, not built for v1. What the
 * station gets instead is the host's own verdict, over `onLost`: the host
 * dispatched the command to the mod and its timer is the only one measuring
 * that leg.
 *
 * `subscribe`/`unsubscribe` go over the wire, so a station receives what its
 * own mounted widgets ask for rather than what the host happens to be reading.
 * The live set is re-sent in full on every transition into `"connected"`,
 * mirroring `WebSocketTransport` re-subscribing its topics on every socket
 * open: the host's claims are keyed to a `DataConnection` and die with it, and
 * `TelemetryClient` only sends `subscribe` on the 0->1 transition, so without
 * the replay a reconnected station would sit blank on every topic it had
 * already subscribed.
 *
 * `set-vantage` is refused rather than dropped, via `carriesVantage`. The mod
 * keeps `SelectedVantage` per `ClientSession` and the host has one session, so
 * two stations cannot observe at two vantages over one relayed stream. Dropping
 * the message alone was not enough: `TelemetryClient.setVantage` would still
 * change its own selection, leaving the vantage control naming a command centre
 * the data was not from, and would still re-subscribe every active topic, which
 * now reaches the host and churns its upstream subscriptions. Refusing at the
 * client keeps the control honest and the churn absent. Per-station observation
 * vantage needs a wire change and is separate work.
 *
 * Left unhandled, that gap means a command whose peer connection drops
 * mid-flight (or that is dispatched with no live `conn` at all:
 * `PeerClientService.sendSitrepCommand` silently no-ops when `conn` is null)
 * has NO loss timer and hangs `TelemetryClient.dispatch()`'s promise forever,
 * until the connection resumes or `TelemetryClient` is disposed. Rather than
 * build the full round-trip timing model, this class settles pending commands
 * itself on the two events that actually make a command unanswerable:
 *   - `send()` is called for a `command-request` while not `"connected"`,
 *     synthesizes an `error` on the next microtask (never inline; see the
 *     `StubTransport`/`WebSocketTransport` convention every `Transport`
 *     follows: a real transport never resolves in the same tick as the
 *     send).
 *   - the connection status transitions AWAY FROM `"connected"` while
 *     commands are still in flight, every tracked `requestId` gets an
 *     `error` immediately, since a dropped peer link can't be trusted to
 *     still deliver a response that was already in flight when it dropped.
 */
export class PeerTransport implements Transport {
  /**
   * A station's frames are relayed from a host session it does not own, and the
   * mod keeps `SelectedVantage` on that session. So a station cannot select a
   * vantage without moving every other station's observation with it.
   * Declaring it here makes `TelemetryClient` refuse the selection instead of
   * making one it cannot honour.
   */
  readonly carriesVantage = false;
  /**
   * A station cannot tell a served topic from an unserved one, so it must not
   * try. Its subscribe reaches the mod only when the HOST's own refcount makes
   * a 0 -> 1 transition, so a topic the host is already holding is never
   * re-acked, and every ack minted before this station connected is one it did
   * not see. Silence here is not evidence, and a false "nothing publishes this"
   * tells an author their correct code is broken.
   *
   * A station's reads therefore stay `pending`. Relaying the host's verdict
   * over the peer wire would make them decidable and is separate work.
   */
  readonly decidesTopicOwnership = false;
  private _status: TransportStatus;
  private readonly messageListeners = new Set<
    (message: ServerMessage) => void
  >();
  private readonly statusListeners = new Set<
    (status: TransportStatus) => void
  >();
  private readonly undeliveredListeners = new Set<
    (command: UndeliveredCommand) => void
  >();
  private readonly lostListeners = new Set<(command: LostCommand) => void>();
  private readonly unsubs: Array<() => void>;
  /** `requestId`s of sitrep commands sent but not yet settled (response/error/drop). */
  private readonly pendingCommandIds = new Set<string>();
  /** Topics with a live `subscribe` and no matching `unsubscribe`, re-sent on every fresh connection. */
  private readonly subscribedTopics = new Set<string>();

  constructor(private readonly client: PeerClientService) {
    this._status = toTransportStatus(client.getConnStatus());
    this.unsubs = [
      client.onSitrepFrame((message) => {
        // PeerJS serialises, and a `Value`'s methods live on its prototype so
        // that a quantity costs two fields on the wire. Only those two fields
        // survive the hop, so without this a station's readouts render fine
        // and every method call on one throws inside a component body, taking
        // the dashboard down through the error boundary. Hydrating here makes
        // a station's values indistinguishable from a host's, which is the
        // whole promise of the station being the same app.
        if (message.type === "stream-data") {
          hydratePayload(message.payload);
        }
        this.deliver(message);
      }),
      client.onSitrepCommandResponse((requestId, result, meta) => {
        this.pendingCommandIds.delete(requestId);
        this.deliver({ type: "command-response", requestId, result, meta });
      }),
      client.onSitrepCommandError((requestId, code, message) => {
        this.pendingCommandIds.delete(requestId);
        /*
         * The host's own transport gave up while this station's command was
         * still in its queue, so the command never left the HOST either.
         * Routed off the error channel deliberately: relayed as an `error` it
         * would reach a station that had already called the command `lost` as
         * proof the mod received it, which is the opposite of what happened.
         * See `Transport.onUndelivered`.
         */
        if (code === COMMAND_UNDELIVERED) {
          for (const listener of this.undeliveredListeners) {
            listener({ requestId, reason: message });
          }
          return;
        }
        /*
         * The host's own loss timer ran out on this station's command. That is
         * the host reporting IGNORANCE, not an answer: the mod may have run the
         * command and may never have seen it.
         *
         * Off the error channel for the same reason the undelivered branch
         * above is, and onto a different one, because the two say different
         * things. `undelivered` claims the command never left the machine, and
         * a host that merely stopped waiting makes no such claim. Relayed as an
         * `error` it would reach a station that had already called the command
         * lost as proof the mod received it: the host says "I do not know" and
         * the operator is told "it ran".
         */
        if (code === COMMAND_LOST) {
          for (const listener of this.lostListeners) {
            listener({ requestId, reason: message });
          }
          return;
        }
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
      this.client.sendSitrepCommand(
        requestId,
        message.command,
        message.args,
        message.label,
        message.topic,
        message.vantage,
      );
      return;
    }
    if (message.type === "subscribe") {
      this.subscribedTopics.add(message.topic);
      this.client.sendSitrepSubscribe(message.topic);
      return;
    }
    if (message.type === "unsubscribe") {
      this.subscribedTopics.delete(message.topic);
      this.client.sendSitrepUnsubscribe(message.topic);
      return;
    }
    // set-vantage: unreachable in practice, since `carriesVantage: false` makes
    // `TelemetryClient.setVantage` refuse before it sends. Left as a no-op
    // rather than a throw so a direct `send` from a test or a future caller
    // degrades the same way it always did.
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatusChange(listener: (status: TransportStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /**
   * See `Transport.onUndelivered`. This transport strands nothing of its own (a
   * command pressed with no peer link is refused at the press), so the only
   * thing reported here is what the HOST could not send: its own queue, given
   * up on, relayed as `E_UNDELIVERED`.
   */
  onUndelivered(listener: (command: UndeliveredCommand) => void): () => void {
    this.undeliveredListeners.add(listener);
    return () => this.undeliveredListeners.delete(listener);
  }

  /**
   * See `Transport.onLost`. A station's command is dispatched to the mod by the
   * host, so the host's loss timer is the only one timing that leg, and this is
   * the channel its verdict arrives on.
   */
  onLost(listener: (command: LostCommand) => void): () => void {
    this.lostListeners.add(listener);
    return () => this.lostListeners.delete(listener);
  }

  /** Detach from `PeerClientService` and drop all listeners. Idempotent-safe (unsubs are themselves idempotent). */
  dispose(): void {
    for (const unsub of this.unsubs) unsub();
    this.messageListeners.clear();
    this.statusListeners.clear();
    this.undeliveredListeners.clear();
    this.lostListeners.clear();
    this.pendingCommandIds.clear();
    this.subscribedTopics.clear();
  }

  private setStatus(status: TransportStatus): void {
    if (this._status === status) return;
    const wasConnected = this._status === "connected";
    this._status = status;
    for (const listener of this.statusListeners) listener(status);

    // A fresh connection is a fresh set of host-side claims: the host keys them
    // to the `DataConnection` that has just been replaced. `TelemetryClient`
    // will not re-send, since from its side nothing has unsubscribed, so replay
    // the live set here.
    if (!wasConnected && status === "connected") {
      for (const topic of this.subscribedTopics) {
        this.client.sendSitrepSubscribe(topic);
      }
    }

    // The link just dropped (or started reconnecting) while commands were
    // still in flight: none of them can be trusted to still arrive, and
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
        // receiving the message: same isolation contract as every other
        // `Transport` implementation (`WebSocketTransport`/`ReplayTransport`/
        // `StubTransport`).
        console.error("PeerTransport: message listener threw", error);
      }
    }
  }
}
