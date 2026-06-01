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

/**
 * Resolve a host share-code to its current PeerJS peer id via the relay's
 * `/host/:shareCode` registry. Returns the peer id, or `null` when the
 * relay is unreachable or doesn't know the code (404) — the station then
 * falls back to treating the typed value as a direct peer id (back-compat
 * with the no-relay flow).
 *
 * The host registers `shareCode → peerId` on every PeerJS open + heartbeat,
 * so a station re-resolving on each reconnect auto-follows the host's
 * peer-id rotation without the operator re-sharing a code. See
 * `local_docs/relay-host-discovery.md`.
 */
export async function resolveHostPeerId(
  shareCode: string,
): Promise<string | null> {
  const url = `${relayBaseUrl()}/host/${encodeURIComponent(shareCode)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.status === 404) {
      logger.debug(`[ice] relay doesn't know share code ${shareCode}`);
      return null;
    }
    if (!res.ok) {
      logger.warn(`[ice] relay /host returned ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { peerId?: unknown };
    return typeof body.peerId === "string" ? body.peerId : null;
  } catch (err) {
    logger.debug(
      `[ice] relay /host resolve failed — treating code as a direct peer id (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}
