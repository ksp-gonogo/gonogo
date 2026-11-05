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

const DEFAULT_RELAY_URL = "http://localhost:3002";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

declare global {
  interface Window {
    /** A relay address set before the app loads, which wins over the build's; a test points one main screen at its own relay this way. */
    __GONOGO_RELAY_URL__?: string;
  }
}

const RELAY_PORT = 3002;

/**
 * Where this page looks for the relay. A page served over http from an address
 * other than this machine's own (the bundle opened from another device) finds
 * the relay on the same host, port 3002. Anything else, the dev server and the
 * hosted site included, uses the dev-compose port on this machine. `VITE_RELAY_URL`
 * overrides both, for a relay on a different host.
 */
export function relayBaseUrl(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  const override =
    typeof window !== "undefined" ? window.__GONOGO_RELAY_URL__ : undefined;
  return (override ?? env.VITE_RELAY_URL ?? servedFromRelayUrl()).replace(
    /\/$/,
    "",
  );
}

function servedFromRelayUrl(): string {
  if (typeof location === "undefined") return DEFAULT_RELAY_URL;
  const { protocol, hostname } = location;
  if (protocol !== "http:" || LOOPBACK_HOSTS.has(hostname.toLowerCase())) {
    return DEFAULT_RELAY_URL;
  }
  return `http://${hostname}:${RELAY_PORT}`;
}

/** The relay's socket to its station endpoint, which only the main screen opens. */
export function stationsSocketUrl(): string {
  return `${relayBaseUrl().replace(/^http/, "ws")}/stations`;
}

/**
 * Whether the relay runs the station endpoint behind `/stations`: true or
 * false as the relay's `/bootstrap-config` reports it (a relay that predates
 * the field is taken to run it), or null when the relay could not be asked.
 * Asked over HTTP so a relay without the endpoint is never sent a WebSocket
 * it can only refuse.
 */
export async function relayHasStationEndpoint(
  fetchImpl: typeof fetch = fetch,
): Promise<boolean | null> {
  try {
    const res = await fetchImpl(`${relayBaseUrl()}/bootstrap-config`);
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const declared: unknown =
      typeof body === "object" && body !== null
        ? Reflect.get(body, "stationEndpoint")
        : undefined;
    return declared !== false;
  } catch {
    return null;
  }
}
