import type { ClientMessage, ServerMessage } from "../envelope";

/** Connection status of a Transport's underlying pipe. */
export type TransportStatus =
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "error";

/**
 * One command-request a transport accepted and can now never deliver.
 *
 * The `reason` is the transport's own words, kept out of the wire's `error`
 * frame vocabulary deliberately: this never reached a server, so no server
 * code applies to it.
 */
export interface UndeliveredCommand {
  /** The dispatch's own `requestId`, as it was handed to `send`. */
  requestId: string;
  /** Why it will never go, in a sentence a surface can show an operator. */
  reason: string;
}

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
   * OPTIONAL: report a command-request this transport took and will now never
   * put on a wire, because it has permanently stopped trying.
   *
   * A channel of its own, and NOT a synthetic `error` frame through
   * `onMessage`, which is the shape that looks cheaper and is wrong. An `error`
   * correlated to a requestId the client has already called `lost` is read as
   * proof the mod RECEIVED the command: `TelemetryClient.handleCommandError`
   * moves it to `found`. Answering a stranded command that way would claim a
   * command that never left the browser had reached the game.
   *
   * What the client does with it is the opposite claim, and a stronger one than
   * `lost`: the command is settled `undelivered`, which says it did not run.
   * Only report a command that genuinely never went out; a transport that
   * cannot tell simply does not implement this, and its commands stay `lost`,
   * which is the honest answer for "we do not know".
   *
   * Omitted by every transport that has no queue to strand anything in
   * (`StubTransport`, `ReplayTransport`, `CourierTransport`) and by
   * `PeerTransport`, which refuses a command at the press instead of holding it.
   */
  onUndelivered?(listener: (command: UndeliveredCommand) => void): () => void;

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
   * duplicate the authority, it would OVERRIDE it. The stream transport the app
   * dials the mod with deliberately does not implement it, and that is not an
   * omission to fix.
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
  /**
   * OPTIONAL: whether this transport relays the mod's `subscribed` acks, so a
   * missing one is real evidence that nothing will ever publish the topic.
   *
   * **Absent means NO**, which is the opposite default to `carriesVantage` and
   * deliberately so. Every other transport in the tree is silent about acks:
   * `StubTransport` emits whatever a test scripts and never acks,
   * `ReplayTransport` replays a fixture's frames, `CourierTransport` drives the
   * courier directly. Defaulting to yes would mature every topic in every one
   * of those into `unowned` the moment the window elapsed, which is precisely
   * the false-unowned this whole mechanism is built to avoid. Opting in is a
   * claim a transport has to make about itself.
   *
   * `PeerTransport` is the interesting no. A station's subscribe does reach the
   * mod, but only when the HOST's own refcount makes a 0 -> 1 transition, so a
   * topic the host already holds is never re-acked; the station also missed
   * every ack minted before it connected. Silence there is not evidence of
   * anything. A station therefore stays `pending`, and relaying the host's
   * verdict to it is separate work.
   */
  readonly decidesTopicOwnership?: boolean;
}
