// The production Uplink client loader (design §5 — the load sequence).
//
// For each enabled Uplink the loader, IN ORDER: (1) resolves a version from the
// registry descriptor, (2) runs the compat gates + mod-hash gate BEFORE fetching
// any bytes — because import() IS registration and is irreversible, (3) fetches
// the bundle, (4) verifies sha256(bytes) against the descriptor (three-way when
// the mod ships its hash), (5) import()s so the bundle's registerComponent(...)
// runs against the injected host. Every refusal quarantines with a legible reason
// surfaced in the in-app Uplinks list — never a silent load, never a silent no-op.

import {
  type AppCompatIdentity,
  checkUplinkCompat,
  type GonogoUplinkManifest,
  parseSemver,
} from "@ksp-gonogo/core";
import { logger } from "@ksp-gonogo/logger";
import { type ConsentInfo, ensureConsent } from "./consent";
import type { HostCompat } from "./hostCompat";
import { setUplinkOutcome, type UplinkLoadOutcome } from "./loaderState";
import {
  fetchRegistry,
  type RegistryIndex,
  type RegistrySource,
  type UplinkDescriptor,
  type UplinkVersionDescriptor,
} from "./registry";
import { computeUplinkGapEntries } from "./rosterGap";

/** One entry of the live `system.uplinks` roster the loader consults (design §3.2). */
export interface RosterEntry {
  id: string;
  version: string;
  available: boolean;
  reason: string | null;
  /**
   * H_mod — the client hash the running mod vouches for. Absent in Phase A (the
   * mod does not yet bake/emit it); when present the loader enforces the full
   * three-way agreement, otherwise it enforces the two-way index==bytes check and
   * records the mod-hash arm as pending.
   */
  expectedClientHash?: string | null;
}

export interface LoaderContext {
  /** Where to read the registry index (Phase A: local fixture; Phase D: the Hub). */
  registrySource: RegistrySource;
  /**
   * The DEFAULT Uplink ids to load via the runtime path (first-party,
   * flag-gated). Operator decision 2026-07-24: the installed-mod roster is
   * the source of truth for what loads — when `roster` is present,
   * `loadEnabledUplinks` derives the enabled set from it instead (see
   * `deriveEnabledIds`) and this field is IGNORED. `enabledIds` only takes
   * effect as the degraded-boot fallback, when `roster` is `undefined` (no
   * mod talking — dev / e2e / offline first boot): the client half still
   * loads on the shipped default rather than loading nothing.
   */
  enabledIds: string[];
  /** The app's compat identity — gated against each descriptor's declared versions. */
  hostCompat: HostCompat;
  /** The app's own version, for the advisory minAppVersion check. */
  appVersion: string;
  /**
   * The live `system.uplinks` roster, if a stream is mounted. Optional: with no
   * KSP connected (dev / e2e / offline first boot) the client half still loads —
   * the mod-only-without-client degraded shape is a legitimate state, and refusing
   * to load a client just because no mod is talking yet would be the wrong default.
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
   * Import a bundle URL. Injected so tests can drive the loader without a real
   * network `import()`. Defaults to a `@vite-ignore` dynamic import of the URL.
   */
  importBundle?: (url: string) => Promise<unknown>;
  /** Fetch bundle bytes. Injected for tests; defaults to `fetch`. */
  fetchBytes?: (url: string) => Promise<ArrayBuffer>;
}

/** A refusal: the loader stops here and quarantines with this reason. */
class LoadRefusal extends Error {}

function refuse(reason: string): never {
  throw new LoadRefusal(reason);
}

/** Pick the highest-version descriptor entry (design: the Hub offers a version list). */
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
 * `GonogoUplinkManifest` shape — the input `checkUplinkCompat` gates on. See
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
 * The compat + roster + mod-hash gate — runs BEFORE any bytes are fetched
 * (design §5 step 3). The VERSION verdict itself (apiVersion/uiKitVersion/
 * contractMajor/contractMinor/minAppVersion — design §6.3) is delegated
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
): void {
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
    // Advisory only (minAppVersion floor) — log and continue loading.
    logger.warn(`[uplink-loader] ${version.version}: ${verdict.reason}`);
  }

  // Roster availability: only refuse on an EXPLICIT unavailable report. Absence
  // of a roster entry (no mod talking yet) is not a refusal — see LoaderContext.
  if (roster && !roster.available) {
    refuse(
      `mod reports Uplink unavailable${roster.reason ? `: ${roster.reason}` : ""}`,
    );
  }

  // Mod-hash gate (design §3.3 row B, the H_mod == H_index half — checked here,
  // before fetch). Only enforceable once the mod emits expectedClientHash.
  if (roster?.expectedClientHash != null) {
    if (roster.expectedClientHash !== version.integrity) {
      refuse(
        `mod expects client ${roster.expectedClientHash}, Hub offers ${version.integrity} (version skew — reconcile mod/client)`,
      );
    }
  }
}

