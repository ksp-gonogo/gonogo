import { logger } from "@ksp-gonogo/logger";

/**
 * `sha256-<hex>` of the given bytes — same format `@ksp-gonogo/core`'s
 * `checkUplinkCompat`/the loader's own `sha256Hex` produce (see
 * `uplinks/registry.ts`'s `integrity` doc comment). Kept standalone rather
 * than importing the loader's private `sha256Hex`: that one throws the
 * loader's own `LoadRefusal` on a missing `crypto.subtle`, which is a
 * loader-domain concept this peer-layer cache has no business coupling to.
 */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "cannot verify bundle integrity: crypto.subtle unavailable (non-secure origin)",
    );
  }
  const digest = await subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256-${hex}`;
}

/**
 * Download-once cache for Uplink bundle bytes (D6 — the station conduit).
 * Keyed by `bundleUrl`: concurrent or sequential requests for the SAME url
 * coalesce onto a single in-flight fetch+digest, so N stations asking for
 * the same bundle cost the author host exactly one download — the
 * "downloads each bundle once" requirement from the D6 spec. See
 * `PeerHostService.handleUplinkBundleRequest` for the caller.
 *
 * A failed fetch (network error, non-2xx) is NOT cached — the entry is
 * evicted so a later retry gets a fresh attempt rather than replaying the
 * same rejection forever. A successful fetch+digest IS cached indefinitely
 * for the life of this host page/session: bytes are immutable once
 * fetched, and a `bundleUrl` is expected to be content-addressed/versioned
 * (a new Uplink version ships a new url), so there's no invalidation story
 * to design here.
 */
export class BundleFetchCache {
  private readonly cache = new Map<
    string,
    Promise<{ bytes: Uint8Array; digest: string }>
  >();

  /**
   * Resolve the verified `{ bytes, digest }` for `bundleUrl`, fetching (and
   * SHA-256-digesting) at most once no matter how many callers ask for the
   * same url concurrently — later callers, even mid-flight, get the SAME
   * pending promise rather than starting a second fetch. `fetchBytes` is
   * injected so tests can drive it without a live network call.
   */
  fetchVerified(
    bundleUrl: string,
    fetchBytes: (url: string) => Promise<ArrayBuffer>,
  ): Promise<{ bytes: Uint8Array; digest: string }> {
    const existing = this.cache.get(bundleUrl);
    if (existing) return existing;

    const pending = (async () => {
      const buf = await fetchBytes(bundleUrl);
      const bytes = new Uint8Array(buf);
      const digest = await sha256Hex(buf);
      return { bytes, digest };
    })();

    this.cache.set(bundleUrl, pending);
    // Evict on failure — a transient network blip shouldn't permanently
    // poison every future request for this url. The rejection itself still
    // propagates to whoever awaited this call.
    pending.catch((err) => {
      this.cache.delete(bundleUrl);
      logger.warn(
        `[BundleFetchCache] fetch failed for ${bundleUrl} — evicted from cache (${
          err instanceof Error ? err.message : String(err)
        })`,
      );
    });
    return pending;
  }

  /** Test/diagnostic hook: how many urls are currently cached (in-flight or resolved). */
  size(): number {
    return this.cache.size;
  }
}
