import { seedKerbcamHost } from "@gonogo/kerbcam";
import { logger } from "@gonogo/logger";
import { relayBaseUrl } from "../peer/iceServers";
import { seedKosHost } from "./kos";
import { seedTelemachusHost } from "./telemachus";

/**
 * First-run seeding of "where is KSP" from the bundled container's
 * `KSP_HOST` env var, republished by the relay at `/bootstrap-config`.
 *
 * Pointing a fresh browser at the bundle should need ZERO Settings
 * spelunking: one env var on `docker run` seeds the default host for every
 * KSP-facing data source. The seeds are in-memory and per-source guarded —
 * any config the user has ever saved in Settings wins, and because nothing
 * is persisted here, changing `KSP_HOST` and restarting the container takes
 * effect on the next page load.
 *
 * Outside the bundle (GH Pages, dev without a relay) the fetch fails or
 * returns `{ kspHost: null }` and this is a no-op.
 */

/**
 * Container-internal aliases for "the machine the container runs on".
 * Sources the BROWSER dials (Telemachus WS, kerbcam sidecar) can't resolve
 * these — the browser-side equivalent is `localhost`. The kOS seed keeps
 * the verbatim value because the in-container proxy is the dialler there.
 */
const CONTAINER_INTERNAL_HOSTS = new Set([
  "host.docker.internal",
  "host.containers.internal",
]);

export async function seedKspHostDefaults(
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  let kspHost: string | null = null;
  try {
    const res = await fetchImpl(`${relayBaseUrl()}/bootstrap-config`);
    if (!res.ok) return;
    const body = (await res.json()) as { kspHost?: unknown };
    kspHost =
      typeof body.kspHost === "string" && body.kspHost.trim() !== ""
        ? body.kspHost.trim()
        : null;
  } catch {
    // No relay reachable — not a bundle deployment; defaults stand.
    return;
  }
  if (!kspHost) return;

  const browserHost = CONTAINER_INTERNAL_HOSTS.has(kspHost)
    ? "localhost"
    : kspHost;

  seedTelemachusHost(browserHost);
  seedKerbcamHost(browserHost);
  seedKosHost(kspHost);

  logger.tag("bootstrap").info("Seeded KSP host defaults from relay", {
    kspHost,
    browserHost,
  });
}
