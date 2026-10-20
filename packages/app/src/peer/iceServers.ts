import { logger } from "@ksp-gonogo/logger";

/**
 * ICE server configuration for the host's PeerJS Peer.
 *
 * The gonogo relay hosts a coturn turn server bundled in its container,
 * with a per-restart-rotated secret minted in-memory. The host (main
 * screen) fetches `/ice-config` once on boot to learn the credentials
 * and the public IP coturn is advertising.
 *
 * A station fetches it only from a relay its link names (`?relay=`). Without
 * one a station Peer starts with the STUN list alone and is handed the relay's
 * server entries by the host once connected; it never assumes a relay default,
 * because `turn:localhost:3478` means the phone itself when read on a phone,
 * which costs four useless STUN/TURN timeouts per attempt.
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

/** What a relay's `/ice-config` answers. */
export interface RelayIceConfig {
  iceServers: RTCIceServer[];
  /** The address the relay asks stations to reach it at, or null when its operator has not published one. */
  publicUrl: string | null;
}

/**
 * Fetch ICE config from a relay's `/ice-config` endpoint: the main screen
 * asks its own relay, a station asks the one named in its link. Returns null
 * if the fetch fails, so the caller falls back to direct + STUN-only
 * behaviour, and the readiness UI surfaces the failure.
 */
export async function fetchRelayIceConfig(
  baseUrl: string,
): Promise<RelayIceConfig | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/ice-config`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn(`[ice] relay /ice-config returned ${res.status}`);
      return null;
    }
    const body: unknown = await res.json();
    const fields = typeof body === "object" && body !== null ? body : {};
    const iceServers: unknown = Reflect.get(fields, "iceServers");
    if (!Array.isArray(iceServers)) {
      logger.warn("[ice] relay /ice-config response missing iceServers");
      return null;
    }
    const publicUrl: unknown = Reflect.get(fields, "publicUrl");
    return {
      iceServers: iceServers as IceConfig["iceServers"],
      publicUrl: typeof publicUrl === "string" && publicUrl ? publicUrl : null,
    };
  } catch (err) {
    logger.warn(
      `[ice] relay /ice-config fetch failed: running without TURN (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** A relay address taken from a station link: an http(s) origin, trailing slash dropped; null for anything else. */
export function parseRelayUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
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
