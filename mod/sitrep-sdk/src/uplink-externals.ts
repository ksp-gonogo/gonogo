/**
 * The specifiers an Uplink client bundle leaves unresolved at build time, because
 * the app's import map resolves them at load.
 *
 * A runtime-loaded Uplink is built with these marked `external`, so its bare
 * `import { registerComponent } from "@ksp-gonogo/sitrep-sdk"` survives into the
 * bundle and resolves, through the import map the app writes into its page, to
 * the app's own singleton instances. Bundle one of them instead and the Uplink
 * gets a second copy of a registry the dashboard never reads.
 *
 * An import map matches a specifier exactly, so `@ksp-gonogo/sitrep-sdk`
 * resolves nothing for `@ksp-gonogo/sitrep-sdk/media`: every subpath has its own
 * entry. A missing entry builds without a warning and throws when the app loads
 * the bundle.
 */

/**
 * Each package specifier the app resolves for a loaded Uplink, paired with the
 * name, without an extension, of the file the app serves it from, such as
 * `ext-react`. An author never uses those names; the specifiers are what a
 * bundle imports. Used by the app to write its import
 * map, the table in its page that tells the browser which file each package name
 * loads from, and by {@link UPLINK_EXTERNAL_SPECIFIERS}.
 *
 * Being listed here is not permission to import. An Uplink's client imports only
 * `@ksp-gonogo/sitrep-sdk` (its root and the `frames` and `media` subpaths, plus
 * `testing` in its tests) and `@ksp-gonogo/ui-kit`, with React and
 * styled-components. The other `@ksp-gonogo` packages named here, and the
 * `@ksp-gonogo/sitrep-sdk/spine` subpath, belong to the app, which resolves them
 * for its own code. `testing` is absent because tests never ship in a bundle.
 *
 * Mark every specifier `external` when bundling an Uplink's client, so it uses
 * the app's own copy of each package. A bundled copy brings its own
 * `registerComponent`, `registerAugment` and the other registries, so whatever
 * it registers lands in a copy the dashboard never reads. A subpath, such as
 * `@ksp-gonogo/sitrep-sdk/media`, is its own entry.
 *
 * @category Bundling
 */
export const UPLINK_EXTERNAL_ENTRIES = [
  ["react", "ext-react"],
  ["react-dom", "ext-react-dom"],
  ["react/jsx-runtime", "ext-react-jsx-runtime"],
  ["styled-components", "ext-styled-components"],
  ["@ksp-gonogo/core", "ext-core"],
  ["@ksp-gonogo/components", "ext-components"],
  ["@ksp-gonogo/data", "ext-data"],
  ["@ksp-gonogo/ui", "ext-ui"],
  ["@ksp-gonogo/ui-kit", "ext-ui-kit"],
  ["@ksp-gonogo/ui-kit/grid", "ext-ui-kit-grid"],
  ["@ksp-gonogo/sitrep-client", "ext-sitrep-client"],
  ["@ksp-gonogo/sitrep-sdk", "ext-sitrep-sdk"],
  ["@ksp-gonogo/sitrep-sdk/frames", "ext-sitrep-sdk-frames"],
  ["@ksp-gonogo/sitrep-sdk/media", "ext-sitrep-sdk-media"],
  ["@ksp-gonogo/sitrep-sdk/spine", "ext-sitrep-sdk-spine"],
  ["@ksp-gonogo/logger", "ext-logger"],
] as const satisfies readonly (readonly [string, string])[];

/**
 * The specifiers an Uplink's bundle leaves to the app, as a bundler's
 * `external` option takes them: the first item of each pair in
 * {@link UPLINK_EXTERNAL_ENTRIES}. Part of {@link UPLINK_BUNDLE_EXTERNALS}. Useful
 * for building an Uplink's client so that the app supplies these packages. Used
 * by {@link UPLINK_BUNDLE_EXTERNALS} and the app's table of provided packages.
 *
 * @category Bundling
 */
export const UPLINK_EXTERNAL_SPECIFIERS: readonly string[] =
  UPLINK_EXTERNAL_ENTRIES.map(([specifier]) => specifier);

/**
 * Specifiers a bundler must also leave out of an Uplink's bundle, although the
 * app serves no file of its own for them. They are `react-dom/client` and
 * `react/jsx-dev-runtime`, subpaths of `react-dom` and `react`, which the app
 * does serve, so a bundle that imports them still resolves. Useful for
 * building an Uplink's client so that the app supplies these packages. Used by
 * {@link UPLINK_BUNDLE_EXTERNALS} and the app's table of provided packages.
 *
 * @category Bundling
 */
export const UPLINK_EXTERNAL_NO_CHUNK: readonly string[] = [
  "react-dom/client",
  "react/jsx-dev-runtime",
];

/**
 * Everything an Uplink's bundler marks `external`: {@link
 * UPLINK_EXTERNAL_SPECIFIERS} and {@link UPLINK_EXTERNAL_NO_CHUNK} together,
 * and the one to use. [`uplink-tools
 * bundle`](/reference/tools/command-line#bundle) passes it for you. A build of
 * your own imports it from this package's `uplink-externals` subpath and passes
 * it as the bundler's list of externals: with esbuild, `external:
 * [...UPLINK_BUNDLE_EXTERNALS]`. Useful for building an Uplink's client so that
 * the app supplies the shared packages the operator's screen already holds.
 * Used by `uplink-tools bundle` and by the app's own bundle build.
 *
 * @category Bundling
 * @categoryDescription Bundling
 * The package names an Uplink's client bundle leaves unresolved, for the app to
 * supply when it loads the bundle. Pass them to your bundler's `external`
 * option.
 */
export const UPLINK_BUNDLE_EXTERNALS: readonly string[] = [
  ...UPLINK_EXTERNAL_SPECIFIERS,
  ...UPLINK_EXTERNAL_NO_CHUNK,
];
