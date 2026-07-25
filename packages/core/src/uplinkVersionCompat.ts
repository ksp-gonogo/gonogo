/**
 * Uplink Client Contract — version compatibility (design §6.2/§6.3).
 *
 * Pure logic only: the manifest shape, a validation helper, and the
 * compat-verdict function the loader will gate an `import()` behind. No
 * build-time injection, no sha/integrity computation, no wiring to real app
 * version sources — those are the loader's job (a later phase).
 *
 * Mod-agnostic like `uplinkClients.ts`/`uplinkHandles.ts`: never import a
 * mod-specific type or hardcode a mod name here.
 */

import { type ParsedSemver, parseSemver } from "./version/compare";

// TODO(api-version): bump deliberately as the @ksp-gonogo/core extension
// surface changes; this is a hand-managed gate, not the package version.
export const EXTENSION_API_VERSION = "1.0.0";

/**
 * The manifest an Uplink client bundle ships alongside (design §6.2). Every
 * field mirrors a `UplinkVersionDescriptor` value that today lives in
 * `packages/app/src/uplinks/registry.ts` — this is the pure, package-level
 * home for the shape and its compat rule, so the loader (and any future
 * consumer) doesn't need to reach into the app package for it.
 */
export interface GonogoUplinkManifest {
  id: string;
  version: string;
  minAppVersion: string;
  apiVersion: string;
  uiKitVersion: string;
  contractMajor: number;
  contractMinor: number;
  integrity: string;
}

const MANIFEST_STRING_FIELDS = [
  "id",
  "version",
  "minAppVersion",
  "apiVersion",
  "uiKitVersion",
  "integrity",
] as const satisfies readonly (keyof GonogoUplinkManifest)[];

const MANIFEST_NUMBER_FIELDS = [
  "contractMajor",
  "contractMinor",
] as const satisfies readonly (keyof GonogoUplinkManifest)[];

/** Typeguard: checks every field's presence and type. Doesn't validate that
 *  string fields are well-formed semver — `checkUplinkCompat` does that. */
export function isGonogoUplinkManifest(x: unknown): x is GonogoUplinkManifest {
  if (typeof x !== "object" || x === null) return false;
  const rec = x as Record<string, unknown>;
  for (const field of MANIFEST_STRING_FIELDS) {
    if (typeof rec[field] !== "string") return false;
  }
  for (const field of MANIFEST_NUMBER_FIELDS) {
    if (typeof rec[field] !== "number") return false;
  }
  return true;
}

/**
 * Parses and validates an Uplink manifest. Accepts either a raw JSON string
 * (as fetched from a bundle's sidecar `gonogo-uplink.json`) or an already-
 * parsed value. Throws a clear, specific error on malformed input rather
 * than returning a discriminated result — every call site here is a loader
 * boundary that should fail loudly and stop, not thread a result type
 * through; see decisions log in the task report for the reasoning.
 */
export function parseUplinkManifest(
  json: string | unknown,
): GonogoUplinkManifest {
  let candidate: unknown;
  if (typeof json === "string") {
    try {
      candidate = JSON.parse(json);
    } catch (err) {
      throw new Error(
        `parseUplinkManifest: invalid JSON — ${(err as Error).message}`,
      );
    }
  } else {
    candidate = json;
  }
  if (!isGonogoUplinkManifest(candidate)) {
    throw new Error(
      "parseUplinkManifest: malformed Uplink manifest — missing or " +
        `mistyped field(s); expected all of ${[...MANIFEST_STRING_FIELDS, ...MANIFEST_NUMBER_FIELDS].join(", ")}`,
    );
  }
  return candidate;
}

export type UplinkCompatVerdictKind = "load" | "refuse" | "warn-load";

export interface UplinkCompatVerdict {
  verdict: UplinkCompatVerdictKind;
  reason: string;
}

/** The app-side compat identity `checkUplinkCompat` gates a manifest against.
 *  Passed in by the caller (the future loader) — this module never reads a
 *  real app version source itself. */
export interface AppCompatIdentity {
  apiVersion: string;
  uiKitVersion: string;
  contractMajor: number;
  contractMinor: number;
  appVersion: string;
}

