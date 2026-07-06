import type { ClientMessage, ServerMessage } from "@gonogo/sitrep-sdk";

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
 * boundary. Real implementations (WebSocket, PeerJS) arrive in later
 * milestones — this interface is what they (and `StubTransport`) implement.
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
}
