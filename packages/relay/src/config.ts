export interface RelayConfig {
  port: number;
  ocislyHost: string;
  ocislyPort: number;
  /**
   * Optional override for the public IP coturn advertises. Empty in
   * the typical case — the relay auto-discovers it at startup. Set
   * explicitly for unusual setups (multi-WAN, IPv6, pinned DDNS host).
   */
  turnExternalIp: string | null;
  /**
   * When true, skip the public-IP discovery + coturn spawn entirely
   * and report `/ice-config` as 503. Used by the Playwright multi-
   * screen test, where the host + station run on `localhost` and
   * direct ICE candidates suffice — coturn would otherwise need a
   * working `turnserver` binary on every dev machine.
   */
  skipCoturn: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  return {
    port: Number(env.PORT ?? 3002),
    ocislyHost: env.OCISLY_HOST ?? "localhost",
    ocislyPort: Number(env.OCISLY_PORT ?? 5077),
    turnExternalIp: env.TURN_EXTERNAL_IP?.trim() || null,
    skipCoturn: env.SKIP_COTURN === "1" || env.SKIP_COTURN === "true",
  };
}
