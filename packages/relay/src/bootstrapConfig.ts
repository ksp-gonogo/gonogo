import type { FastifyInstance } from "fastify";

/**
 * First-run bootstrap config for the bundled container.
 *
 * The bundle takes a single `KSP_HOST` env var ("where is KSP, as seen
 * from this container") and the relay republishes it here so the SPA,
 * a static build that can't read container env, can seed the default
 * hosts for its data sources (the Sitrep stream, kOS, kerbcast sidecar) on a
 * browser that has never saved a config.
 *
 * `GET /bootstrap-config` → `{ kspHost: string | null, stationEndpoint: boolean }`
 *
 * `kspHost` is the verbatim container-perspective value. The app maps
 * container-internal names (`host.docker.internal`,
 * `host.containers.internal`) to `localhost` for the sources the
 * browser dials; the kOS bridge value stays verbatim because the
 * in-container proxy is the thing dialling it.
 *
 * `stationEndpoint` is whether this relay runs the station endpoint behind
 * `/stations`. A main screen reads it before opening that socket, so a relay
 * started without the endpoint is never sent a WebSocket it can only refuse.
 *
 * Outside the bundle (public relay deployments) `KSP_HOST` is unset and
 * this returns `{ kspHost: null }`: the app treats that as "no seed".
 */
export function registerBootstrapConfigRoutes(
  fastify: FastifyInstance,
  opts: { kspHost?: string | null; stationEndpoint?: boolean } = {},
): void {
  const kspHost = opts.kspHost?.trim() || null;

  const stationEndpoint = opts.stationEndpoint ?? true;

  fastify.get("/bootstrap-config", async () => ({ kspHost, stationEndpoint }));
}
