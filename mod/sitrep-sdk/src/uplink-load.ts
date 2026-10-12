/*
 * The gates a host runs before it lets an Uplink client bundle register
 * anything: the manifest's reader, the compatibility verdict against the
 * host's own numbers, and the integrity hash of the fetched bytes. Nothing here
 * touches the filesystem or the DOM, so it loads in a browser and in Node.
 */

/**
 * One `major.minor.patch` version, with any pre-release suffix dropped. Useful
 * for comparing the numbers a manifest and a host state. Returned by
 * {@link parseSemver}.
 *
 * @category Loading
 * @categoryDescription Loading
 * What a host checks before it runs an Uplink's released client: the manifest
 * the bundle ships beside, whether the host can run it, and whether the fetched
 * bytes are the ones the manifest names.
 */
export interface ParsedSemver {
  /** The first number, which a break moves. */
  major: number;
  /** The second number, which an addition moves. */
  minor: number;
  /** The third number. */
  patch: number;
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-[\w.]+)?$/;

/**
 * The three numbers of a plain semantic version, or `null` when the text is
 * empty or not one. Useful for reading the versions in a manifest. Used by
 * {@link checkUplinkCompat}.
 *
 * @category Loading
 */
export function parseSemver(
  value: string | undefined | null,
): ParsedSemver | null {
  if (!value) return null;
  const match = SEMVER_RE.exec(value.trim());
  if (!match) return null;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

/**
 * The `gonogo-uplink.json` an Uplink's released client ships beside its bundle:
 * its id and version, the contract and extension API it was built against, and
 * the hash of the bundle. Useful for a page that loads a released client to
 * decide whether it can and to check the bytes it fetched. Read with
 * {@link parseUplinkManifest} and gated with {@link checkUplinkCompat}.
 *
 * @category Loading
 */
export interface GonogoUplinkManifest {
  /** The Uplink's id. */
  id: string;
  /** The client's version. */
  version: string;
  /**
   * One sentence saying what this Uplink is for, taken from the `description`
   * its client declares. Optional: an Uplink without one still loads.
   */
  description?: string;
  /** The oldest app version the client asks for; an older app loads it with a warning. */
  minAppVersion: string;
  /**
   * The extension API the client was built against, the sdk's
   * `EXTENSION_API_VERSION`. A different major, or a minor newer than the
   * host's, is refused.
   */
  apiVersion: string;
  /** The wire contract's major number the client was built against; a different one is refused. */
  contractMajor: number;
  /** The wire contract's minor number the client was built against; one newer than the host's is refused. */
  contractMinor: number;
  /** The `sha256-<hex>` of the bundle, which the fetched bytes must match. */
  integrity: string;
  /** The Uplink's display name, from its `uplink.json`. Optional and checked by nothing. */
  name?: string;
  /** The Uplink's author, from its `uplink.json`. Optional and checked by nothing. */
  author?: string;
  /** The repository the Uplink is released from, from its `uplink.json`. Optional and checked by nothing. */
  repo?: string;
  /**
   * The game mod the Uplink connects, and the version of it the Uplink was
   * built against, from its `uplink.json`. Optional and checked by nothing.
   */
  mod?: { name?: string; builtAgainst?: string };
  /** Where the bundle sits relative to this manifest. Optional. */
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

/**
 * Whether `x` has every field of a {@link GonogoUplinkManifest} with the right
 * type. It does not check that the version strings are well formed, which
 * {@link checkUplinkCompat} does. Used by {@link parseUplinkManifest}.
 *
 * @category Loading
 */
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
 * The manifest in `json`, which is the text of a `gonogo-uplink.json` or an
 * already parsed value. Throws an error naming the problem when the text is not
 * JSON or a field is missing or of the wrong type. Useful for a page that
 * fetches a released client's sidecar before loading the bundle.
 *
 * @category Loading
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

/**
 * What a host does with a client: `load` it, `refuse` it, or `warn-load` it,
 * which loads it and tells the operator the host is older than the client asks.
 * Held by {@link UplinkCompatVerdict}.
 *
 * @category Loading
 */
export type UplinkCompatVerdictKind = "load" | "refuse" | "warn-load";

/**
 * The answer {@link checkUplinkCompat} gives for one manifest: what to do and,
 * in a sentence, why. A refusal's reason says which side is behind and what
 * closes the gap, so an operator or an author can act on it.
 *
 * @category Loading
 */
export interface UplinkCompatVerdict {
  /** What the host does with the client. */
  verdict: UplinkCompatVerdictKind;
  /** The sentence to show for the verdict. */
  reason: string;
}

/**
 * The numbers a host states about itself when a manifest is gated against it:
 * the extension API it provides, the wire contract it speaks, and its own
 * version. Passed to {@link checkUplinkCompat}.
 *
 * @category Loading
 */
export interface AppCompatIdentity {
  /** The extension API version the host provides. */
  apiVersion: string;
  /** The wire contract's major number the host speaks. */
  contractMajor: number;
  /** The wire contract's minor number the host speaks. */
  contractMinor: number;
  /** The host's own version, which a manifest's `minAppVersion` is compared with. */
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
 * Whether a host can run a client, from its manifest and the host's own
 * numbers: refused for a different extension API major, an extension API minor
 * or contract minor newer than the host's, or a different contract major;
 * loaded with a warning when the host is older than the manifest's
 * `minAppVersion`; loaded otherwise. When several refusals apply, the first of
 * the extension API, the contract major and the contract minor is reported. The
 * bundle's `integrity` is not looked at here, since it needs the fetched bytes:
 * check it with {@link sha256Integrity}.
 *
 * @category Loading
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

/**
 * The `sha256-<hex>` of a bundle's bytes, in the form a manifest's `integrity`
 * holds. Useful for checking fetched bytes against the manifest before running
 * them. Throws when the page has no Web Crypto, as a page served over plain
 * http outside localhost has none, rather than skipping the check.
 *
 * @category Loading
 */
export async function sha256Integrity(bytes: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "cannot verify integrity: crypto.subtle unavailable (non-secure origin), serve the page over https or localhost",
    );
  }
  const digest = await subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256-${hex}`;
}
