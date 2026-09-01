// The production Uplink client loader (design §5, the load sequence).
//
// For each enabled Uplink the loader, IN ORDER: (1) resolves a version from the
// registry descriptor, (2) runs the compat gates + mod-hash gate BEFORE fetching
// any bytes: because import() IS registration and is irreversible, (3) fetches
// the bundle, (4) verifies sha256(bytes) against the descriptor (three-way when
// the mod ships its hash), (5) import()s so the bundle's registerComponent(...)
// runs against the injected host. Every refusal quarantines with a legible reason
// surfaced in the in-app Uplinks list: never a silent load, never a silent no-op.
//
// One refusal, and only one, can be loaded past: the pre-fetch DECLARATION
// disagreement where the mod and the index name different builds (channel
// skew). That needs a recorded per-id, per-version, per-hash-pair operator
// decision (`./skewOverride.ts`), it does not weaken the byte check, and the
// loaded row says it happened. The post-fetch bytes mismatch has no such route
// and must not grow one: see `isOverridableIntegrityFailure`.

import {
  type AppCompatIdentity,
  checkUplinkCompat,
  type GonogoUplinkManifest,
  parseSemver,
  parseUplinkManifest,
} from "@ksp-gonogo/core";
import { logger } from "@ksp-gonogo/logger";
import { type ConsentInfo, ensureConsent } from "./consent";
import type { HostCompat } from "./hostCompat";
import {
  registryIdentity,
  resolveUplinkIdentity,
  type UplinkIdentity,
} from "./identity";
import type { UplinkIntegrityFailure, UplinkIntegrityParty } from "./integrity";
import { setUplinkOutcome, type UplinkLoadOutcome } from "./loaderState";
import {
  fetchRegistry,
  type RegistryIndex,
  type RegistrySource,
  type UplinkDescriptor,
  type UplinkVersionDescriptor,
} from "./registry";
import { hasSkewOverride } from "./skewOverride";

/** One entry of the live `system.uplinks` roster the loader consults (design §3.2). */
export interface RosterEntry {
  id: string;
  version: string;
  available: boolean;
  reason: string | null;
  /**
   * Provenance the mod declares, for the consent dialog. Absent for a mod that
   * predates the fields, which is why every arm below falls back rather than
   * asserting.
   */
  name?: string | null;
  author?: string | null;
  repo?: string | null;
  /**
   * H_mod: the client hash the running mod vouches for. Absent in Phase A (the
   * mod does not yet bake/emit it); when present the loader enforces the full
   * three-way agreement, otherwise it enforces the two-way index==bytes check and
   * records the mod-hash arm as pending.
   */
  expectedClientHash?: string | null;
  /**
   * Where the running mod says this Uplink's CLIENT bundle lives (design §3.2,
   * D5): its distributable `url` plus an optional `devPath` (localhost
   * dev-server URL / local build dir for a third-party dev loop). `null`/absent
   * for a mod-only Uplink with no client half, or a mod that predates D5. This
   * makes a third-party Uplink self-describing (the app learns the client URL
   * from the mod, no central index).
   *
   * CONSUMED as of the D5-loader follow-on (2026-07-25): an id installed in
   * the roster with no local-registry descriptor but a `clientSource` is
   * still enabled (`deriveEnabledIds`), and the loader builds an
   * `UplinkDescriptor` for it from this field + the bundle's own manifest
   * sidecar rather than the local index: see `descriptorFromClientSource`
   * and `loadThirdParty` below.
   */
  clientSource?: { url: string; devPath: string | null } | null;
}

