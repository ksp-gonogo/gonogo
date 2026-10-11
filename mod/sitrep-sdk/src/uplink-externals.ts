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
 * Each specifier the app resolves for a loaded Uplink, paired with the name of
 * the file the app serves it from. Mark every specifier `external` when
 * bundling an Uplink's client, so it uses the app's own copy of each package.
 * A bundled copy brings its own `registerComponent`, `registerAugment` and the
 * other registries, so whatever it registers lands in a copy the dashboard
 * never reads.
 * A subpath, such as `@ksp-gonogo/sitrep-sdk/media`, is its own entry.
 *
 * Being listed here is not permission to import: an Uplink's client imports
 * only `@ksp-gonogo/sitrep-sdk` (its root and the `frames`, `media` and
 * `testing` subpaths) and `@ksp-gonogo/ui-kit`, with React and styled-components.
 * The other `@ksp-gonogo` packages named here belong to the app, which resolves
 * them for its own code.
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
  ["@ksp-gonogo/sitrep-client", "ext-sitrep-client"],
  ["@ksp-gonogo/sitrep-sdk", "ext-sitrep-sdk"],
  ["@ksp-gonogo/sitrep-sdk/frames", "ext-sitrep-sdk-frames"],
  ["@ksp-gonogo/sitrep-sdk/media", "ext-sitrep-sdk-media"],
  ["@ksp-gonogo/sitrep-sdk/spine", "ext-sitrep-sdk-spine"],
  ["@ksp-gonogo/logger", "ext-logger"],
] as const satisfies readonly (readonly [string, string])[];

/**
 * The specifiers an Uplink's bundle leaves to the app, as a bundler's
 * `external` option takes them.
 *
 * @category Bundling
 */
export const UPLINK_EXTERNAL_SPECIFIERS: readonly string[] =
  UPLINK_EXTERNAL_ENTRIES.map(([specifier]) => specifier);

/**
 * Specifiers a bundler must also leave out of an Uplink's bundle, although the
 * app serves no file of its own for them: it provides each through another
 * entry, so a bundle that imports them still resolves. They are
 * `react-dom/client` and `react/jsx-dev-runtime`.
 *
 * @category Bundling
 */
export const UPLINK_EXTERNAL_NO_CHUNK: readonly string[] = [
  "react-dom/client",
  "react/jsx-dev-runtime",
];

/**
 * Everything an Uplink's bundler marks `external`: {@link UPLINK_EXTERNAL_SPECIFIERS}
 * and {@link UPLINK_EXTERNAL_NO_CHUNK} together, and the one to use.
 * [`uplink-tools bundle`](/reference/tools/command-line#bundle) passes it for
 * you. A build of your own imports it from this package's `uplink-externals`
 * subpath and passes it as the bundler's list of externals: with esbuild,
 * `external: [...UPLINK_BUNDLE_EXTERNALS]`.
 *
 * @category Bundling
 * @categoryDescription Bundling
 * Use these to configure your bundler's `external` option. They are the package
 * names an Uplink's client bundle leaves unresolved, for the app to supply when
 * it loads the bundle.
 */
export const UPLINK_BUNDLE_EXTERNALS: readonly string[] = [
  ...UPLINK_EXTERNAL_SPECIFIERS,
  ...UPLINK_EXTERNAL_NO_CHUNK,
];
