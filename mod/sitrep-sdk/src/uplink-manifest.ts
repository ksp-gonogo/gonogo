/**
 * `gonogo-uplink.json`: one shape, written by `uplink-tools bundle` and
 * `uplink-tools docs` alike, and the one the app's loader reads.
 *
 * Each field comes from one of three places: `uplink.json`, the author's
 * distribution declaration (id, name, author, repo, minAppVersion), searched for
 * from the client up to three levels so a flat template and a monorepo both
 * find it; the client's `package.json`, for the version it publishes under; and
 * the client's own registrations (id, name, version, description), which only a
 * run of the client in a browser can read. `bundle` never runs the client, so
 * for `name` and `description` it carries forward what the manifest already
 * beside the client says, and `docs --check` keeps that file current.
 *
 * Node-only: it reads the filesystem, so it is a build-tooling subpath like
 * `./uplink-externals` and never reaches a shipped client bundle.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The manifest's file name, which sits beside the Uplink's bundle. Useful for
 * writing or locating the manifest in an Uplink's build. The app's loader finds
 * it from the bundle's own URL, so the name is fixed.
 *
 * @category Manifest
 */
export const UPLINK_MANIFEST_FILE = "gonogo-uplink.json";

/**
 * What an author writes in `uplink.json` about the Uplink as a distribution: its
 * id, name, author, repository and where its files install. Useful for telling
 * the app and the `uplink-tools` commands who made the Uplink and how to
 * package it. Read by {@link readUplinkDeclaration}. The id and name also appear
 * in the code, and {@link buildUplinkManifest} throws when the two disagree.
 *
 * An Uplink of your own always has this file: `uplink-tools new` writes it and
 * every `uplink-tools` command reads it. Only an Uplink bundled inside the
 * app's own repository has none.
 *
 * Three words recur in its fields. The plugin is the Uplink's C# half, the DLL
 * that loads into KSP (the Uplink's mod half, wherever another page says "mod").
 * The contract slice is the plugin's `Contract` project, the C# types its
 * Topics and commands are declared in. The generated page is the README that
 * `uplink-tools page` writes from the Uplink's code.
 *
 * @example An `uplink.json` for an Uplink of your own
 * ```json
 * {
 *   "id": "habitat",
 *   "name": "Habitat",
 *   "author": "Ada Kerman",
 *   "repo": "https://github.com/ada/habitat",
 *   "gamedata": "GonogoHabitat",
 *   "dll": "GonogoHabitat.dll",
 *   "minAppVersion": "0.0.0",
 *   "mod": null,
 *   "codegen": {
 *     "assembly": "GonogoHabitat.Contract",
 *     "configurationMethod": "GonogoHabitat.HabitatRtConfig.Configure",
 *     "emits": {
 *       "SITREP_HABITAT_TOPICMAP_OUT": "topic-map.ts",
 *       "SITREP_HABITAT_COMMANDMAP_OUT": "command-map.ts",
 *       "SITREP_HABITAT_UNITMAP_OUT": "units.ts"
 *     }
 *   },
 *   "csharpNamespace": "GonogoHabitat",
 *   "client": { "url": "https://example.com/habitat/1.0.0/client.js" }
 * }
 * ```
 *
 * @category Manifest
 */
