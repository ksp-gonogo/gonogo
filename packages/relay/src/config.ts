import { fileURLToPath } from "node:url";

export interface RelayConfig {
  port: number;
  /**
   * Override for the public IP the endpoint advertises, from `PUBLIC_IP`.
   * Empty in the typical case: the relay discovers it at startup. Set for
   * unusual setups (multi-WAN, a pinned address).
   */
  publicIp: string | null;
  /**
   * Origins, beyond the public build and this machine's loopback addresses,
   * whose pages may use the relay: a main screen opened at the machine's LAN
   * address, or a fork's own site. From `RELAY_APP_ORIGINS`, comma-separated.
   */
  appOrigins: string[];
  /**
   * The router to ask for automatic port forwarding, from `ROUTER_IP`, until
   * the main screen sends the address the player gave. Null asks no router.
   */
  routerIp: string | null;
  /**
   * This machine's address on the router's network, from `LAN_IP`, which a
   * UPnP port mapping names as the target. Null finds it from the route to the
   * router, which inside a container is the container's own address and a
   * router will not forward to.
   */
  lanIp: string | null;
  /**
   * Ask the router to open the endpoint's port and remove it on stop
   * (`GONOGO_AUTO_PORT_FORWARD=1`). Off by default: the relay never contacts the router
   * unless the player turns this on.
   */
  portMapping: boolean;
  /**
   * The endpoint's one port, from `ENDPOINT_PORT`: every station on another
   * network connects on it, over UDP or, where UDP is blocked, TCP. It has to
   * match the published container port and the router forward.
   */
  endpointPort: number;
  /** The port, inside the container only, the endpoint serves the main screen's socket on, from `ENDPOINT_CONTROL_PORT`. */
  endpointControlPort: number;
  /** The gonogo-endpoint binary, from `ENDPOINT_BIN`; the image puts it beside the relay's own files. */
  endpointBinary: string;
  /**
   * Run without the endpoint (`SKIP_ENDPOINT=1`), for a relay started outside
   * the image where no binary was built. Stations then join the main screen
   * directly, which works only on its own network.
   */
  skipEndpoint: boolean;
  /** Offer stations TCP only (`ENDPOINT_OMIT_UDP=1`), which proves the fallback for a network that blocks UDP. */
  endpointOmitUdp: boolean;
}

/** Defaults live here so one file answers "what port does this relay want forwarded". */
const DEFAULT_ENDPOINT_PORT = 47100;
const DEFAULT_ENDPOINT_CONTROL_PORT = 3003;
const DEFAULT_ENDPOINT_BINARY = fileURLToPath(
  new URL("../endpoint/gonogo-endpoint", import.meta.url),
);

function port(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  // A typo'd port silently becoming NaN would make the endpoint refuse to start with an opaque error, so an unusable value falls back to the default.
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  return {
    port: Number(env.PORT ?? 3002),
    publicIp: env.PUBLIC_IP?.trim() || null,
    appOrigins: appOrigins(env.RELAY_APP_ORIGINS),
    routerIp: env.ROUTER_IP?.trim() || null,
    lanIp: env.LAN_IP?.trim() || null,
    portMapping:
      env.GONOGO_AUTO_PORT_FORWARD === "1" ||
      env.GONOGO_AUTO_PORT_FORWARD === "true",
    endpointPort: port(env.ENDPOINT_PORT, DEFAULT_ENDPOINT_PORT),
    endpointControlPort: port(
      env.ENDPOINT_CONTROL_PORT,
      DEFAULT_ENDPOINT_CONTROL_PORT,
    ),
    endpointBinary: env.ENDPOINT_BIN?.trim() || DEFAULT_ENDPOINT_BINARY,
    skipEndpoint: env.SKIP_ENDPOINT === "1" || env.SKIP_ENDPOINT === "true",
    endpointOmitUdp: env.ENDPOINT_OMIT_UDP === "1",
  };
}
