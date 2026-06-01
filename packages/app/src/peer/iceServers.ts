import { logger } from "@gonogo/logger";

/**
 * ICE server configuration for the host's PeerJS Peer.
 *
 * The gonogo relay hosts a coturn TURN server bundled in its container,
 * with a per-restart-rotated secret minted in-memory. The host (main
 * screen) fetches `/ice-config` once on boot to learn the credentials
 * and the public IP coturn is advertising.
 *
 * Stations don't fetch this themselves: their host's relay candidates
 * propagate via the broker's signalling channel, which is enough for
 * one-side TURN to bridge any difficult network. We deliberately
 * construct station Peers with no `iceServers` config so a stale or
 * absent local default can't sabotage that path (we used to default to
 * `turn:localhost:3478`, which from a phone meant the phone itself —
 * four useless STUN/TURN timeouts per attempt).
 */

export interface IceConfig {
  iceServers: RTCIceServer[];
}

const DEFAULT_RELAY_URL = "http://localhost:3002";
const FETCH_TIMEOUT_MS = 4_000;

/**
 * Fetch the host's ICE config from the relay's `/ice-config` endpoint.
 * Returns `[]` if the fetch fails — the host falls back to direct +
 * STUN-only behaviour, and the readiness UI surfaces the failure.
 */
export async function fetchHostIceServers(): Promise<RTCIceServer[]> {
  const url = relayBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/ice-config`, { signal: controller.signal });
    if (!res.ok) {
      logger.warn(`[ice] relay /ice-config returned ${res.status}`);
      return [];
    }
    const body = (await res.json()) as IceConfig;
    if (!Array.isArray(body.iceServers)) {
      logger.warn("[ice] relay /ice-config response missing iceServers");
      return [];
    }
    return body.iceServers;
  } catch (err) {
    logger.warn(
      `[ice] relay /ice-config fetch failed — host will run without TURN (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Where the main screen looks for the relay. Defaults to the
 * dev-compose port on the same machine. Override via `VITE_RELAY_URL`
 * for setups where the relay is on a different host.
 */
export function relayBaseUrl(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return (env.VITE_RELAY_URL ?? DEFAULT_RELAY_URL).replace(/\/$/, "");
}

// NOTE: the broker-directory resolver (`resolveHostPeerId` /
// `gonogo-dir-<code>`) was removed here when the stable-host-id model
// landed — the host now claims a deterministic `gonogo-host-<code>` peer id
// and the station derives the same id from the code (see `hostPeerId.ts`),
// so there's no resolve hop. The relay-side directory peer is superseded and
// slated for removal in a follow-up (see `packages/relay/src/directoryPeer.ts`).