export interface UplinkDeclaration {
  /**
   * The Uplink's id, the same one `defineUplinkClient` and the plugin's
   * `[SitrepUplink]` attribute give. It may be left out when the client's own
   * `defineUplinkClient` gives it; building the manifest fails when nothing
   * does.
   *
   * @readBy bake, bundle, check, codegen, docs, package, page, release
   */
  id?: string;
  /**
   * The name an operator sees, as `defineUplinkClient` gives it.
   *
   * @readBy bake, bundle, check, docs, page
   */
  name?: string;
  /**
   * Who wrote it, shown when the app asks the operator whether to load the client.
   *
   * @readBy bake, bundle, check, docs, page
   */
  author?: string;
  /**
   * The URL of its source repository, shown beside the author.
   *
   * @readBy bake, bundle, check, docs, page
   */
  repo?: string;
  /**
   * The oldest app version it is known to work with. The app warns below it and still loads the client.
   *
   * @readBy bundle, docs, page
   */
  minAppVersion?: string;
  /**
   * The name of the folder the plugin installs into under the game's
   * `GameData`, such as `"GonogoExampleUplink"`. `uplink-tools package` names
   * the mod zip after it and roots the zip at `GameData/<gamedata>/`, and the
   * plugin's project is `mod/<gamedata>.csproj`.
   *
   * @readBy package, release
   */
  gamedata?: string;
  /**
   * The file name of the plugin assembly the build writes, with its `.dll`
   * suffix, such as `"GonogoExampleUplink.dll"`.
   *
   * @readBy package, release
   */
  dll?: string;
  /**
   * The C# namespace the plugin's sources are in. `uplink-tools bake` writes
   * its generated classes into it.
   *
   * @readBy bake, check
   */
  csharpNamespace?: string;
  /**
   * The game mod this Uplink wraps, a separate KSP mod that someone else
   * wrote, when it wraps one, or `null` when it wraps none. It is not the
   * Uplink's own C# half, which this page calls the plugin. The generated page
   * prints it, and its name and `builtAgainst` are
   * copied into `gonogo-uplink.json`, where the app shows them beside the
   * Uplink when asking whether to load it.
   *
   * @readBy bundle, check, docs, page
   */
  mod?: UplinkWrappedMod | null;
  /**
   * How `uplink-tools codegen` turns the contract slice into the client's
   * generated TypeScript. `uplink-tools new` writes it, and it changes only
   * when the slice starts emitting another file. Absent for an Uplink with no
   * contract slice of its own.
   *
   * @readBy check, codegen
   */
  codegen?: UplinkCodegenDeclaration;
  /**
   * The address the released client bundle is published at, as `client.url`,
   * which `release` refuses when it is not this release's. Absent for an Uplink
   * with no client, whose plugin then tells the app it has none to load.
   *
   * @readBy bake, check, release
   */
  client?: {
    /**
     * The absolute address the released client bundle is fetched from, by every
     * install. The plugin carries it, so it is where you publish the bundle, with the
     * `gonogo-uplink.json` beside it. The address carries the version as a folder,
     * such as `https://example.com/habitat/1.0.0/client.js`, and that version
     * has to be this release's version: `uplink-tools release` refuses when it
     * is not.
     */
    url?: string;
  };
}

/**
 * The KSP mod an Uplink wraps, as `uplink.json` names it. Useful for showing the
 * operator which game mod an Uplink connects, and which version of it was
 * tested. Part of {@link UplinkDeclaration}.
 *
 * @category Manifest
 */
export interface UplinkWrappedMod {
  /** The mod's name, as a player knows it. */
  name?: string;
  /** The version of the mod the Uplink was built and tested against. */
  builtAgainst?: string;
  /** How a player gets the mod, in a word the generated page prints after the name, such as `"ckan"` or `"manual"`. */
  tier?: string;
}

/**
 * The `codegen` block of `uplink.json`: which assembly and method generate the
 * client's TypeScript from the contract slice. Useful for `uplink-tools codegen`
 * to find the slice. Part of {@link UplinkDeclaration}.
 *
 * @category Manifest
 */
export interface UplinkCodegenDeclaration {
  /** The name of the contract slice's assembly, without a `.dll` suffix, such as `"GonogoExampleUplink.Contract"`. */
  assembly?: string;
  /** The full name of the static method that configures the generator, such as `"GonogoExampleUplink.ExampleRtConfig.Configure"`. */
  configurationMethod?: string;
  /**
   * The extra files `configurationMethod` writes beyond `contract.ts`, which is
   * always written and is not listed. Each entry is the name of an environment
   * variable the method reads an output path from, mapped to the file name
   * `uplink-tools codegen` sets that variable to, under
   * `client/src/__generated__/`. The method chooses the variable names, so any
   * name works as long as the method reads the same one; `uplink-tools new`
   * writes `SITREP_<UPLINK ID IN CAPITALS>_TOPICMAP_OUT` and its siblings.
   */
  emits?: Record<string, string>;
}

/**
 * Every field `gonogo-uplink.json` carries, in the order it is written. Useful
 * for letting the app check a client before loading it: who wrote it, which
 * versions it was built against and the hash of its bundle. Built by
 * {@link buildUplinkManifest} and read by the app's Uplink loader.
 *
 * @category Manifest
 * @categoryDescription Manifest
 * The `gonogo-uplink.json` file an Uplink ships beside its bundle: what it
 * declares, how it is built and read, and the warnings it can carry.
 */
