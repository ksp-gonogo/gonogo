/**
 * The payload type that marks a broker message as an endpoint join rather
 * than a PeerJS connection. The broker relays only PeerJS's own message
 * types, so a join rides an `OFFER`; a receiving PeerJS ignores an offer
 * whose payload type it does not know.
 */
export const ENDPOINT_SIGNAL = "gonogo-endpoint";

/** What a station and the main screen say to each other through the broker to join a station to the endpoint. */
export type EndpointSignal =
  /** A station asks to join, with its WebRTC offer for the endpoint. */
  | { kind: "join"; sdp: string }
  /** The endpoint's answer: the station connects to it. */
  | { kind: "answer"; sdp: string }
  /** No endpoint is running: the station connects to the main screen directly. */
  | { kind: "direct" };

/** The part of a PeerJS Peer the signals use: its socket to the broker. */
export interface BrokerPeer {
  socket: {
    send(message: { type: string; dst: string; payload: unknown }): void;
    on(event: "message", cb: (message: unknown) => void): unknown;
    off(event: "message", cb: (message: unknown) => void): unknown;
  };
}

function field(from: unknown, key: string): unknown {
  return typeof from === "object" && from !== null
    ? Reflect.get(from, key)
    : undefined;
}

function asSignal(raw: unknown): EndpointSignal | null {
  const kind = field(raw, "kind");
  const sdp = field(raw, "sdp");
  if ((kind === "join" || kind === "answer") && typeof sdp === "string") {
    return { kind, sdp };
  }
  if (kind === "direct") return { kind: "direct" };
  return null;
}

/** Send one signal to `dst` through the broker this Peer is registered with. */
export function sendSignal(
  peer: BrokerPeer,
  dst: string,
  connectionId: string,
  signal: EndpointSignal,
): void {
  peer.socket.send({
    type: "OFFER",
    dst,
    payload: { type: ENDPOINT_SIGNAL, connectionId, signal },
  });
}

/** Hear every signal sent to this Peer. Returns the unsubscribe. */
export function onSignal(
  peer: BrokerPeer,
  cb: (from: string, connectionId: string, signal: EndpointSignal) => void,
): () => void {
  const listener = (raw: unknown) => {
    const payload = field(raw, "payload");
    if (field(raw, "type") !== "OFFER") return;
    if (field(payload, "type") !== ENDPOINT_SIGNAL) return;
    const src = field(raw, "src");
    const connectionId = field(payload, "connectionId");
    const signal = asSignal(field(payload, "signal"));
    if (typeof src !== "string" || typeof connectionId !== "string") return;
    if (signal) cb(src, connectionId, signal);
  };
  peer.socket.on("message", listener);
  return () => {
    peer.socket.off("message", listener);
  };
}
