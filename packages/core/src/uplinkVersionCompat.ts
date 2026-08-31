/**
 * Uplink Client Contract: version compatibility (design §6.2/§6.3).
 *
 * Pure logic only: the manifest shape, a validation helper, and the
 * compat-verdict function the loader will gate an `import()` behind. No
 * build-time injection, no sha/integrity computation, no wiring to real app
 * version sources: those are the loader's job (a later phase).
 *
 * Mod-agnostic like `uplinkClients.ts`/`uplinkHandles.ts`: never import a
 * mod-specific type or hardcode a mod name here.
 */

import { EXTENSION_API_VERSION } from "@ksp-gonogo/sitrep-sdk";
import { type ParsedSemver, parseSemver } from "./version/compare";

// Re-exported, not declared. It was declared here, in a `private: true` package,
// which meant an Uplink's build had to hand-type the number its own manifest is
// gated on. It lives in `@ksp-gonogo/sitrep-sdk` now so both sides of the gate
// read one constant; this re-export keeps every app-side importer unchanged.
export { EXTENSION_API_VERSION };

/**
 * The manifest an Uplink client bundle ships alongside (design §6.2). Every
 * version-gate field mirrors a `UplinkVersionDescriptor` value from
 * `packages/app/src/uplinks/registry.ts`: this is the pure, package-level
 * home for the shape and its compat rule, so the loader (and any future
 * consumer) doesn't need to reach into the app package for it.
 *
 * Not identical to `UplinkVersionDescriptor`, and deliberately not merged
 * into it: this type is the sidecar manifest a single BUNDLE ships (`id` +
 * one version's worth of gate fields), while `UplinkVersionDescriptor` is one
 * entry in the Hub/registry INDEX's per-uplink `versions[]` list (no `id`,
 * that lives on the parent `UplinkDescriptor`: plus loader-only concerns
 * like `bundleUrl`/`expectedClientHash` this module never touches). The
 * loader (`packages/app/src/uplinks/loader.ts`) maps an
 * `UplinkDescriptor`+`UplinkVersionDescriptor` pair into one of these before
 * calling `checkUplinkCompat`: see `toCompatManifest` there.
 */
export interface GonogoUplinkManifest {
  id: string;
  version: string;
  /**
   * One sentence saying what this Uplink is for, written by its author and
   * generated into the manifest from the lede of `client/uplink.md`.
   *
   * Optional, and checked by neither `isGonogoUplinkManifest` nor
   * `checkUplinkCompat`: an Uplink with nothing to say about itself still loads.
   * It is here so the quarantine list and the Uplinks panel can name an Uplink in
   * the author's own words, which nothing anywhere could do before: there was no
   * description field for an Uplink in either language.
   */
  description?: string;
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
 *  string fields are well-formed semver, `checkUplinkCompat` does that. */
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
 * than returning a discriminated result: every call site here is a loader
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
        `parseUplinkManifest: invalid JSON: ${(err as Error).message}`,
      );
    }
  } else {
    candidate = json;
  }
  if (!isGonogoUplinkManifest(candidate)) {
    throw new Error(
      "parseUplinkManifest: malformed Uplink manifest: missing or " +
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
 *  Passed in by the caller (the future loader), this module never reads a
 *  real app version source itself. */
export interface AppCompatIdentity {
  apiVersion: string;
  uiKitVersion: string;
  contractMajor: number;
  contractMinor: number;
  appVersion: string;
}

/** Full ordering compare (not just equality categorisation, unlike
 *  `compareVersions` in `./version/compare`): needed for the minAppVersion
 *  "is the running app new enough" floor check. Negative if `a` < `b`. */
function compareSemverOrder(a: ParsedSemver, b: ParsedSemver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * The §6.3 compat-verdict rule table. Precedence when multiple rules would
 * independently refuse: apiVersion, then uiKitVersion, then contractMajor,
 * then contractMinor: the same order the fields are listed in §6.3 and in
 * `GonogoUplinkManifest` above. Any refuse wins over warn-load; minAppVersion
 * (the only warn-load-producing rule) is checked last, only once every
 * refuse gate has passed. `integrity` is never inspected here, the loader
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
    // also be 0: a client claiming e.g. "1.0.0" against a 0.x app is a
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
  //
  // The refusal names WHICH SIDE is behind and what closes the gap, because the
  // two numbers alone answer neither, and the person reading this is usually not
  // the person who can act on it: an operator sees a quarantined row, the author
  // sees a build. There is no compatibility path here by design, so the honest
  // message is the remedy rather than a hint that one might be negotiable.
  if (manifest.contractMajor !== app.contractMajor) {
    const uplinkIsBehind = manifest.contractMajor < app.contractMajor;
    return {
      verdict: "refuse",
      reason: uplinkIsBehind
        ? `contractMajor mismatch: this Uplink was built against contract ${manifest.contractMajor}, the app speaks ${app.contractMajor}. The Uplink is out of date and needs rebuilding and re-releasing against the current packages; nothing can be changed app-side to load it.`
        : `contractMajor mismatch: this Uplink expects contract ${manifest.contractMajor}, the app speaks ${app.contractMajor}. The app is out of date, so update the app; the Uplink is not at fault.`,
    };
  }

  // -- contractMinor --
  if (manifest.contractMinor > app.contractMinor) {
    return {
      verdict: "refuse",
      reason: `contractMinor too new: client ${manifest.contractMinor} vs app ${app.contractMinor}`,
    };
  }

  // -- minAppVersion (advisory floor: warn-load, not refuse) --
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