export interface UplinkManifest {
  /** The Uplink's id, the same one the plugin announces. */
  id: string;
  /** The name an operator sees. */
  name: string;
  /** The client's own `defineUplinkClient` description, when it declares one. */
  description?: string;
  /** Who wrote it, from `uplink.json`. Empty when that names nobody. */
  author: string;
  /** The URL of its source repository, from `uplink.json`. Empty when that names none. */
  repo: string;
  /**
   * The KSP mod this Uplink connects and the version of it the Uplink was built
   * against, from `uplink.json`'s `mod`. The app shows them beside the Uplink
   * when an operator decides whether to load it. Absent when `uplink.json`
   * names neither.
   */
  mod?: { name?: string; builtAgainst?: string };
  /** The Uplink's own version, which its client and its plugin share. */
  version: string;
  /** The oldest app version it is known to work with. The app warns below it and still loads the client. */
  minAppVersion: string;
  /**
   * The extension API the client was built against: the sdk's
   * {@link EXTENSION_API_VERSION}, which covers the surface of the sdk and of ui-kit
   * together. The app refuses a client whose major differs from its own or
   * whose minor is newer. It moves only when that surface changes, never with
   * a package's version.
   */
  apiVersion: string;
  /** The major version of the wire contract the client was built against. The app refuses a client whose major differs from the mod's. */
  contractMajor: number;
  /** The minor version of that contract. The app refuses a client built against a newer minor than the mod carries. */
  contractMinor: number;
  /**
   * Where the bundle sits relative to this file. The two are always in the
   * same directory: the app finds this file by replacing the last segment of
   * the bundle's URL, so this is a file name and never an absolute URL.
   */
  bundleUrl: string;
  /**
   * `sha256-<hex>` of the bundle you distribute. The app hashes the bytes it
   * fetched and refuses to load the Uplink on any mismatch.
   *
   * Empty when the manifest was written with no bundle named. An empty value
   * never matches, so the app refuses that Uplink: a manifest you distribute
   * must be written from the bundle it ships with
   * (`uplink-tools docs --bundle <file>` or `uplink-tools bundle`).
   */
  integrity: string;
  /** The version of `@ksp-gonogo/sitrep-sdk` that wrote this file. A record for a bug report; nothing compares it. */
  sdkVersion: string;
}

/**
 * What the client's registrations say about its id, name, version and
 * description. Useful for checking the manifest against the code. Passed to
 * {@link buildUplinkManifest} by a caller that has read them.
 *
 * @category Manifest
 */
export interface RegisteredIdentity {
  /** The id the client passed to `defineUplinkClient`. */
  id: string;
  /** The name an operator sees, as the client registered it. */
  name: string;
  /** The client's version, as `defineUplinkClient` declares it. */
  version: string;
  /** The client's one-line description, when it gives one. */
  description?: string;
}

/**
 * What {@link buildUplinkManifest} reads: the client directory, the client's
 * registrations if they were read, the compatibility numbers and the bundle's
 * hash. Useful for producing the manifest the app reads before it loads an
 * Uplink's client.
 *
 * @category Manifest
 */
export interface UplinkManifestInputs {
  /** The Uplink's client package: the directory holding its `package.json`. */
  clientDir: string;
  /**
   * The registrations, when the caller evaluated the client.
   * `uplink-tools docs` renders the bundle in a browser and has them;
   * `uplink-tools bundle` never runs the client and does not.
   */
  registered?: RegisteredIdentity;
  /**
   * The compat numbers this Uplink was built against. Pass the ones read from
   * the built bundle where there is one, so the manifest describes the code it
   * ships with.
   */
  compat: {
    apiVersion: string;
    contractMajor: number;
    contractMinor: number;
  };
  /** `sha256-<hex>` of the distributed bundle, or empty when none was named. */
  integrity: string;
}

/**
 * This package's own version, read off its manifest rather than imported from
 * `version.generated.ts`.
 *
 * The generated constant is the right source everywhere else and is the wrong
 * one here: this module is resolved as source inside the workspace, where Node
 * strips the types but does not redirect a `./x.js` specifier to `./x.ts`, so
 * importing it made every `uplink-tools docs` run fail with a module that
 * cannot be found. The package root is one level up from both `src/` and
 * `dist/`, so the same expression works from either.
 */
