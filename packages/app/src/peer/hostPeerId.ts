/**
 * Stable host peer-id derivation: the heart of the "stable host peer id"
 * model that replaced the relay-hosted broker directory.
 *
 * The host's PeerJS peer claims a broker id derived from the operator-facing
 * short share code, and the station derives the same ids from the code the
 * operator types or scans and connects to them directly: no directory peer,
 * no resolve hop. That keeps both ends browsers, which is what makes mDNS
 * host candidates resolve natively on the LAN; a Node-wrtc directory peer in
 * the middle can neither do that nor run turn on a macOS host.
 *
 * A code maps to a small ring of ids (`gonogo-host-<CODE>-<slot>`), because a
 * host that vanishes without a clean leave keeps its id on the public broker
 * until the broker lets go, and a hung tab keeps it for as long as it hangs.
 * The next host takes the next free slot and a station tries every slot.
 *
 * The prefix is required: bare share codes would collide with other gonogo
 * users on the shared broker key "gonogo". The operator never sees the
 * prefix or the slot: they share the code itself.
 */

/** Prefix for the host's derived PeerJS peer id. Lowercase, fixed. */
export const HOST_PEER_ID_PREFIX = "gonogo-host-";

/** How many broker ids one share code owns. */
export const HOST_PEER_SLOTS = 4;

/**
 * Every broker id a host under `code` may hold, in slot order. The code is
 * normalised to uppercase so the host (uppercase codes) and the station
 * (which uppercases operator input) always derive the same ids.
 */
export function deriveHostPeerIds(code: string): string[] {
  const upper = code.toUpperCase();
  return Array.from(
    { length: HOST_PEER_SLOTS },
    (_, slot) => `${HOST_PEER_ID_PREFIX}${upper}-${slot}`,
  );
}

/** The broker id of one slot of `code`'s ring; `slot` wraps round the ring. */
export function deriveHostPeerId(code: string, slot: number): string {
  const ids = deriveHostPeerIds(code);
  return ids[((slot % HOST_PEER_SLOTS) + HOST_PEER_SLOTS) % HOST_PEER_SLOTS];
}

/**
 * How often a screen that holds the host role asks again for something it is
 * waiting on: a broker id held by an earlier host once the whole ring is
 * taken, and the relay's station endpoint while an earlier host still holds it.
 */
export const HOST_RETRY_INTERVAL_MS = 3_000;