export interface LoaderContext {
  /** Where to read the built Uplink index (`registry.local.json`). */
  registrySource: RegistrySource;
  /**
   * The explicit `?uplinkLoaderIds=` override, if the param is present. Takes
   * PRECEDENCE over the roster: a deliberate override is intent, so it must win
   * even when a roster is talking (e.g. an e2e boots with
   * `?uplinkLoaderIds=` to keep an installed Uplink UNloaded and prove the gap
   * surface). `[]` (empty param) means "load nothing"; `undefined` (no param)
   * defers to the roster, and with no roster nothing is attempted.
   */
  override?: readonly string[];
  /** The app's compat identity: gated against each descriptor's declared versions. */
  hostCompat: HostCompat;
  /** The app's own version, for the advisory minAppVersion check. */
  appVersion: string;
  /**
   * The live `system.uplinks` roster, if a stream is mounted. Optional, and the
   * only thing that says what to load: absent (dev / e2e / offline first boot)
   * nothing has told us what is installed, so nothing is attempted unless
   * `override` names ids by hand.
   */
  roster?: RosterEntry[];
  /**
   * Resolve per-Uplink first-load consent (design §3.5 / §5 step 4). Injected so
   * tests can drive the gate; defaults to the real `ensureConsent`, which
   * short-circuits a remembered `id@version` grant and otherwise prompts the
   * operator via the modal wired at boot.
   */
  ensureConsent?: (info: ConsentInfo) => Promise<boolean>;
  /**
   * Import an already-fetched, already-VERIFIED bundle. Injected so tests can
   * drive the loader without a real `import()`.
   *
   * Takes the bytes, not just the URL, and that is the whole point: the default
   * used to re-`import(url)` after `fetchBytes` had downloaded and hashed the
   * same URL separately, so **the bytes that were verified were not the bytes
   * that were executed**. Two downloads, one integrity check. Over a
   * same-origin fixture that reads as a caching detail; over the remote release
   * URL an Uplink now declares, a host can serve verified bytes to the first
   * request and anything at all to the second while every arm of the three-way
   * check reports green.
   *
   * The URL is still passed, for diagnostics only. Nothing may fetch it again.
   *
   * The station path needs this regardless of the tampering argument: a station
   * fetches through the PeerJS conduit (`./peerBundleFetch.ts`) because it has
   * no HTTP route to the author's host at all, so it cannot re-fetch by URL even
   * in principle.
   */
  importBundle?: (bytes: ArrayBuffer, url: string) => Promise<unknown>;
  /**
   * Fetch bundle bytes. Injected for tests; defaults to `defaultFetchBytes`
   * (a direct `fetch`). `expectedHash` is the SAME value `loadOne` is about
   * to verify the returned bytes against (`version.integrity`), passed
   * through as of the D6 station-conduit follow-on (2026-07-25) so a
   * peer-backed implementation (`../peer/PeerClientService.sendBundleFetch`
   * via `./peerBundleFetch.ts`'s `createPeerBundleFetcher`) can put it on
   * the wire for the HOST to verify before it ever sends bytes back to a
   * station: a station has no route to the author host to verify against
   * directly. Optional (not a breaking widen): the default direct-fetch
   * path ignores it entirely, and every existing single-arg
   * `(url) => Promise<ArrayBuffer>` test double is still structurally
   * assignable to this type.
   */
  fetchBytes?: (url: string, expectedHash?: string) => Promise<ArrayBuffer>;
  /**
   * Fetch a third-party Uplink's manifest sidecar (the D5-loader follow-on,
   * a `clientSource`-only id has no local registry entry, so the compat
   * fields (apiVersion/uiKitVersion/contractMajor/contractMinor/
   * minAppVersion) the local index would otherwise supply come from this
   * fetch instead, at the conventional sidecar URL `manifestUrlFor` derives).
   * Returns the parsed-or-parseable JSON value (a string OR an already-parsed
   * object are both accepted by `parseUplinkManifest`). Injected for tests;
   * defaults to a real `fetch` + `.json()`.
   */
  fetchManifest?: (url: string) => Promise<unknown>;
}

/** A refusal: the loader stops here and quarantines with this reason. */
class LoadRefusal extends Error {}

function refuse(reason: string): never {
  throw new LoadRefusal(reason);
}

/**
 * A refusal that is a HASH DISAGREEMENT, carrying the machine-readable record
 * alongside the reason string. Both survive: the reason stays the diagnostic
 * line an operator reads in the loaded-clients list, and `failure` is what lets
 * a surface tell this apart from a compat gate or a dead network without
 * matching prose.
 */
class IntegrityRefusal extends LoadRefusal {
  readonly failure: UplinkIntegrityFailure;

  constructor(reason: string, failure: UplinkIntegrityFailure) {
    super(reason);
    this.failure = failure;
  }
}

function refuseIntegrity(
  failure: UplinkIntegrityFailure,
  reason: string,
): never {
  throw new IntegrityRefusal(reason, failure);
}

/**
 * Who vouched the hash the fetched bytes were checked against.
 *
 * `integrityAnchor` says who supplied `version.integrity`: the published index
 * for a first-party descriptor, the installed mod for one
 * `descriptorFromClientSource` synthesised, where that field IS the mod's own
 * vouched hash and there is no Hub entry to be a second party.
 *
 * The mod joins an index-anchored hash whenever it vouched the same value,
 * which after `checkCompat` is every time it vouched at all. Naming only the
 * index there would understate the finding: the bytes disagree with the mod the
 * operator installed, not just with a catalogue entry.
 */
function vouchersFor(
  version: UplinkVersionDescriptor,
  roster: RosterEntry | undefined,
  integrityAnchor: UplinkIntegrityParty,
): UplinkIntegrityParty[] {
  if (integrityAnchor === "installed-mod") return ["installed-mod"];
  return roster?.expectedClientHash === version.integrity
    ? ["installed-mod", "hub-index"]
    : ["hub-index"];
}

/** Pick the highest-version descriptor entry (design: the Hub offers a version list). */

/** Pick the highest-version descriptor entry: an index entry may list several. */
function pickVersion(
  descriptor: UplinkDescriptor,
): UplinkVersionDescriptor | undefined {
  const sorted = [...descriptor.versions].sort((a, b) => {
    const pa = parseSemver(a.version);
    const pb = parseSemver(b.version);
    if (!pa || !pb) return 0;
    return pb.major - pa.major || pb.minor - pa.minor || pb.patch - pa.patch;
  });
  return sorted[0];
}

