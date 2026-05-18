export interface PeerBrokerOverride {
  host: string;
  port: number;
  path: string;
  secure: boolean;
}

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
  /**
   * Optional PeerJS broker override. Without this the relay uses the
   * peerjs.com public broker (same as the app does by default). The
   * Playwright integration test points all three sides — app, relay
   * and station — at a local broker so a single test run is fully
   * self-contained.
   */
  peerBroker: PeerBrokerOverride | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  const brokerHost = env.PEER_HOST?.trim();
  const peerBroker: PeerBrokerOverride | null = brokerHost
    ? {
        host: brokerHost,
        port: Number(env.PEER_PORT ?? 9000),
        path: env.PEER_PATH ?? "/myapp",
        // Default false because if you've gone to the trouble of overriding
        // the host you're almost certainly pointing at a localhost/dev
        // broker without TLS. Override with PEER_SECURE=1 for hosted.
        secure: env.PEER_SECURE === "1" || env.PEER_SECURE === "true",
      }
    : null;
  return {
    port: Number(env.PORT ?? 3002),
    ocislyHost: env.OCISLY_HOST ?? "localhost",
    ocislyPort: Number(env.OCISLY_PORT ?? 5077),
    turnExternalIp: env.TURN_EXTERNAL_IP?.trim() || null,
    skipCoturn: env.SKIP_COTURN === "1" || env.SKIP_COTURN === "true",
    peerBroker,
  };
}
