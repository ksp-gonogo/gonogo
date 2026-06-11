import type { FastifyInstance } from "fastify";

/**
 * First-run bootstrap config for the bundled container.
 *
 * The bundle takes a single `KSP_HOST` env var ("where is KSP, as seen
 * from this container") and the relay republishes it here so the SPA —
 * a static build that can't read container env — can seed the default
 * hosts for its data sources (Telemachus, kOS, kerbcam sidecar) on a
 * browser that has never saved a config.
 *
 * `GET /bootstrap-config` → `{ kspHost: string | null }`
 *
 * `kspHost` is the verbatim container-perspective value. The app maps
 * container-internal names (`host.docker.internal`,
 * `host.containers.internal`) to `localhost` for the sources the
 * BROWSER dials; the kOS bridge value stays verbatim because the
 * in-container proxy is the thing dialling it.
 *
 * Outside the bundle (public relay deployments) `KSP_HOST` is unset and
 * this returns `{ kspHost: null }` — the app treats that as "no seed".
 */
export function registerBootstrapConfigRoutes(
  fastify: FastifyInstance,
  opts: { kspHost?: string | null } = {},
): void {
  const kspHost = opts.kspHost?.trim() || null;

  fastify.get("/bootstrap-config", async () => ({ kspHost }));
}