/**
 * Map a registry descriptor + one of its version lines into core's
 * `GonogoUplinkManifest` shape: the input `checkUplinkCompat` gates on. See
 * the doc comment on `UplinkVersionDescriptor` (registry.ts) for why these
 * are two distinct types (index entry vs. build-shipped manifest) rather
 * than one merged shape.
 */
function toCompatManifest(
  descriptor: UplinkDescriptor,
  version: UplinkVersionDescriptor,
): GonogoUplinkManifest {
  return {
    id: descriptor.id,
    version: version.version,
    minAppVersion: version.minAppVersion,
    apiVersion: version.apiVersion,
    uiKitVersion: version.uiKitVersion,
    contractMajor: version.contractMajor,
    contractMinor: version.contractMinor,
    integrity: version.integrity,
  };
}

/**
 * What `checkCompat` found that the rest of `loadOne` has to act on. Only the
 * skew override so far, and it has to travel: it changes which party anchors
 * the byte check, and the arm that would otherwise re-assert the mod's hash
 * against the digest sits after the fetch.
 */
interface CompatVerdict {
  skewOverridden: boolean;
}

/**
 * The compat + roster + mod-hash gate; runs BEFORE any bytes are fetched
 * (design §5 step 3). The VERSION verdict itself (apiVersion/uiKitVersion/
 * contractMajor/contractMinor/minAppVersion: design §6.3) is delegated
 * whole to core's `checkUplinkCompat`, the single source of truth for that
 * rule table; this function keeps only the orchestration core doesn't know
 * about: roster availability and the mod-hash gate (design §3.3), both
 * app-side concerns with no equivalent in the pure manifest-vs-identity
 * check.
 */
function checkCompat(
  descriptor: UplinkDescriptor,
  version: UplinkVersionDescriptor,
  ctx: LoaderContext,
  roster: RosterEntry | undefined,
): CompatVerdict {
  const manifest = toCompatManifest(descriptor, version);
  const app: AppCompatIdentity = {
    apiVersion: ctx.hostCompat.apiVersion,
    uiKitVersion: ctx.hostCompat.uiKitVersion,
    contractMajor: ctx.hostCompat.contractMajor,
    contractMinor: ctx.hostCompat.contractMinor,
    appVersion: ctx.appVersion,
  };
  const verdict = checkUplinkCompat(manifest, app);
  if (verdict.verdict === "refuse") {
    refuse(verdict.reason);
  }
  if (verdict.verdict === "warn-load") {
    // Advisory only (minAppVersion floor): log and continue loading.
    logger.warn(`[uplink-loader] ${version.version}: ${verdict.reason}`);
  }

  // Roster availability: only refuse on an EXPLICIT unavailable report. Absence
  // of a roster entry (no mod talking yet) is not a refusal; see LoaderContext.
  if (roster && !roster.available) {
    refuse(
      `mod reports Uplink unavailable${roster.reason ? `: ${roster.reason}` : ""}`,
    );
  }

  /*
   * Mod-hash gate (design §3.3 row B, the H_mod == H_index half, checked here,
   * before fetch). Unenforceable until the mod emits `expectedClientHash`, which
   * no bundled Uplink did until Kos and MechJeb were armed on 2026-09-01.
   *
   * ## What arming changed, and why this gate keeps its shape anyway
   *
   * This is a hash equality test standing in for a VERSION question, and it
   * cannot tell "different" from "incompatible": an operator whose CKAN mod is
   * one release behind the web app now loses those Uplinks entirely, with a
   * refusal that reads like tampering. `checkUplinkCompat` above is the
   * instrument for compatibility and it has already ruled.
   *
   * The reason it is not simply demoted to an advisory is that the descriptor is
   * a PACKAGE: the version metadata, the bundleUrl and the integrity come from
   * one index entry, and `checkUplinkCompat` gated on that metadata. Fetching
   * past a hash the mod contradicts means loading bytes whose compat was decided
   * from a description of something else.
   *
   * The durable fix is not here. It is to let the mod anchor the load the way
   * `loadThirdParty` already does: `clientSource` for the URL,
   * `expectedClientHash` for the hash, and the bundle's own `gonogo-uplink.json`
   * for its compat metadata, at which point there is no index claim left to
   * disagree with and skew is answered by the compat table alone. That path is
   * built; nothing in `mod/` populates `clientSource` yet.
   */
  if (roster?.expectedClientHash != null) {
    if (roster.expectedClientHash !== version.integrity) {
      /*
       * A DECLARATION disagreement, and the only integrity finding an operator
       * may load past. Nothing has been fetched: the mod expects one build, the
       * index offers another, and both are honest descriptions of builds that
       * exist. A dev-channel app against a release-channel mod produces exactly
       * this, and refusing it outright leaves the operator with no route back.
       *
       * The record is what makes the two refusals in this file
       * distinguishable at the point a surface renders them. Before this, the
       * arm below called plain `refuse` and produced a bare reason string, so
       * skew was indistinguishable from a compat gate without matching prose,
       * while the post-fetch bytes mismatch already carried a record. Now both
       * carry one and `isOverridableIntegrityFailure` tells them apart on the
       * `subject`, never on the wording.
       */
      const failure: UplinkIntegrityFailure = {
        subject: "declaration",
        observed: version.integrity,
        observedBy: ["hub-index"],
        expected: roster.expectedClientHash,
        vouchedBy: ["installed-mod"],
      };
      if (hasSkewOverride(descriptor.id, version.version, failure)) {
        logger.warn(
          `[uplink-loader] ${descriptor.id}@${version.version}: loading past ` +
            `mod/index hash skew on a recorded operator override (mod ` +
            `${roster.expectedClientHash}, index ${version.integrity}); the ` +
            "bundle is still verified against the index hash",
        );
        return { skewOverridden: true };
      }
      refuseIntegrity(
        failure,
        `mod expects client ${roster.expectedClientHash}, index offers ${version.integrity} (version skew, reconcile mod/client)`,
      );
    }
  }
  return { skewOverridden: false };
}

