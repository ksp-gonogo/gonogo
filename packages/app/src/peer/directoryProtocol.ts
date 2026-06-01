/**
 * SUPERSEDED by the stable-host-id model (host claims `gonogo-host-<code>`,
 * the station derives the same id from the code — see `hostPeerId.ts`). This
 * module is no longer imported by the app and is slated for removal in a
 * follow-up alongside the relay-side directory peer.
 *
 * Tiny request/response protocol for the relay's broker-side **host
 * directory**.
 *
 * The relay joins the same PeerJS broker the app uses, as a peer with a
 * stable id derived from the host's share-code: `gonogo-dir-<shareCode>`.
 * A station resolves a share-code to the host's current (ephemeral) peer
 * id by opening a DataConnection to that directory peer, sending
 * `{ type: "resolve" }`, and awaiting one reply:
 *
 *   - `{ type: "host", peerId }` — the host is registered; connect to it.
 *   - `{ type: "not-found" }`    — the relay doesn't know this share-code
 *                                  (never registered, or the entry
 *                                  expired). The station falls back to
 *                                  treating the typed value as a direct
 *                                  peer id.
 *
 * The directory closes the connection right after replying — it's a
 * one-shot lookup, not a persistent channel.
 *
 * This protocol is relay↔station only and intentionally separate from the
 * host↔station `PeerMessage` union in `protocol.ts`. The relay mirrors
 * these shapes in its own module (it can't import from `@gonogo/app`); the
 * wire format is small enough that the duplication is cheap and the
 * constant below is the single source of truth for the id prefix.
 */

/** Prefix for the relay's directory peer id. The full id is
 *  `${DIRECTORY_PEER_PREFIX}${shareCode}`. Prefixed so it can't collide
 *  with a host's own (4-char) peer id on the shared broker keyspace. */
export const DIRECTORY_PEER_PREFIX = "gonogo-dir-";

/** Resolve a share-code to the relay directory peer's broker id. */
export function directoryPeerId(shareCode: string): string {
  return `${DIRECTORY_PEER_PREFIX}${shareCode}`;
}

/** Station → directory. */
export interface DirectoryResolveRequest {
  type: "resolve";
}

/** Directory → station. */
export type DirectoryResolveResponse =
  | { type: "host"; peerId: string }
  | { type: "not-found" };