function sdkVersion(): string {
  const pkg = readJsonFile(
    join(import.meta.dirname, "..", "package.json"),
    "the sdk's own package.json",
  );
  return typeof pkg.version === "string" ? pkg.version : "";
}

function readJsonFile(path: string, what: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `${what} at ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${what} at ${path} does not hold a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * The Uplink's `uplink.json` and its path, found by searching up from
 * `clientDir`, or `undefined` when there is none. Useful for a build script that
 * needs the author's distribution declaration. Used by
 * {@link buildUplinkManifest}. An Uplink of your own always
 * has one; only an Uplink bundled inside the app's own repository does not.
 *
 * @category Manifest
 */
export function readUplinkDeclaration(
  clientDir: string,
): { path: string; declared: UplinkDeclaration } | undefined {
  let dir = clientDir;
  for (let up = 0; up < 3; up++) {
    const path = join(dir, "uplink.json");
    if (existsSync(path)) {
      return { path, declared: readJsonFile(path, "uplink.json") };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * The manifest already committed beside the client, for the two fields only a
 * registration read can supply.
 *
 * `bundle` does not evaluate the client, so `name` and `description` would
 * otherwise be unavailable to it and the two commands would write different
 * files again. Nothing else is taken from here: every other field has a source
 * both writers can read for themselves.
 */
function committedSidecar(clientDir: string): Partial<UplinkManifest> {
  const path = join(clientDir, UPLINK_MANIFEST_FILE);
  if (!existsSync(path)) return {};
  return readJsonFile(path, UPLINK_MANIFEST_FILE) as Partial<UplinkManifest>;
}

/** Refuse rather than pick, when one fact is declared twice and disagrees. */
function agreed(
  field: string,
  declared: string | undefined,
  registered: string | undefined,
): void {
  if (declared === undefined || registered === undefined) return;
  if (declared === registered) return;
  throw new Error(
    `uplink-tools: uplink.json declares ${field} "${declared}" and this ` +
      `client's registration says "${registered}". The manifest can only claim ` +
      "one of them, so make them equal rather than leaving the two commands " +
      "that write it free to disagree.",
  );
}

function wrappedMod(
  mod: UplinkWrappedMod | null | undefined,
): UplinkManifest["mod"] {
  if (!mod?.name && !mod?.builtAgainst) return undefined;
  return { name: mod.name, builtAgainst: mod.builtAgainst };
}

/**
 * The manifest, from the files an Uplink already has. Useful for writing the
 * `gonogo-uplink.json` the app reads before it loads the Uplink.
 *
 * Deterministic: given the same client directory, declaration and compat block
 * it produces the same object every time, and `serialiseUplinkManifest` the same
 * bytes. Nothing here reads a clock, a build artifact or the environment.
 *
 * @example Writing the manifest beside a bundle, from a build script
 * ```ts
 * import { createHash } from "node:crypto";
 * import { readFileSync, writeFileSync } from "node:fs";
 * import {
 *   CONTRACT_MAJOR,
 *   CONTRACT_MINOR,
 *   EXTENSION_API_VERSION,
 * } from "@ksp-gonogo/sitrep-sdk";
 * import {
 *   buildUplinkManifest,
 *   serialiseUplinkManifest,
 *   UPLINK_MANIFEST_FILE,
 * } from "@ksp-gonogo/sitrep-sdk/uplink-manifest";
 *
 * // The file you distribute: its hash is what the app checks before running it.
 * const bundle = readFileSync("dist/habitat/habitat.client.js");
 *
 * const manifest = buildUplinkManifest({
 *   clientDir: "client",
 *   // The versions of the sdk surface and the wire contract this sdk carries.
 *   compat: {
 *     apiVersion: EXTENSION_API_VERSION,
 *     contractMajor: CONTRACT_MAJOR,
 *     contractMinor: CONTRACT_MINOR,
 *   },
 *   integrity: `sha256-${createHash("sha256").update(bundle).digest("hex")}`,
 * });
 * writeFileSync(`dist/${UPLINK_MANIFEST_FILE}`, serialiseUplinkManifest(manifest));
 * ```
 *
 * @category Manifest
 */
