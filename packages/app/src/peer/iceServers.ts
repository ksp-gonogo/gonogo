/**
 * ICE server configuration for PeerJS Peer instances.
 *
 * The gonogo relay runs inside a podman container whose network isn't
 * reachable from the browser directly — ICE peer-to-peer would hang and time
 * out after ~12s. The relay's bundled coturn gives both peers a third
 * address they can both reach. The host's main screen fetches the
 * relay's `/ice-config` on boot; stations don't need a config of their
 * own (they pair against the host's relay candidates over the broker).
 */
export function loadIceServers(): RTCIceServer[] {
  const env = import.meta.env as Record<string, string | undefined>;
  const url = env.VITE_TURN_URL ?? "turn:localhost:3478";
  const username = env.VITE_TURN_USERNAME ?? "gonogo";
  const credential = env.VITE_TURN_CREDENTIAL ?? "gonogo-dev-secret";

  if (!url) return [];
  return [{ urls: url, username, credential }];
}
