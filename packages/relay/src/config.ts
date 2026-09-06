export interface RelayConfig {
  port: number;
  /**
   * Optional override for the public IP coturn advertises. Empty in
   * the typical case: the relay auto-discovers it at startup. Set
   * explicitly for unusual setups (multi-WAN, IPv6, pinned DDNS host).
   */
  turnExternalIp: string | null;
  /**
   * TURN signalling port, and the relay-session port window coturn
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
   * When true, skip the public-IP discovery + coturn spawn entirely
   * and report `/ice-config` as 503. Used by the Playwright multi-
   * screen test, where the host + station run on `localhost` and
   * direct ICE candidates suffice: coturn would otherwise need a
   * working `turnserver` binary on every dev machine.
   */
  skipCoturn: boolean;
}

/** Defaults live here rather than in `startCoturn` so one file answers
 *  "what ports does this relay want forwarded". */
const DEFAULT_TURN_PORT = 3478;
const DEFAULT_TURN_MIN_PORT = 49160;
const DEFAULT_TURN_MAX_PORT = 49170;

function port(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  // A typo'd port silently becoming NaN would make coturn refuse to start
  // with an opaque error, so an unusable value falls back to the default.
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  return {
    port: Number(env.PORT ?? 3002),
    turnExternalIp: env.TURN_EXTERNAL_IP?.trim() || null,
    turnPort: port(env.TURN_PORT, DEFAULT_TURN_PORT),
    turnMinPort: port(env.TURN_MIN_PORT, DEFAULT_TURN_MIN_PORT),
    turnMaxPort: port(env.TURN_MAX_PORT, DEFAULT_TURN_MAX_PORT),
    skipCoturn: env.SKIP_COTURN === "1" || env.SKIP_COTURN === "true",
  };
}
