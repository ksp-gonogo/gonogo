import { seedSetting } from "@ksp-gonogo/core";
import { logger } from "@ksp-gonogo/logger";
import { relayBaseUrl } from "../peer/iceServers";

/**
 * First-run seeding of "where is KSP" from the bundled container's
 * `KSP_HOST` env var, republished by the relay at `/bootstrap-config`.
 *
 * Pointing a fresh browser at the bundle should need ZERO Settings
 * spelunking: one env var on `docker run` seeds the shared `gameHost`
 * setting that every KSP-facing source reads (the telemetry stream and the
 * kerbcast sidecar). The seed is in-memory only — any host the user has
 * saved in Settings wins, and because nothing is persisted here, changing
 * `KSP_HOST` and restarting the container takes effect on the next page load.
 *
 * Outside the bundle (GH Pages, dev without a relay) the fetch fails or
 * returns `{ kspHost: null }` and this is a no-op.
 */

/**
 * Container-internal aliases for "the machine the container runs on".
 * Sources the BROWSER dials (telemetry stream, kerbcast sidecar) can't
 * resolve these — the browser-side equivalent is `localhost`.
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

  // One shared host for every Uplink (telemetry :8090, kerbcast sidecar
  // :8088). kOS rides the telemetry stream — no host of its own.
  seedSetting("gameHost", browserHost);

  logger.tag("bootstrap").info("Seeded KSP host defaults from relay", {
    kspHost,
    browserHost,
  });
}
