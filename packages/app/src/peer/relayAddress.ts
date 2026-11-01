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

declare global {
  interface Window {
    /** A relay address set before the app loads, which wins over the build's; a test points one main screen at its own relay this way. */
    __GONOGO_RELAY_URL__?: string;
  }
}

/**
 * Where the main screen looks for the relay. Defaults to the
 * dev-compose port on the same machine. Override via `VITE_RELAY_URL`
 * for setups where the relay is on a different host.
 */
export function relayBaseUrl(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  const override =
    typeof window !== "undefined" ? window.__GONOGO_RELAY_URL__ : undefined;
  return (override ?? env.VITE_RELAY_URL ?? DEFAULT_RELAY_URL).replace(
    /\/$/,
    "",
  );
}

/** The relay's socket to its station endpoint, which only the main screen opens. */
export function stationsSocketUrl(): string {
  return `${relayBaseUrl().replace(/^http/, "ws")}/stations`;
}
