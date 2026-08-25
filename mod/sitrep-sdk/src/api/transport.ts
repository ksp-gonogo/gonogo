import type { ClientMessage, ServerMessage } from "../envelope";

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
 * boundary. Real implementations (WebSocket, PeerJS) are added over time,
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
   * transport expects its confirmation to arrive by, or `undefined` if the
   * transport doesn't model network delay at all.
   *
   * This is a *prediction*, not a commitment: the client never computes
   * delay itself, it only consumes whatever the transport hands back here
   * to size its own loss-inference timeout (see `TelemetryClient.dispatch`).
   * `StubTransport` (zero simulated latency) omits this method entirely,
   * `eta` comes back `undefined` and the client never starts a loss timer
   * for it. `CourierTransport` implements it using the courier's own
   * round-trip model.
   */
  /**
   * Predict when a just-dispatched command's confirmation is due, in the `Clock`'s UT
   * domain. **Only for a transport that OWNS its delay model.**
   *
   * `CourierTransport` is that case: it drives the courier's own delay engine and runs
   * without a `TelemetryProvider`, so nothing else can know the round trip.
   *
   * A transport riding the mod's SERVER-ENFORCED delay must NOT implement this.
   * `comms.delay` already carries that number and `DelayAuthority` already holds it
   * live, so `TelemetryClient` falls back to the authority (`setDelaySource`) whenever
   * this is absent. Implementing it here as well would re-derive a value another layer
   * owns, and two estimates of one delay is how they start disagreeing.
   *
   * Note the client prefers THIS over the authority when both are available, because a
   * transport that owns its delay model knows better than a generic authority whose
   * fail-safe is zero. So implementing it on a server-delayed transport would not merely
   * duplicate the authority, it would OVERRIDE it. `WebSocketTransport` deliberately
   * does not implement it, and that is not an omission to fix.
   */
  predictConfirmEta?(): number | undefined;

  /**
   * OPTIONAL: the topics this transport actually delivers `stream-data` for,
   * the carried-channels allowlist gate's transport-side seed (see
   * `./carried-channels.ts`).
   * `TelemetryClient.declaredChannels` reads this straight through;
   * `TelemetryProvider` unions it with its own explicit `carriedChannels`
   * promotion-list prop to build the allowlist `useDataValue`'s shim
   * consults before ever routing a mapped topic to the stream.
   *
   * Omitted (`undefined`) means "this transport doesn't declare", e.g.
   * `StubTransport`, which is test-scriptable and can `emit` on any topic a
   * test subscribes to regardless of any real serving guarantee; a caller
   * wanting a stub-driven topic carried must promote it explicitly via
   * `TelemetryProvider`'s `carriedChannels` prop. `ReplayTransport` DOES
   * declare: its value is exactly the fixture's topic set, since that's the
   * complete, known-in-advance set of topics it can ever deliver.
   */
  readonly carriedChannels?: readonly string[];

  /**
   * OPTIONAL: whether this transport can carry a vantage selection at all.
   * Absent means yes, which is right for every transport that owns its own
   * session with the mod.
   *
   * `PeerTransport` is the one that cannot. The mod keeps `SelectedVantage` on
   * the `ClientSession` and a host has exactly one session, so a station
   * selecting a vantage would move every other station's observation with it.
   * Declaring `false` here makes `TelemetryClient.setVantage` refuse rather
   * than change its own selection and re-subscribe every topic against a
   * request the wire will never carry, which would leave the client claiming a
   * vantage its data is not from.
   */
  readonly carriesVantage?: boolean;
}
