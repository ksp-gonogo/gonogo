/**
 * What a station and the main screen say to each other to join a station to
 * the endpoint. Each rides the metadata of an ordinary PeerJS data
 * connection: the public broker passes only PeerJS's own offers, with a real
 * session description, and closes the socket of a sender that sends anything
 * else.
 */
export type EndpointJoin =
  /** A station asks to join, with its WebRTC offer for the endpoint. */
  | { kind: "join"; id: string; sdp: string }
  /** The endpoint's answer to that offer: the station connects to it. */
  | { kind: "answer"; id: string; sdp: string };

const KEY = "gonogoEndpoint";

/** The connection metadata that carries `join`. */
export function joinMetadata(join: EndpointJoin): Record<string, unknown> {
  return { [KEY]: join };
}

function field(from: unknown, key: string): unknown {
  return typeof from === "object" && from !== null
    ? Reflect.get(from, key)
    : undefined;
}

/** The join a connection's metadata carries, or null for an ordinary connection. */
export function readJoin(metadata: unknown): EndpointJoin | null {
  const raw = field(metadata, KEY);
  const kind = field(raw, "kind");
  const id = field(raw, "id");
  const sdp = field(raw, "sdp");
  if (
    (kind === "join" || kind === "answer") &&
    typeof id === "string" &&
    typeof sdp === "string"
  ) {
    return { kind, id, sdp };
  }
  return null;
}
