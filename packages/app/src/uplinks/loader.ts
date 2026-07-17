// The production Uplink client loader (design §5 — the load sequence).
//
// For each enabled Uplink the loader, IN ORDER: (1) resolves a version from the
// registry descriptor, (2) runs the compat gates + mod-hash gate BEFORE fetching
// any bytes — because import() IS registration and is irreversible, (3) fetches
// the bundle, (4) verifies sha256(bytes) against the descriptor (three-way when
// the mod ships its hash), (5) import()s so the bundle's registerComponent(...)
// runs against the injected host. Every refusal quarantines with a legible reason
// surfaced in the in-app Uplinks list — never a silent load, never a silent no-op.

import { parseSemver } from "@ksp-gonogo/core";
import { logger } from "@ksp-gonogo/logger";
import type { HostCompat } from "./hostCompat";
import { setUplinkOutcome, type UplinkLoadOutcome } from "./loaderState";
import {
  fetchRegistry,
  type RegistrySource,
  type UplinkDescriptor,
  type UplinkVersionDescriptor,
} from "./registry";

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
  /** The Uplink ids to load via the runtime path (first-party, flag-gated). */
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

/** Compare two versions' major fields; `null` if either is unparseable. */
function majorMatch(a: string, b: string): boolean | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  return pa.major === pb.major;
}

/**
 * The compat + mod-hash gate — runs BEFORE any bytes are fetched (design §5 step
 * 3). apiVersion and uiKitVersion gate on the major line (a major bump is a
 * breaking API/design-system change); contractMajor must match exactly;
 * minAppVersion is advisory (warn, don't refuse).
 */
function checkCompat(
  version: UplinkVersionDescriptor,
  ctx: LoaderContext,
  roster: RosterEntry | undefined,
): void {
  const api = majorMatch(ctx.hostCompat.apiVersion, version.apiVersion);
  if (api === null) {
    refuse(
      `unreadable apiVersion (host ${ctx.hostCompat.apiVersion}, needs ${version.apiVersion})`,
    );
  }
  if (api === false) {
    refuse(
      `apiVersion incompatible: host ${ctx.hostCompat.apiVersion}, client built for ${version.apiVersion}`,
    );
  }

  const ui = majorMatch(ctx.hostCompat.uiKitVersion, version.uiKitVersion);
  if (ui === null) {
    refuse(
      `unreadable uiKitVersion (host ${ctx.hostCompat.uiKitVersion}, needs ${version.uiKitVersion})`,
    );
  }
  if (ui === false) {
    refuse(
      `uiKitVersion incompatible: host ${ctx.hostCompat.uiKitVersion}, client built for ${version.uiKitVersion}`,
    );
  }

  if (ctx.hostCompat.contractMajor !== version.contractMajor) {
    refuse(
      `contractMajor incompatible: host ${ctx.hostCompat.contractMajor}, client built for ${version.contractMajor}`,
    );
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

  // Advisory only.
  const appCmp = majorMatch(ctx.appVersion, version.minAppVersion);
  if (appCmp === false) {
    logger.warn(
      `[uplink-loader] ${version.version}: minAppVersion ${version.minAppVersion} is a major ahead of app ${ctx.appVersion} (advisory)`,
    );
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
    checkCompat(version, ctx, roster);

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
 * Load every enabled Uplink from the registry. Reads the index once, then loads
 * each enabled id independently (one bad Uplink never blocks a good one). Returns
 * every outcome; also written to the loader-state store for the Uplinks list.
 */
export async function loadEnabledUplinks(
  ctx: LoaderContext,
): Promise<UplinkLoadOutcome[]> {
  let index: Awaited<ReturnType<typeof fetchRegistry>>;
  try {
    index = await fetchRegistry(ctx.registrySource);
  } catch (err) {
    // A registry we can't read quarantines every enabled id with the reason, so
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

  const outcomes: UplinkLoadOutcome[] = [];
  for (const id of ctx.enabledIds) {
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
