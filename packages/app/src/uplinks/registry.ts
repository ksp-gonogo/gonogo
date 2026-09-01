// The Uplink index: the machine-readable list of client bundles this repo's own
// build emits, which the loader resolves an Uplink client bundle from. It is
// read from `public/uplinks/registry.local.json`, written by the vite
// `gonogo-uplink-bundles` plugin from `uplink-bundle-targets.ts`, so it
// describes exactly the bundles sitting beside it under the app's own origin.
//
// This is NOT a directory of Uplinks an operator can browse and install: that
// idea (the Hub) is deleted. An Uplink that does not ship inside this build
// describes itself instead, through the `clientSource` its mod declares on
// `system.uplinks`, and never appears here.

import type { UplinkIdentity } from "./identity";

/**
 * One published version line of an Uplink (both halves ship on one tag).
 *
 * The gate fields (`apiVersion`/`uiKitVersion`/`contractMajor`/`contractMinor`/
 * `minAppVersion`) are the registry-INDEX twin of core's `GonogoUplinkManifest`
 * (`packages/core/src/uplinkVersionCompat.ts`): same values, different home:
 * this is one entry in an index descriptor's `versions[]` list (no `id` of its
 * own, see `UplinkDescriptor` below, plus loader-only fields like
 * `bundleUrl`/`expectedClientHash` core never sees), where `GonogoUplinkManifest`
 * is the sidecar manifest a single built bundle ships. The actual §6.3 verdict
 * logic lives once, in core's `checkUplinkCompat`; `loader.ts`'s
 * `toCompatManifest` converts one of these (+ the parent descriptor's `id`)
 * into a `GonogoUplinkManifest` before calling it.
 */
export interface UplinkVersionDescriptor {
  /** The Uplink's single version line (DLL == client). */
  version: string;
  /** Advisory app-version floor (design §6.3.2): warned on, not gated. */
  minAppVersion: string;
  /** GATE: the @ksp-gonogo extension-API surface the client was built against. */
  apiVersion: string;
  /** GATE: the @ksp-gonogo/ui-kit version. */
  uiKitVersion: string;
  /** GATE: mirrors the C# ContractVersion.Major stamp. */
  contractMajor: number;
  /** GATE: mirrors the C# ContractVersion.Minor stamp (additive contract growth). */
  contractMinor: number;
  /** Where the client bundle is fetched from (opaque to the loader). */
  bundleUrl: string;
  /** H_index: sha256 of the client bundle, `sha256-<hex>` (design §3.3 row A). */
  integrity: string;
  /**
   * H_mod: the hash the mod bakes into its DLL and emits on system.uplinks
   * (design §3.3 row B). `null` until the mod ships it (Phase B two-pass build);
   * the three-way check degrades to the two-way index==bytes agreement meanwhile.
   */
  expectedClientHash?: string | null;
}

/** One Uplink's registry entry: id MUST match the mod's `[SitrepUplink("id")]`. */
export interface UplinkDescriptor {
  id: string;
  name: string;
  author: string;
  repo: string;
  /**
   * The same three values with the source that supplied each. Absent on a
   * descriptor parsed straight out of a fetched index, which is why nothing
   * reads these fields directly: `descriptorIdentity` in `./loader.ts` fills
   * an absent one in as index-listed, which is what an index entry is.
   *
   * Only `descriptorFromClientSource` sets it, because only there can the two
   * sources differ: the mod vouching for an Uplink and a bundle describing
   * itself are different claims, and a consent surface has to say which it is
   * showing.
   */
  identity?: UplinkIdentity;
  versions: UplinkVersionDescriptor[];
}

/** The whole registry index. */
export interface RegistryIndex {
  generatedAt?: string;
  uplinks: UplinkDescriptor[];
}

/**
 * Where the index is read from. Always a URL under the app's own public/, kept
 * as a parameter rather than a constant so a test can point the loader at a
 * fixture without intercepting `fetch`.
 */
export interface RegistrySource {
  url: string;
}

/** The built index, emitted by the vite `gonogo-uplink-bundles` plugin. */
export function localRegistrySource(): RegistrySource {
  return { url: `${import.meta.env.BASE_URL}uplinks/registry.local.json` };
}

/**
 * Fetch + parse the index. This is the app's own origin, which is what makes it
 * a trustworthy hash anchor: an untrusted PeerJS relay only ever carries bundle
 * *bytes*, hashed against this index, never the index itself.
 */
export async function fetchRegistry(
  source: RegistrySource,
): Promise<RegistryIndex> {
  const res = await fetch(source.url, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(
      `registry fetch failed: HTTP ${res.status} for ${source.url}`,
    );
  }
  const json = (await res.json()) as RegistryIndex;
  if (!json || !Array.isArray(json.uplinks)) {
    throw new Error(`registry at ${source.url} is not a valid index`);
  }
  return json;
}