export function buildUplinkManifest(
  inputs: UplinkManifestInputs,
): UplinkManifest {
  const { clientDir, registered } = inputs;
  const declared = readUplinkDeclaration(clientDir)?.declared ?? {};
  const pkgPath = join(clientDir, "package.json");
  if (!existsSync(pkgPath)) {
    throw new Error(
      `uplink-tools: no package.json in ${clientDir}. The manifest reads the ` +
        "version an Uplink publishes under from it, so it cannot be written " +
        "from anywhere else.",
    );
  }
  const pkg = readJsonFile(pkgPath, "the client's package.json") as {
    version?: string;
    gonogo?: { minAppVersion?: string };
  };
  const carried = committedSidecar(clientDir);

  agreed("id", declared.id, registered?.id);
  agreed("name", declared.name, registered?.name);
  const id = declared.id ?? registered?.id ?? carried.id;
  if (!id) {
    throw new Error(
      "uplink-tools: nothing declares this Uplink's id. It comes from " +
        "`uplink.json` or from the client's own `defineUplinkClient`, and the " +
        "loader matches it against the roster, so it cannot be defaulted.",
    );
  }

  // The client's `defineUplinkClient({ version })` and the package's own version
  // are two statements of one fact, and the app compares what it reads here
  // against what the loaded bundle declares. Six Uplinks declared "0.0.0-dev"
  // against a published 0.0.1, under a TODO saying the BUILD would inject the
  // version from this manifest, which cannot work: the manifest is generated
  // from the declaration.
  if (
    pkg.version !== undefined &&
    registered !== undefined &&
    registered.version !== pkg.version
  ) {
    throw new Error(
      `uplink-tools: this client declares version "${registered.version}" ` +
        `through defineUplinkClient, and package.json says "${pkg.version}". ` +
        "The manifest can only claim one of them, and the app compares what it " +
        "reads here against what the loaded bundle declares. Make them equal " +
        "(the declaration in client/src/uplink.ts is the one to edit).",
    );
  }

  return {
    id,
    // The id is a fallback, not a name: an Uplink that names itself nowhere is better shown as its id than as a plausible-looking invention.
    name: declared.name ?? registered?.name ?? carried.name ?? id,
    description: registered?.description ?? carried.description,
    // An Uplink that declares no author IS unknown, and an empty string says so without claiming anything.
    author: declared.author ?? "",
    repo: declared.repo ?? "",
    mod: wrappedMod(declared.mod),
    version: pkg.version ?? registered?.version ?? "0.0.0",
    /*
     * The one gate field nothing can derive: it is a claim about the APP, and
     * only the author knows which app feature their Uplink needs. `uplink.json`
     * first, then `package.json`'s `gonogo.minAppVersion`; "0.0.0" means no
     * floor.
     */
    minAppVersion:
      declared.minAppVersion ?? pkg.gonogo?.minAppVersion ?? "0.0.0",
    apiVersion: inputs.compat.apiVersion,
    contractMajor: inputs.compat.contractMajor,
    contractMinor: inputs.compat.contractMinor,
    bundleUrl: `${id}/${id}.client.js`,
    integrity: inputs.integrity,
    // The version of the tool that WROTE this file, which in both commands is
    // this package. Read here rather than passed in, so the two writers cannot
    // answer it differently.
    sdkVersion: sdkVersion(),
  };
}

/**
 * The manifest's bytes: two-space JSON with a trailing newline, always. Useful
 * for writing the manifest to disk so the same manifest always gives the same
 * file. Takes the result of {@link buildUplinkManifest}.
 *
 * @category Manifest
 */
export function serialiseUplinkManifest(manifest: UplinkManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * The warning to print when a manifest is written with an empty `integrity`
 * because no bundle was named. Useful for telling an Uplink author why the app
 * refuses the Uplink. The app will not load such an Uplink until the manifest is
 * written again from the bundle you distribute.
 *
 * @category Manifest
 */
export const NO_BUNDLE_INTEGRITY_WARNING =
  "no bundle was named, so gonogo-uplink.json carries an empty integrity. " +
  "That is expected for a working copy. The app refuses an Uplink whose " +
  "manifest has none, so publish the gonogo-uplink.json that `release` writes " +
  "beside the bundle, or pass `--bundle <the file you distribute>` to stamp " +
  "this one.";
