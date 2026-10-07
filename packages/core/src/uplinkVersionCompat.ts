/**
 * Uplink Client Contract: version compatibility.
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

/*
 * Re-exported, not declared: it lives in `@ksp-gonogo/sitrep-sdk` so both
 * sides of the gate read one constant; this re-export keeps every app-side
 * importer unchanged.
 */
export { EXTENSION_API_VERSION };

/**
 * The manifest an Uplink client bundle ships alongside. Every
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
  /**
   * The extension API the client was built against, the sdk's
   * `EXTENSION_API_VERSION`. It is the one number that speaks for the surface
   * of the sdk and of ui-kit together, and it moves only when that surface
   * changes: a break moves the major, an addition the minor. No package's own
   * version is compared anywhere, because a release moves every package's
   * version whether or not anything an Uplink uses changed.
   */
  apiVersion: string;
  contractMajor: number;
  contractMinor: number;
  integrity: string;
  /**
   * What the Uplink is as a DISTRIBUTION, written by `uplink-tools` from the
   * author's `uplink.json`.
   *
   * Optional and unchecked, like `description`: a manifest generated before these
   * were part of the shape still loads. Nothing here gates anything, and the
   * loader deliberately prefers the roster's values, which the running mod
   * vouches for, over a bundle's self-declaration about itself.
   */
  name?: string;
  author?: string;
  repo?: string;
  /** Where the bundle sits relative to this manifest. The loader derives its
   *  own URL the other way round, from the bundle it was asked to load. */
  bundleUrl?: string;
  /** The `@ksp-gonogo/sitrep-sdk` that wrote the file. Diagnostic. */
  sdkVersion?: string;
}

const MANIFEST_STRING_FIELDS = [
  "id",
  "version",
  "minAppVersion",
  "apiVersion",
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
        `parseUplinkManifest: invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
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
 * The compat-verdict rule table. Precedence when multiple rules would
 * independently refuse: apiVersion, then contractMajor,
 * then contractMinor: the same order the fields are listed in
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
  /*
   * Each refusal says which side is behind and what closes the gap, as the
   * contract refusals below do: an operator sees a quarantined row and the
   * author sees a build, and the two numbers alone tell neither what to do.
   * "The packages" are the sdk and ui-kit, which a release publishes at the
   * app's own version, so that version is what an author rebuilds against.
   */
  const rebuild =
    `The Uplink needs rebuilding against @ksp-gonogo/sitrep-sdk and @ksp-gonogo/ui-kit ` +
    `${app.appVersion}, the versions this app was released with, and re-releasing; ` +
    "nothing can be changed app-side to load it.";
  const updateApp =
    "The app is older than the Uplink, so update the app; the Uplink is not at fault.";
  if (clientApi.major !== appApi.major) {
    return {
      verdict: "refuse",
      reason:
        `extension API mismatch: this Uplink was built for extension API ${clientApi.major}.x ` +
        `(apiVersion ${manifest.apiVersion}), and the app provides ${app.apiVersion}. ` +
        (clientApi.major < appApi.major ? rebuild : updateApp),
    };
  }
  if (clientApi.minor > appApi.minor) {
    return {
      verdict: "refuse",
      reason:
        `extension API too new: this Uplink was built for extension API ${manifest.apiVersion}, ` +
        `and the app provides ${app.apiVersion}. ${updateApp}`,
    };
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
