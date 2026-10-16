import { logger } from "@ksp-gonogo/logger";

/**
 * ICE server configuration for the host's PeerJS Peer.
 *
 * The gonogo relay hosts a coturn turn server bundled in its container,
 * with a per-restart-rotated secret minted in-memory. The host (main
 * screen) fetches `/ice-config` once on boot to learn the credentials
 * and the public IP coturn is advertising.
 *
 * Stations don't fetch this themselves: a station is handed the relay's
 * server entries by the host once connected. A station Peer starts with the
 * STUN list alone, never a relay default: `turn:localhost:3478` means the phone
 * itself when read on a phone, which costs four useless STUN/TURN timeouts
 * per attempt.
 */

export interface IceConfig {
  iceServers: RTCIceServer[];
}

/**
 * Two independent public STUN providers, so one being down does not take the
 * direct path with it. A STUN server sees each device's public address and
 * port at join time and carries no other traffic. Peers set this explicitly
 * because passing any `config` to PeerJS replaces its built-in list.
 */
export const STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

/** The STUN list followed by the relay server's entries, STUN never dropped. */
export function withStun(turnServers: RTCIceServer[]): RTCIceServer[] {
  return [...STUN_SERVERS, ...turnServers];
}

const DEFAULT_RELAY_URL = "http://localhost:3002";
const FETCH_TIMEOUT_MS = 4_000;

/**
 * Fetch the host's ICE config from the relay's `/ice-config` endpoint.
 * Returns `[]` if the fetch fails, the host falls back to direct +
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
    const body: unknown = await res.json();
    const iceServers: unknown =
      typeof body === "object" && body !== null
        ? Reflect.get(body, "iceServers")
        : undefined;
    if (!Array.isArray(iceServers)) {
      logger.warn("[ice] relay /ice-config response missing iceServers");
      return [];
    }
    return iceServers as IceConfig["iceServers"];
  } catch (err) {
    logger.warn(
      `[ice] relay /ice-config fetch failed: host will run without TURN (${
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

// NOTE: there is no broker-directory resolve hop. Under the stable-host-id
// model the host claims a deterministic `gonogo-host-<code>` peer id and the
// station derives the same id from the code (see `hostPeerId.ts`).
