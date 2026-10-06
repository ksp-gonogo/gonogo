import type { ClientMessage, ServerMessage } from "../envelope";

/**
 * Connection status of a Transport's underlying pipe.
 *
 * @category Stream messages
 */
export type TransportStatus =
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "error";

/**
 * A command a transport accepted and will now never send, with the
 * transport's own reason. It never reached the mod.
 *
 * @category Stream messages
 */
export interface UndeliveredCommand {
  /** The dispatch's own `requestId`, as it was handed to `send`. */
  requestId: string;
  /** Why it will never go, in a sentence a surface can show an operator. */
  reason: string;
}

/**
 * A command that the machine a transport relays for, such as the main screen
 * for a station, has stopped waiting for. Nobody knows whether it ran, unlike
 * an {@link UndeliveredCommand}, which certainly did not.
 *
 * @category Stream messages
 */
export interface LostCommand {
  /** The dispatch's own `requestId`, as it was handed to `send`. */
  requestId: string;
  /** Why the far side stopped waiting, in its own words. */
  reason: string;
}

/**
 * A typed message pipe between the app and a telemetry source, such as a
 * WebSocket to the mod. It carries the SDK's messages and knows nothing about
 * Topics, subscriptions or commands beyond that.
 *
 * @category Stream messages
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
   * Optional: reports each command this transport accepted and has stopped
   * trying to send, which the client then marks `undelivered`: it did not run.
   * Report only commands that certainly never went out. A transport that cannot
   * tell leaves this out, and its commands stay `lost`.
   */
  // A separate channel, not an `error` frame: an error correlated to a request id is read as proof the mod received it.
  onUndelivered?(listener: (command: UndeliveredCommand) => void): () => void;

  /**
   * Optional: reports each command the machine this transport relays for has
   * stopped waiting for, which the client then marks `lost`: it may or may not
   * have run. For a command that certainly never left, use `onUndelivered`.
   */
  onLost?(listener: (command: LostCommand) => void): () => void;

  /**
   * Optional: the UT by which a command sent now is expected to be confirmed,
   * for a transport that runs its own delay model. A transport carrying the
   * mod's delay must leave this out: the client then takes the delay from
   * `comms.delay`, and this would override it.
   */
  predictConfirmEta?(): number | undefined;

  /**
   * Optional: `false` when this transport cannot choose which command centre
   * it observes from, so the client refuses a change of vantage. Absent means
   * it can. A station's transport cannot, since it shares the main screen's
   * session with the mod.
   */
  readonly carriesVantage?: boolean;
  /**
   * Optional: `true` when this transport passes on the mod's acknowledgement
   * of each subscription, so a Topic that is never acknowledged can be shown as
   * `"unowned"`. Absent means no, and such Topics stay `"pending"`.
   */
  readonly decidesTopicOwnership?: boolean;
}
