export interface RelayConfig {
  port: number;
  /**
   * Optional override for the public IP coturn advertises. Empty in
   * the typical case: the relay auto-discovers it at startup. Set
   * explicitly for unusual setups (multi-WAN, IPv6, pinned DDNS host).
   */
  turnExternalIp: string | null;
  /**
   * Turn signalling port, and the relay-session port window coturn
   * allocates from (one port per active TURN-relayed client).
   *
   * Env-driven because every one of these has to match a router
   * port-forward and a published container port, and an operator running
   * the released image has no source tree to edit. Changing the window
   * means setting `TURN_MIN_PORT` / `TURN_MAX_PORT` here, widening the
   * compose `ports:` mapping, and widening the router forwards.
   */
  turnPort: number;
  turnMinPort: number;
  turnMaxPort: number;
  /**
   * Offer a TCP relay address next to the UDP one. A browser allocates on
   * every local network for every address it is given, so the TCP one doubles
   * the relay ports each connection holds; it only helps a station behind a
   * network that blocks UDP.
   */
  turnTcp: boolean;
  /**
   * When true, skip the public-IP discovery + coturn spawn entirely
   * and report `/ice-config` as 503. Used by the Playwright multi-
   * screen test, where the host + station run on `localhost` and
   * direct ICE candidates suffice: coturn would otherwise need a
   * working `turnserver` binary on every dev machine.
   */
  skipCoturn: boolean;
  /**
   * The relay is reachable from the internet, so coturn must not relay to
   * private, loopback, link-local or shared carrier-range peers. Off by default: a LAN
   * deployment needs those ranges.
   */
  publicRelay: boolean;
  /**
   * Origins, beyond the public build and this machine's loopback addresses,
   * whose pages may use the relay: a main screen opened at the machine's LAN
   * address, or a fork's own site. From `RELAY_APP_ORIGINS`, comma-separated.
   */
  appOrigins: string[];
  /**
   * The address a station on another network reaches this relay's HTTP port
   * at, from `RELAY_PUBLIC_URL`. Null when the operator has not published
   * the port, and then no station link names this relay. A station on the
   * public build (https) can only fetch from an https address.
   */
  publicUrl: string | null;
  /**
   * The router's address, from `ROUTER_IP`, when the relay should ask only that
   * one to open its ports. Null lets the relay look for the router itself.
   */
  routerIp: string | null;
  /** Do not ask the router to open the relay ports (`PORT_MAPPING=0`). */
  skipPortMapping: boolean;
}

/** Defaults live here rather than in `startCoturn` so one file answers
 *  "what ports does this relay want forwarded". */
const DEFAULT_TURN_PORT = 3478;
const DEFAULT_TURN_MIN_PORT = 49160;
const DEFAULT_TURN_MAX_PORT = 49169;

function port(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  // A typo'd port silently becoming NaN would make coturn refuse to start with an opaque error, so an unusable value falls back to the default.
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
}

/**
 * `RELAY_APP_ORIGINS` as origins. An entry that is not an origin throws: one
 * dropped quietly would leave its main screen refused with nothing saying why.
 */
function appOrigins(raw: string | undefined): string[] {
  const entries = (raw ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  return entries.map((entry) => {
    let origin: string;
    try {
      origin = new URL(entry).origin;
    } catch {
      origin = "null";
    }
    if (origin === "null") {
      throw new Error(
        `RELAY_APP_ORIGINS entry "${entry}" is not an origin such as http://<address>:8080`,
      );
    }
    return origin;
  });
}

/** `RELAY_PUBLIC_URL` as an origin; one that is not an http(s) origin throws, since a quietly dropped one leaves the link without a relay and nothing saying why. */
function publicUrl(raw: string | undefined): string | null {
  const entry = raw?.trim();
  if (!entry) return null;
  let url: URL | null = null;
  try {
    url = new URL(entry);
  } catch {
    url = null;
  }
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new Error(
      `RELAY_PUBLIC_URL "${entry}" is not an http(s) address such as https://relay.example.com`,
    );
  }
  return url.origin;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  return {
    port: Number(env.PORT ?? 3002),
    turnExternalIp: env.TURN_EXTERNAL_IP?.trim() || null,
    turnPort: port(env.TURN_PORT, DEFAULT_TURN_PORT),
    turnMinPort: port(env.TURN_MIN_PORT, DEFAULT_TURN_MIN_PORT),
    turnMaxPort: port(env.TURN_MAX_PORT, DEFAULT_TURN_MAX_PORT),
    turnTcp: env.TURN_TCP === "1" || env.TURN_TCP === "true",
    skipCoturn: env.SKIP_COTURN === "1" || env.SKIP_COTURN === "true",
    publicRelay: env.RELAY_PUBLIC === "1" || env.RELAY_PUBLIC === "true",
    appOrigins: appOrigins(env.RELAY_APP_ORIGINS),
    publicUrl: publicUrl(env.RELAY_PUBLIC_URL),
    routerIp: env.ROUTER_IP?.trim() || null,
    skipPortMapping: env.PORT_MAPPING === "0" || env.PORT_MAPPING === "false",
  };
}
