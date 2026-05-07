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
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  return {
    port: Number(env.PORT ?? 3002),
    ocislyHost: env.OCISLY_HOST ?? "localhost",
    ocislyPort: Number(env.OCISLY_PORT ?? 5077),
    turnExternalIp: env.TURN_EXTERNAL_IP?.trim() || null,
  };
}
