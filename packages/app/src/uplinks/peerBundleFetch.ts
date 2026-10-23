// D6: build a loader-shaped `fetchBytes(url, expectedHash)` backed by the
// PeerJS bundle-fetch conduit (`PeerClientService.sendBundleFetch`) instead
// of a direct `fetch(url)`: the station-side half of the "main screen
// downloads once, stations pull from it" split. See protocol.ts's
// `uplink-bundle-request`/`-response` doc comment for the wire shape, and
// PeerHostService.handleUplinkBundleRequest for the host's verify+dedup
// side.
//
// This is a thin adapter, not wired into any boot path yet; see this file's own header note below and the D6 handoff report for why.

import type { PeerClientService } from "../peer/PeerClientService";
import {
  defaultVerifiedBundleStore,
  fetchThroughStore,
  type VerifiedBundleStore,
} from "../peer/verifiedBundleStore";

/**
 * The narrow slice of `PeerClientService` this adapter needs. Typed as a
 * `Pick` (not the whole class) so a test can pass a minimal fake instead of
 * a real `PeerClientService` + fake Peer/DataConnection pair.
 */
export type BundleFetchConduit = Pick<
  PeerClientService,
  "sendBundleFetch" | "sendManifestFetch"
>;

/**
 * Build a `LoaderContext.fetchBytes`-shaped function that pulls bundle
 * bytes through `client` instead of fetching directly. `expectedHash` is
 * required on the wire (the host verifies before ever sending bytes back)
 * even though the loader's widened `fetchBytes` type keeps it optional for
 * back-compat with the direct-fetch default (see loader.ts's `loadOne`,
 * the single call site that now passes `version.integrity` as the second
 * arg). A call with no `expectedHash` rejects immediately with a legible
 * reason rather than sending an empty string to the host, which would just
 * bounce every request as a confusing hash-mismatch.
 *
 * A bundle `store` already holds under `expectedHash`, and that still hashes
 * to it, is returned without asking the main screen.
 */
export function createPeerBundleFetcher(
  client: BundleFetchConduit,
  store: VerifiedBundleStore | null = defaultVerifiedBundleStore(),
): (url: string, expectedHash?: string) => Promise<ArrayBuffer> {
  return (url, expectedHash) => {
    if (!expectedHash) {
      return Promise.reject(
        new Error(
          `peer bundle fetch for ${url} has no expectedHash, the loader must pass ` +
            "version.integrity/expectedClientHash through to fetchBytes",
        ),
      );
    }
    return fetchThroughStore(store, expectedHash, () =>
      client.sendBundleFetch(url, expectedHash),
    );
  };
}

/**
 * Build a `LoaderContext.fetchManifest`-shaped function that has the main
 * screen fetch the manifest, so a station reads the same document the main
 * screen loaded from an address only the main screen's network may reach.
 */
export function createPeerManifestFetcher(
  client: BundleFetchConduit,
): (url: string) => Promise<unknown> {
  return (url) => client.sendManifestFetch(url);
}