/** Full ordering compare (not just equality categorisation, unlike
 *  `compareVersions` in `./version/compare`) — needed for the minAppVersion
 *  "is the running app new enough" floor check. Negative if `a` < `b`. */
function compareSemverOrder(a: ParsedSemver, b: ParsedSemver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * The §6.3 compat-verdict rule table. Precedence when multiple rules would
 * independently refuse: apiVersion, then uiKitVersion, then contractMajor,
 * then contractMinor — the same order the fields are listed in §6.3 and in
 * `GonogoUplinkManifest` above. Any refuse wins over warn-load; minAppVersion
 * (the only warn-load-producing rule) is checked last, only once every
 * refuse gate has passed. `integrity` is never inspected here — the loader
 * checks that once the bytes are in hand.
 */
export function checkUplinkCompat(
  manifest: GonogoUplinkManifest,
  app: AppCompatIdentity,
): UplinkCompatVerdict {
  // -- apiVersion --
  const clientApi = parseSemver(manifest.apiVersion);
  const appApi = parseSemver(app.apiVersion);
  if (!clientApi || !appApi) {
    return {
      verdict: "refuse",
      reason: `apiVersion unparseable: client "${manifest.apiVersion}" vs app "${app.apiVersion}"`,
    };
  }
  if (clientApi.major !== appApi.major) {
    return {
      verdict: "refuse",
      reason: `apiVersion major mismatch: client ${clientApi.major}.x vs app ${appApi.major}.x`,
    };
  }
  if (clientApi.minor > appApi.minor) {
    return {
      verdict: "refuse",
      reason: `apiVersion minor too new: client ${manifest.apiVersion} vs app ${app.apiVersion}`,
    };
  }

  // -- uiKitVersion --
  const clientUi = parseSemver(manifest.uiKitVersion);
  const appUi = parseSemver(app.uiKitVersion);
  if (!clientUi || !appUi) {
    return {
      verdict: "refuse",
      reason: `uiKitVersion unparseable: client "${manifest.uiKitVersion}" vs app "${app.uiKitVersion}"`,
    };
  }
  if (appUi.major === 0) {
    // 0.x demands an exact minor match. The rule as specified keys the
    // regime off "major == 0" without saying whose major decides it; we key
    // off the APP's uiKitVersion (the host is the arbiter of which compat
    // regime is active), and additionally require the client's major to
    // also be 0 — a client claiming e.g. "1.0.0" against a 0.x app is a
    // major mismatch, not a same-regime minor comparison.
    if (clientUi.major !== 0 || clientUi.minor !== appUi.minor) {
      return {
        verdict: "refuse",
        reason: `uiKitVersion 0.x minor mismatch: client ${manifest.uiKitVersion} vs app ${app.uiKitVersion}`,
      };
    }
  } else {
    if (clientUi.major !== appUi.major) {
      return {
        verdict: "refuse",
        reason: `uiKitVersion major mismatch: client ${clientUi.major}.x vs app ${appUi.major}.x`,
      };
    }
    if (clientUi.minor > appUi.minor) {
      return {
        verdict: "refuse",
        reason: `uiKitVersion minor too new: client ${manifest.uiKitVersion} vs app ${app.uiKitVersion}`,
      };
    }
  }

  // -- contractMajor --
  if (manifest.contractMajor !== app.contractMajor) {
    return {
      verdict: "refuse",
      reason: `contractMajor mismatch: client ${manifest.contractMajor} vs app ${app.contractMajor}`,
    };
  }

  // -- contractMinor --
  if (manifest.contractMinor > app.contractMinor) {
    return {
      verdict: "refuse",
      reason: `contractMinor too new: client ${manifest.contractMinor} vs app ${app.contractMinor}`,
    };
  }

  // -- minAppVersion (advisory floor — warn-load, not refuse) --
  const minApp = parseSemver(manifest.minAppVersion);
  const appVer = parseSemver(app.appVersion);
  if (minApp && appVer && compareSemverOrder(appVer, minApp) < 0) {
    return {
      verdict: "warn-load",
      reason: `minAppVersion ${manifest.minAppVersion} > app ${app.appVersion}`,
    };
  }

  return { verdict: "load", reason: "compatible" };
}
