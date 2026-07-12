import type { ClientMessage, ServerMessage } from "@ksp-gonogo/sitrep-sdk";

/** Connection status of a Transport's underlying pipe. */
export type TransportStatus =
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "error";

/**
 * A dumb typed message pipe between the app and a telemetry source.
 *
 * Transports know nothing about topics, subscriptions, or commands beyond
 * routing the SDK's wire messages; all of that semantics lives above this
 * boundary. Real implementations (WebSocket, PeerJS) are added over time —
 * this interface is what they (and `StubTransport`) implement.
 */
export interface Transport {
  /** Current connection status. */
  readonly status: TransportStatus;

  /** Send a client -> server message (subscribe/unsubscribe/command-request). */
  send(message: ClientMessage): void;

  /** Register a listener for inbound server -> client messages. Returns an unsubscribe function. */
  onMessage(listener: (message: ServerMessage) => void): () => void;

  /** Register a listener for status changes. Returns an unsubscribe function. */
  onStatusChange(listener: (status: TransportStatus) => void): () => void;

  /**
   * OPTIONAL: if a command were dispatched right now, the absolute UT this
   * transport expects its confirmation to arrive by — or `undefined` if the
   * transport doesn't model network delay at all.
   *
   * This is a *prediction*, not a commitment: the client never computes
   * delay itself, it only consumes whatever the transport hands back here
   * to size its own loss-inference timeout (see `TelemetryClient.dispatch`).
   * `StubTransport` (zero simulated latency) omits this method entirely
   * — `eta` comes back `undefined` and the client never starts a loss timer
   * for it. `CourierTransport` implements it using the courier's own
   * round-trip model.
   */
  predictConfirmEta?(): number | undefined;

  /**
   * OPTIONAL: the topics this transport actually delivers `stream-data` for
   * — the carried-channels allowlist gate's transport-side seed (see
   * `./carried-channels.ts`).
   * `TelemetryClient.declaredChannels` reads this straight through;
   * `TelemetryProvider` unions it with its own explicit `carriedChannels`
   * promotion-list prop to build the allowlist `useDataValue`'s shim
   * consults before ever routing a mapped topic to the stream.
   *
   * Omitted (`undefined`) means "this transport doesn't declare" — e.g.
   * `StubTransport`, which is test-scriptable and can `emit` on any topic a
   * test subscribes to regardless of any real serving guarantee; a caller
   * wanting a stub-driven topic carried must promote it explicitly via
   * `TelemetryProvider`'s `carriedChannels` prop. `ReplayTransport` DOES
   * declare — its value is exactly the fixture's topic set, since that's the
   * complete, known-in-advance set of topics it can ever deliver.
   */
  readonly carriedChannels?: readonly string[];
}
