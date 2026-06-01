/**
 * Stable host peer-id derivation — the heart of the "stable host peer id"
 * model that replaced the relay-hosted broker directory.
 *
 * The host's PeerJS peer claims a deterministic id derived from the
 * operator-facing 4-char share code (`gonogo-host-<CODE>`). The station
 * derives the *same* id from the code the operator types/scans and connects
 * to it directly — no directory peer, no resolve hop. Both ends are
 * browsers, so mDNS host candidates resolve natively on the LAN; the old
 * Node-wrtc directory peer (which could neither resolve mDNS nor do TURN on
 * a macOS host) is gone.
 *
 * The prefix is REQUIRED: bare 4-char codes would collide with other gonogo
 * users on the shared broker key "gonogo". The operator never sees the
 * prefix — they share the 4-char code; the prefix is an implementation
 * detail of both ends.
 */

/** Prefix for the host's derived PeerJS peer id. Lowercase, fixed. */
export const HOST_PEER_ID_PREFIX = "gonogo-host-";

/**
 * Derive the host's broker peer id from a share code.
 *
 * Idempotent: a value that already carries the prefix (e.g. a `?host=` URL
 * minted by an older build, or a full peer id surfaced by a test harness)
 * passes through unchanged rather than getting double-prefixed. The code is
 * normalised to uppercase so the host (uppercase codes) and the station
 * (which uppercases operator input) always derive the same id.
 */
export function deriveHostPeerId(code: string): string {
  if (code.startsWith(HOST_PEER_ID_PREFIX)) return code;
  return `${HOST_PEER_ID_PREFIX}${code.toUpperCase()}`;
}