/** `sha256-<hex>` of the given bytes, or a refusal when crypto.subtle is absent. */
async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    // Non-secure origin (e.g. http://192.168.x.x): cannot verify. Refusing and
    // saying why is the whole model; silently skipping the hash defeats it (D3).
    refuse(
      "cannot verify integrity: crypto.subtle unavailable (non-secure origin), serve the main screen over https or localhost",
    );
  }
  const digest = await subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256-${hex}`;
}

async function defaultFetchBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) refuse(`bundle fetch failed: HTTP ${res.status}`);
  return res.arrayBuffer();
}

async function defaultImportBundle(
  bytes: ArrayBuffer,
  url: string,
): Promise<unknown> {
  /*
   * Import the VERIFIED bytes, never the URL again.
   *
   * A blob URL addresses the exact buffer `loadOne` hashed, so the module that
   * executes is the module that passed the integrity check. Re-importing `url`
   * would be a second download nothing verifies, which is what this replaces.
   *
   * `type: "text/javascript"` is required, not decoration: the browser refuses
   * to import a blob whose MIME type is not a JavaScript one, and the default
   * for a typeless Blob is the empty string.
   *
   * Bare imports inside the bundle still resolve through the page's baked import
   * map, exactly as they did from an https URL: an import map is keyed by
   * specifier and does not care what the importing module's own URL scheme is.
   */
  const blobUrl = URL.createObjectURL(
    new Blob([bytes], { type: "text/javascript" }),
  );
  try {
    // @vite-ignore: a runtime URL, NOT an app-graph module.
    return await import(/* @vite-ignore */ blobUrl);
  } catch (err) {
    // The blob URL is meaningless to a reader, so name the source it came from.
    throw new Error(
      `import of ${url} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    // The module stays live in the realm's module map once evaluated; only the
    // URL->blob entry is released. Skipping it leaks one blob per Uplink load,
    // permanently.
    URL.revokeObjectURL(blobUrl);
  }
}

