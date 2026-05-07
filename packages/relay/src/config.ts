export interface IceServerConfig {
  url: string;
  username?: string;
  credential?: string;
}

export interface ProxyConfig {
  port: number;
  ocislyHost: string;
  ocislyPort: number;
  iceServers: IceServerConfig[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  const iceServers: IceServerConfig[] = [];
  if (env.TURN_URL) {
    iceServers.push({
      url: env.TURN_URL,
      username: env.TURN_USERNAME,
      credential: env.TURN_CREDENTIAL,
    });
  }

  return {
    port: Number(env.PORT ?? 3002),
    ocislyHost: env.OCISLY_HOST ?? "localhost",
    ocislyPort: Number(env.OCISLY_PORT ?? 5077),
    iceServers,
  };
}