/** `sha256-<hex>` of the given bytes, or a refusal when crypto.subtle is absent. */
async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    // Non-secure origin (e.g. http://192.168.x.x) — cannot verify. Refusing and
    // saying why is the whole model; silently skipping the hash defeats it (D3).
    refuse(
      "cannot verify integrity: crypto.subtle unavailable (non-secure origin) — serve the main screen over https or localhost",
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

function defaultImportBundle(url: string): Promise<unknown> {
  // @vite-ignore — a runtime URL, NOT an app-graph module. The browser fetches it
  // and resolves its bare imports through the page's baked import map.
  return import(/* @vite-ignore */ url);
}

/** Load one Uplink end-to-end, returning its outcome (never throws). */
async function loadOne(
  descriptor: UplinkDescriptor,
  ctx: LoaderContext,
): Promise<UplinkLoadOutcome> {
  const base: UplinkLoadOutcome = {
    id: descriptor.id,
    name: descriptor.name,
    status: "loading",
  };
  setUplinkOutcome(base);

  try {
    const version = pickVersion(descriptor);
    if (!version) refuse("no versions listed in the registry");
    base.version = version.version;

    const roster = ctx.roster?.find((r) => r.id === descriptor.id);

    // Gate BEFORE fetch (design §5 step 3).
    checkCompat(descriptor, version, ctx, roster);

    // Consent gates the fetch (design §5 step 4: consent between gate and fetch).
    // First-party ids are NOT pre-trusted — a first load at a new id@version asks
    // the operator; a remembered grant short-circuits. Decline quarantines with a
    // legible reason. Bytes are never fetched for a declined Uplink.
    const ensure = ctx.ensureConsent ?? ensureConsent;
    const consented = await ensure({
      id: descriptor.id,
      name: descriptor.name,
      version: version.version,
      author: descriptor.author,
    });
    if (!consented) refuse("consent declined");

    // Fetch, then verify the bytes BEFORE import (design §5 step 5).
    const fetchBytes = ctx.fetchBytes ?? defaultFetchBytes;
    const bytes = await fetchBytes(version.bundleUrl);
    const digest = await sha256Hex(bytes);

    if (digest !== version.integrity) {
      refuse(
        `bundle hash ${digest} != index ${version.integrity} (tampered or wrong URL)`,
      );
    }
    if (roster?.expectedClientHash != null) {
      if (digest !== roster.expectedClientHash) {
        refuse(
          `bundle hash ${digest} != mod-expected ${roster.expectedClientHash} (verification failure)`,
        );
      }
    }

    // Verified. import() runs the bundle's module-load registerComponent(...) —
    // registration is a side effect of import, so nothing before this line may be
    // skipped.
    const importBundle = ctx.importBundle ?? defaultImportBundle;
    const start = performance.now();
    await importBundle(version.bundleUrl);
    const ms = Math.round(performance.now() - start);

    const modHashNote =
      roster?.expectedClientHash == null
        ? " (mod-hash arm pending — mod does not yet emit expectedClientHash)"
        : "";
    const outcome: UplinkLoadOutcome = {
      id: descriptor.id,
      name: descriptor.name,
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
      version: base.version,
      status: "quarantined",
      reason,
    };
    setUplinkOutcome(outcome);
    logger.warn(`[uplink-loader] ${descriptor.id} quarantined: ${reason}`);
    return outcome;
  }
}

/**
 * Load a single Uplink by id via the runtime loader path (design §5), independent
 * of `ctx.enabledIds` — the seam the Hub-wizard setup-assist step uses to load just
 * the one Uplink an operator picked. Runs the same gate → consent → fetch → hash →
 * import sequence as `loadEnabledUplinks`, reusing the same `LoaderContext` DI seam
 * (so `ensureConsent`/`fetchBytes`/`importBundle` overrides work identically).
 */
export async function loadUplinkById(
  id: string,
  ctx: LoaderContext,
): Promise<UplinkLoadOutcome> {
  let index: Awaited<ReturnType<typeof fetchRegistry>>;
  try {
    index = await fetchRegistry(ctx.registrySource);
  } catch (err) {
    const reason = `registry unavailable: ${
      err instanceof Error ? err.message : String(err)
    }`;
    logger.warn(`[uplink-loader] ${reason}`);
    const outcome: UplinkLoadOutcome = {
      id,
      name: id,
      status: "quarantined",
      reason,
    };
    setUplinkOutcome(outcome);
    return outcome;
  }

  const descriptor = index.uplinks.find((u) => u.id === id);
  if (!descriptor) {
    const outcome: UplinkLoadOutcome = {
      id,
      name: id,
      status: "quarantined",
      reason: "not found in the registry index",
    };
    setUplinkOutcome(outcome);
    return outcome;
  }
  return loadOne(descriptor, ctx);
}

/**
 * Derive the set of ids `loadEnabledUplinks` attempts, per the operator
 * decision (2026-07-24) that the installed-mod roster drives the loader
 * rather than a static id list:
 *
 *   - `roster` PRESENT (the mod answered, even with an empty list) → enable
 *     exactly the ids the roster reports INSTALLED that also have a
 *     first-party descriptor in `index` (`registry.local.json` — first-party
 *     scope is deliberately just "exists in the local registry"; the
 *     mod-side self-describing-URL / third-party path is HELD, not built
 *     here). "Installed" here matches `computeUplinkGapEntries`'s own
 *     definition — present in the roster regardless of its `available` flag
 *     — so a mod-reported-unavailable id is still ENABLED (attempted) and
 *     falls to `checkCompat`'s existing per-descriptor availability veto,
 *     which quarantines it with a legible reason. Excluding it here instead
 *     would silently drop it with no outcome at all, which is strictly less
 *     visible than a "quarantined: mod reports Uplink unavailable" row.
 *   - `roster` ABSENT (`undefined` — no mod talking: dev / e2e / offline
 *     first boot) → fall back to `fallback` (`ctx.enabledIds`, i.e. the
 *     shipped `LOADER_UPLINK_IDS` default at the real boot call site). This
 *     preserves the degraded-boot rule on `LoaderContext.roster`: the client
 *     half still loads when no mod is talking yet.
 *
 * Reuses `computeUplinkGapEntries` — the SAME join the wizard's
 * `useUplinkGap` classifies `installed-no-client` gaps from (`../wizard/
 * useUplinkGap.ts`, via `./rosterGap.ts`) — rather than a second, parallel
 * roster×registry join that could silently drift from the wizard's. This
 * function only differs from the wizard's call in what it asks the join for:
 * the wizard reads `.state` (`load-from-hub` etc.) for its badge; this reads
 * `.installed` + `.hubDescriptor` directly, because "should the loader
 * attempt this" must include the `unavailable` state too (see above), which
 * `.state` alone can't distinguish from "not installed at all".
 */
function deriveEnabledIds(
  roster: RosterEntry[] | undefined,
  index: RegistryIndex,
  fallback: readonly string[],
): string[] {
  if (!roster) return [...fallback];
  const gapEntries = computeUplinkGapEntries(
    roster.map((r) => ({ id: r.id, available: r.available, reason: r.reason })),
    [],
    index,
  );
  return gapEntries
    .filter((entry) => entry.installed && entry.hubDescriptor !== null)
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
    // enabled set (that join needs `index`), so this falls back to whatever
    // `ctx.enabledIds` was given rather than attempting the derivation with
    // no registry — quarantining every one of those ids with the reason, so
    // the failure is visible rather than a blank dashboard.
    const reason = `registry unavailable: ${
      err instanceof Error ? err.message : String(err)
    }`;
    logger.warn(`[uplink-loader] ${reason}`);
    return ctx.enabledIds.map((id) => {
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

  const effectiveIds = deriveEnabledIds(ctx.roster, index, ctx.enabledIds);
  const outcomes: UplinkLoadOutcome[] = [];
  for (const id of effectiveIds) {
    const descriptor = index.uplinks.find((u) => u.id === id);
    if (!descriptor) {
      const outcome: UplinkLoadOutcome = {
        id,
        name: id,
        status: "quarantined",
        reason: "not found in the registry index",
      };
      setUplinkOutcome(outcome);
      outcomes.push(outcome);
      continue;
    }
    outcomes.push(await loadOne(descriptor, ctx));
  }
  return outcomes;
}
