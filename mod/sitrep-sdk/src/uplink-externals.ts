/**
 * The specifiers an Uplink client bundle leaves unresolved at build time, because
 * the app's import map resolves them at load.
 *
 * ## Why this is PUBLISHED, and why that is the whole point
 *
 * A runtime-loaded Uplink is built with these marked `external`, so its bare
 * `import { registerComponent } from "@ksp-gonogo/sitrep-sdk"` survives into the
 * bundle and resolves, through the `<script type="importmap">` the app bakes into
 * `index.html`, to the app's own singleton instances. Bundle one of them instead
 * and the Uplink gets a second copy of a registry the dashboard never reads.
 *
 * The list lived only in `packages/app/src/uplinks/externals/entries.ts`, which is
 * private and unpublished, so an author outside this repo could not build a
 * loadable bundle without hand-copying it. A hand copy of a list whose failure
 * mode is a MISSING entry agrees with the original by omission: the copy compiles,
 * the isolation ratchet passes, the build succeeds, and it throws at
 * `import(bundleUrl)`. That is exactly how `/spine` shipped unresolvable.
 *
 * So it lives here, where it ships, and the app imports it rather than declaring
 * its own.
 *
 * ## A subpath needs its own entry
 *
 * An import map matches a key without a trailing slash EXACTLY, so
 * `@ksp-gonogo/sitrep-sdk` resolves nothing for `@ksp-gonogo/sitrep-sdk/spine`.
 * esbuild makes this invisible before load: it externalises a subpath of an
 * externalised package NAME, so a missing entry survives the build with no
 * warning.
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
 * Specifiers a bundler must also leave out of an Uplink's bundle, which the
 * app reaches only through another specifier and loads no file for:
 * `react-dom/client` and `react/jsx-dev-runtime`.
 *
 * @category Bundling
 */
export const UPLINK_EXTERNAL_NO_CHUNK: readonly string[] = [
  "react-dom/client",
  "react/jsx-dev-runtime",
];

/**
 * Everything an Uplink's bundler marks `external`: both lists together, and
 * the one to use.
 * [`uplink-tools bundle`](https://ksp-gonogo.github.io/uplink-dev-docs/reference/tools/command-line)
 * passes it for you. A build of your own
 * imports it from this package's `uplink-externals` subpath and passes it as
 * the bundler's list of externals: with esbuild,
 * `external: [...UPLINK_BUNDLE_EXTERNALS]`.
 *
 * @category Bundling
 * @categoryDescription Bundling
 * The package names an Uplink's client bundle leaves unresolved for the app to
 * supply at load, which its build marks external.
 */
export const UPLINK_BUNDLE_EXTERNALS: readonly string[] = [
  ...UPLINK_EXTERNAL_SPECIFIERS,
  ...UPLINK_EXTERNAL_NO_CHUNK,
];