async function defaultFetchManifest(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(`manifest fetch failed: HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

/**
 * Derive a client bundle's manifest-sidecar URL by convention: same
 * directory as the bundle, filename `gonogo-uplink.json`, the name already
 * named (but not yet load-bearing) in two doc comments predating this
 * follow-on: `UplinkClientHandle.id` (core's `uplinkClients.ts`: "MUST
 * match ... its gonogo-uplink.json id") and `parseUplinkManifest` (core's
 * `uplinkVersionCompat.ts`: "as fetched from a bundle's sidecar
 * `gonogo-uplink.json`"). This function is what makes that convention real:
 * it's the ONE place the sidecar filename is spelled out, so a future rename
 * only touches here.
 *
 * Plain string slicing, not `new URL(rel, base)`: a `clientSource.url`/
 * `devPath` MAY be a bare path with no origin (a same-origin fixture in
 * dev/test), and `URL`'s relative-base form throws when the base itself
 * isn't an absolute URL: string slicing works for both a bare path and a
 * full `http://host:port/...` URL uniformly.
 */
export function manifestUrlFor(bundleUrl: string): string {
  const idx = bundleUrl.lastIndexOf("/");
  const dir = idx === -1 ? "" : bundleUrl.slice(0, idx + 1);
  return `${dir}gonogo-uplink.json`;
}

/**
 * Resolve which of `clientSource`'s two URLs the loader actually fetches from,
 * plus which one was picked (for logging, the precedence itself is a
 * meaningful runtime decision, never silent). `devPath` (a third-party
 * author's local dev-server loop) wins over `url` (the distributable release
 * bundle) when present, matching the doc comment on `RosterEntry.clientSource`.
 */
export function resolveClientBundleUrl(clientSource: {
  url: string;
  devPath: string | null;
}): { url: string; picked: "devPath" | "url" } {
  if (clientSource.devPath)
    return { url: clientSource.devPath, picked: "devPath" };
  return { url: clientSource.url, picked: "url" };
}

/**
 * Build an `UplinkDescriptor` for a third-party Uplink, one the mod reports
 * installed with NO matching entry in the local registry index, only a
 * self-declared `clientSource` (D5): from that `clientSource` plus the
 * bundle's own parsed manifest sidecar. Pure: no I/O, no logging, so it's
 * fully unit-testable from a fixture roster entry + fixture manifest without
 * a live third-party host (`loadThirdParty` below is the impure caller that
 * does the actual manifest fetch and feeds this function the result).
 *
 * Field provenance, each a deliberate call (logged here, not just in code):
 *   - `bundleUrl`: `resolveClientBundleUrl(roster.clientSource)`, devPath
 *     when present, else url.
 *   - `integrity`: `roster.expectedClientHash` (REQUIRED, the caller must
 *     guard this non-null before calling; see `loadThirdParty`). For a
 *     an indexed descriptor, `integrity` is H_index (the build-published
 *     hash) and `roster.expectedClientHash` is the SEPARATE H_mod arm the
 *     three-way check reconciles against it. A third-party id has no
 *     index entry at all, so there is no independent H_index
 *     to serve as the trust anchor: the mod's own vouched hash is the ONLY
 *     anchor available, so it fills the `integrity` slot directly. This
 *     collapses the "three-way" agreement to two arms for a third-party
 *     bundle (mod-vouched-hash == fetched-bytes-hash), which is still a real
 *     hash gate, just not a three-independent-party one, there IS no third
 *     independent party here.
 *   - `name`/`author`/`repo`: the roster's where the mod declares them, the
 *     bundle's own manifest where it does not, and `identity` records which
 *     of the two each value came from so the consent surfaces can say so.
 *     An Uplink is a mod in its own right and its declared author and repo
 *     are what an operator wants to see; withholding them and printing
 *     `by unknown` is not safer, only less useful. What must survive is the
 *     DISTINCTION, and that lives in `identity`, never in the flat fields.
 *   - the compat fields (apiVersion/uiKitVersion/contractMajor/
 *     contractMinor/minAppVersion) come straight from the parsed manifest,
 *     this is the whole point of the manifest-fetch seam: it's the one place
 *     a `clientSource`-only id's compat identity comes from, since there is
 *     no local index entry to hold them instead.
 */
export function descriptorFromClientSource(
  roster: RosterEntry,
  manifest: GonogoUplinkManifest,
): UplinkDescriptor {
  if (!roster.clientSource) {
    throw new Error(
      `descriptorFromClientSource: ${roster.id} has no clientSource`,
    );
  }
  if (roster.expectedClientHash == null) {
    throw new Error(
      `descriptorFromClientSource: ${roster.id} has no expectedClientHash ` +
        "(caller must guard this before building a third-party descriptor)",
    );
  }
  const { url: bundleUrl } = resolveClientBundleUrl(roster.clientSource);
  const identity = resolveUplinkIdentity(roster.id, roster, manifest);
  return {
    id: roster.id,
    /*
     * The flat fields stay the plain display values every existing consumer
     * reads. Empty is absent: a field nobody declared renders nothing rather
     * than a stand-in that reads like a value.
     */
    name: identity.name.value,
    author: identity.author?.value ?? "",
    repo: identity.repo?.value ?? "",
    identity,
    versions: [
      {
        version: manifest.version,
        minAppVersion: manifest.minAppVersion,
        apiVersion: manifest.apiVersion,
        uiKitVersion: manifest.uiKitVersion,
        contractMajor: manifest.contractMajor,
        contractMinor: manifest.contractMinor,
        bundleUrl,
        integrity: roster.expectedClientHash,
        expectedClientHash: roster.expectedClientHash,
      },
    ],
  };
}

/**
 * A descriptor's identity with its provenance. `descriptorFromClientSource`
 * has already worked one out from the roster and the manifest; anything else
 * came out of the published registry index, an artifact separate from the
 * bundle bytes it describes, so it is index-listed rather than self-declared.
 */
export function descriptorIdentity(
  descriptor: UplinkDescriptor,
): UplinkIdentity {
  return descriptor.identity ?? registryIdentity(descriptor);
}

function quarantineOutcome(
  id: string,
  reason: string,
  identity?: UplinkIdentity,
  integrity?: UplinkIntegrityFailure,
): UplinkLoadOutcome {
  const outcome: UplinkLoadOutcome = {
    id,
    name: identity?.name.value ?? id,
    identity,
    status: "quarantined",
    reason,
    integrity,
  };
  setUplinkOutcome(outcome);
  logger.warn(`[uplink-loader] ${id} quarantined: ${reason}`);
  return outcome;
}

/**
 * Load a third-party Uplink end-to-end: fetch its manifest sidecar, build a
 * descriptor from it + `clientSource`, then hand off to the SAME `loadOne`
 * gate → consent → fetch → hash → import sequence a first-party Uplink runs
 * (design §5): the only difference from the first-party path is where the
 * descriptor comes from, never how it's subsequently gated/loaded.
 *
 * `roster.expectedClientHash == null` refuses BEFORE any fetch (manifest or
 * bundle): a third-party id has no index entry, so an absent
 * mod-vouched hash means there is no integrity anchor at all, loading
 * hash-blind would be exactly the silent-trust gap D3 exists to close.
 */
async function loadThirdParty(
  id: string,
  roster: RosterEntry,
  ctx: LoaderContext,
): Promise<UplinkLoadOutcome> {
  /*
   * Everything before the manifest arrives can only be named by the mod, so
   * every refusal below carries the mod-vouched half of the identity and none
   * of the bundle's: a quarantined Uplink is still one an operator has to
   * recognise, and here the bundle has not spoken yet.
   */
  const modIdentity = resolveUplinkIdentity(id, roster, {});
  setUplinkOutcome({
    id,
    name: modIdentity.name.value,
    identity: modIdentity,
    status: "loading",
  });

  if (!roster.clientSource) {
    // Guarded by the caller (`loadEnabledUplinks` only calls this when
    // `roster.clientSource` is present), defensive only.
    return quarantineOutcome(
      id,
      "no clientSource on the roster entry",
      modIdentity,
    );
  }
  const { url: bundleUrl, picked } = resolveClientBundleUrl(
    roster.clientSource,
  );
  logger.info(
    `[uplink-loader] ${id}: third-party client, resolved bundleUrl from ` +
      `clientSource.${picked} (${bundleUrl})`,
  );

  if (roster.expectedClientHash == null) {
    return quarantineOutcome(
      id,
      "third-party Uplink has no mod-vouched client hash " +
        "(expectedClientHash absent): refusing hash-blind load",
      modIdentity,
    );
  }

  const manifestUrl = manifestUrlFor(bundleUrl);
  const fetchManifest = ctx.fetchManifest ?? defaultFetchManifest;
  let manifest: GonogoUplinkManifest;
  try {
    const raw = await fetchManifest(manifestUrl);
    manifest = parseUplinkManifest(raw);
  } catch (err) {
    return quarantineOutcome(
      id,
      `third-party manifest fetch/parse failed (${manifestUrl}): ` +
        `${err instanceof Error ? err.message : String(err)}`,
      modIdentity,
    );
  }

  if (manifest.integrity !== roster.expectedClientHash) {
    // Hard refuse BEFORE import (operator ruling 2026-07-25). The mod and its
    // client bundle ship as one release, so a self-declared manifest integrity
    // that disagrees with the mod-vouched expectedClientHash is a real fault
    // (mod/client version skew, or a tampered manifest), never an expected
    // state: quarantine-with-reason like every other integrity gate rather
    // than loading past it. This is the manifest-declared vs mod-vouched
    // agreement; the bytes-hash verification in `loadOne` is separate and
    // stays as-is.
    return quarantineOutcome(
      id,
      `manifest-declared integrity (${manifest.integrity}) != mod-vouched ` +
        `expectedClientHash (${roster.expectedClientHash}): mod/client ` +
        "version skew (they release together), refusing before import",
      modIdentity,
      {
        subject: "manifest",
        observed: manifest.integrity,
        expected: roster.expectedClientHash,
        vouchedBy: ["installed-mod"],
      },
    );
  }

  const descriptor = descriptorFromClientSource(roster, manifest);
  // The mod is the anchor here: `descriptorFromClientSource` fills `integrity`
  // from `expectedClientHash`, so there is no Hub index in this story at all.
  return loadOne(descriptor, ctx, "installed-mod");
}

/**
 * Load one Uplink end-to-end, returning its outcome (never throws).
 *
 * `integrityAnchor` names who vouched `version.integrity`, and changes nothing
 * about the check: it is what an integrity failure NAMES. A descriptor read out
 * of the published index was vouched by the Hub; one built from a
 * `clientSource` carries the mod's own hash in that slot, with no Hub entry
 * behind it, so a failure there must not credit an index that never spoke.
 */
async function loadOne(
  descriptor: UplinkDescriptor,
  ctx: LoaderContext,
  integrityAnchor: UplinkIntegrityParty = "hub-index",
): Promise<UplinkLoadOutcome> {
  const identity = descriptorIdentity(descriptor);
  const base: UplinkLoadOutcome = {
    id: descriptor.id,
    name: descriptor.name,
    identity,
    status: "loading",
  };
  setUplinkOutcome(base);

  try {
    const version = pickVersion(descriptor);
    if (!version) refuse("no versions listed in the registry");
    base.version = version.version;

    const roster = ctx.roster?.find((r) => r.id === descriptor.id);

    // Gate BEFORE fetch (design §5 step 3).
    const { skewOverridden } = checkCompat(descriptor, version, ctx, roster);

    // Consent gates the fetch (design §5 step 4: consent between gate and fetch).
    // First-party ids are NOT pre-trusted, a first load at a new id@version asks
    // the operator; a remembered grant short-circuits. Decline quarantines with a
    // legible reason. Bytes are never fetched for a declined Uplink.
    const ensure = ctx.ensureConsent ?? ensureConsent;
    const consented = await ensure({
      id: descriptor.id,
      name: descriptor.name,
      version: version.version,
      author: descriptor.author || undefined,
      identity,
    });
    if (!consented) refuse("consent declined");

    // Fetch, then verify the bytes BEFORE import (design §5 step 5).
    // `version.integrity` is threaded through as `expectedHash` (D6) so a
    // peer-backed `fetchBytes` can hand it to the host for verification,
    // see the doc comment on `LoaderContext.fetchBytes`.
    const fetchBytes = ctx.fetchBytes ?? defaultFetchBytes;
    const bytes = await fetchBytes(version.bundleUrl, version.integrity);
    const digest = await sha256Hex(bytes);

    /*
     * The reason string names the party whose claim the bytes missed, and the
     * INSTALLED MOD outranks the index whenever it vouched.
     *
     * It said "index" unconditionally until 2026-09-01, on every path, and that
     * was already wrong for a third-party `clientSource` load, where the mod
     * supplies the hash and there is no index entry in the story at all. It
     * became wrong for the bundled Uplinks too the moment their DLLs started
     * carrying a real `ExpectedClientHash`: "these bytes are not what the mod you
     * installed vouches for" is the more serious of the two readings and the one
     * an operator can act on, and `vouchedBy` had been carrying it while the line
     * a human reads did not.
     */
    const vouchedBy = vouchersFor(version, roster, integrityAnchor);
    if (digest !== version.integrity) {
      refuseIntegrity(
        {
          subject: "bundle",
          observed: digest,
          expected: version.integrity,
          vouchedBy,
        },
        `bundle hash ${digest} != ${
          vouchedBy.includes("installed-mod") ? "mod-expected" : "index"
        } ${version.integrity} (tampered or wrong URL)`,
      );
    }
    /*
     * Unreachable on the ordinary path, and kept anyway.
     *
     * `checkCompat` refuses before the fetch whenever `expectedClientHash`
     * differs from `version.integrity`, so reaching this line NORMALLY means
     * the two are equal and the check above already fired on the same digest,
     * naming the mod. "Normally" is load-bearing: see `skewOverridden` below.
     * Nothing here is a second, independent verification of the bytes, and
     * reading the two refusal strings as evidence of one would be wrong: the
     * mod-hash arm is reconciled against the index BEFORE any bytes exist, and
     * the bytes are then checked once, against the hash both parties agreed on.
     *
     * `skewOverridden` is the one state where the two are NOT equal and the
     * bytes were still verified, so this arm is skipped by construction rather
     * than by luck. Skipping it is the entire content of the override: the
     * operator chose the index as the anchor, and asserting the mod's hash here
     * would re-impose the disagreement they just resolved and quarantine an
     * Uplink whose bytes passed. What is NOT skipped, and cannot be, is the
     * digest check above.
     */
    if (roster?.expectedClientHash != null && !skewOverridden) {
      if (digest !== roster.expectedClientHash) {
        refuseIntegrity(
          {
            subject: "bundle",
            observed: digest,
            expected: roster.expectedClientHash,
            vouchedBy: ["installed-mod"],
          },
          `bundle hash ${digest} != mod-expected ${roster.expectedClientHash} (verification failure)`,
        );
      }
    }

    // Verified. import() runs the bundle's module-load registerComponent(...),
    // registration is a side effect of import, so nothing before this line may be
    // skipped.
    // `bytes`, the buffer just hashed above, NOT `version.bundleUrl`. Handing
    // the URL here would let the executed module be a different download from
    // the verified one, which is the hole this closes.
    const importBundle = ctx.importBundle ?? defaultImportBundle;
    const start = performance.now();
    await importBundle(bytes, version.bundleUrl);
    const ms = Math.round(performance.now() - start);

    let modHashNote = "";
    if (roster?.expectedClientHash == null) {
      modHashNote =
        " (mod-hash arm pending: mod does not yet emit expectedClientHash)";
    } else if (skewOverridden) {
      // Loud on the loaded row, not only in the log. An Uplink running past a
      // recorded override is a different state from one that passed clean, and
      // the operator surface reads this string.
      modHashNote =
        ` (loaded on an operator skew override: mod expects ${roster.expectedClientHash},` +
        ` index offered ${version.integrity}; bytes verified against the index hash)`;
    }
    const outcome: UplinkLoadOutcome = {
      id: descriptor.id,
      name: descriptor.name,
      identity,
      version: version.version,
      status: "loaded",
      reason: `verified + loaded in ${ms}ms${modHashNote}`,
    };
    setUplinkOutcome(outcome);
    logger.info(
      `[uplink-loader] ${descriptor.id}@${version.version} loaded (${ms}ms)${modHashNote}`,
    );
    return outcome;
  } catch (err) {
    const reason =
      err instanceof LoadRefusal
        ? err.message
        : `load failed: ${err instanceof Error ? err.message : String(err)}`;
    const outcome: UplinkLoadOutcome = {
      id: descriptor.id,
      name: descriptor.name,
      identity,
      version: base.version,
      status: "quarantined",
      reason,
      integrity: err instanceof IntegrityRefusal ? err.failure : undefined,
    };
    setUplinkOutcome(outcome);
    logger.warn(`[uplink-loader] ${descriptor.id} quarantined: ${reason}`);
    return outcome;
  }
}

/**
 * Derive the set of ids `loadEnabledUplinks` attempts, per the operator
 * decision (2026-07-24) that the installed-mod roster drives the loader
 * rather than a static id list:
 *
 *   - `roster` PRESENT (the mod answered, even with an empty list) → enable
 *     exactly the ids the roster reports INSTALLED that either (a) have a
 *     descriptor in `index` (the build-emitted `registry.local.json`), OR (b)
 *     have no index descriptor but DO carry a self-declared `clientSource`
 *     (D5), in which case `loadEnabledUplinks` builds a descriptor from that
 *     plus the bundle's own manifest sidecar (see `descriptorFromClientSource`
 *     / `loadThirdParty`). An installed id with NEITHER is excluded: there is
 *     nothing to fetch for it.
 *
 *     "Installed" ignores the `available` flag, so a mod-reported-unavailable
 *     id is still attempted and falls to `checkCompat`'s availability veto,
 *     which quarantines it with a legible reason. Excluding it here instead
 *     would silently drop it with no outcome at all, which is strictly less
 *     visible than a "quarantined: mod reports Uplink unavailable" row.
 *   - `roster` ABSENT (`undefined`, no mod talking: dev / e2e / offline
 *     first boot) → nothing. There is deliberately no shipped fallback list:
 *     one would have to name ids, and an id named here is a path a third-party
 *     author's Uplink could never reach. Nothing has said what is installed, so
 *     nothing is attempted, and the roster or an explicit `override` is what
 *     says otherwise.
 */
function deriveEnabledIds(
  roster: RosterEntry[] | undefined,
  index: RegistryIndex,
  override?: readonly string[],
): string[] {
  // An EXPLICIT `?uplinkLoaderIds=` override is a deliberate intent and wins
  // outright over the roster. `[]` (empty `?uplinkLoaderIds=`) is a meaningful
  // "load nothing" and is honoured too; only `undefined` (no override param)
  // defers to the roster below.
  if (override !== undefined) return [...override];
  if (!roster) return [];
  const indexed = new Set(index.uplinks.map((descriptor) => descriptor.id));
  return roster
    .filter((entry) => indexed.has(entry.id) || entry.clientSource != null)
    .map((entry) => entry.id);
}

/**
 * Load every enabled Uplink from the registry. Reads the index once, derives
 * the enabled set from the live roster (`deriveEnabledIds`), then loads each
 * enabled id independently (one bad Uplink never blocks a good one). Returns
 * every outcome; also written to the loader-state store for the Uplinks list.
 */
export async function loadEnabledUplinks(
  ctx: LoaderContext,
): Promise<UplinkLoadOutcome[]> {
  let index: Awaited<ReturnType<typeof fetchRegistry>>;
  try {
    index = await fetchRegistry(ctx.registrySource);
  } catch (err) {
    // A registry we can't read means we also can't derive the roster-driven
    // enabled set (that join needs `index`), so quarantine the ids we WOULD
    // have attempted with the reason attached: a dead registry has to be
    // visible rather than a silently blank dashboard. An override names them
    // outright; otherwise every roster id counts, including ones the join
    // might have excluded, because without the index we cannot tell which.
    const reason = `registry unavailable: ${
      err instanceof Error ? err.message : String(err)
    }`;
    logger.warn(`[uplink-loader] ${reason}`);
    const attempted = ctx.override ?? ctx.roster?.map((r) => r.id) ?? [];
    return attempted.map((id) => {
      const outcome: UplinkLoadOutcome = {
        id,
        name: id,
        status: "quarantined",
        reason,
      };
      setUplinkOutcome(outcome);
      return outcome;
    });
  }

  const effectiveIds = deriveEnabledIds(ctx.roster, index, ctx.override);
  const outcomes: UplinkLoadOutcome[] = [];
  for (const id of effectiveIds) {
    const descriptor = index.uplinks.find((u) => u.id === id);
    if (descriptor) {
      outcomes.push(await loadOne(descriptor, ctx));
      continue;
    }
    // No first-party descriptor: `deriveEnabledIds` only put this id in
    // `effectiveIds` without one because the roster carries a `clientSource`
    // for it (D5-loader follow-on), so build+load via that path instead.
    // The plain "not found in the registry index" quarantine below is now
    // unreachable via the roster-driven path (kept as a defensive fallback
    // for a caller that hand-supplies an `override` naming an id that's in
    // neither the index nor the roster at all).
    const rosterEntry = ctx.roster?.find((r) => r.id === id);
    if (rosterEntry?.clientSource) {
      outcomes.push(await loadThirdParty(id, rosterEntry, ctx));
      continue;
    }
    const outcome: UplinkLoadOutcome = {
      id,
      name: id,
      status: "quarantined",
      reason: "not found in the registry index",
    };
    setUplinkOutcome(outcome);
    outcomes.push(outcome);
  }
  return outcomes;
}
