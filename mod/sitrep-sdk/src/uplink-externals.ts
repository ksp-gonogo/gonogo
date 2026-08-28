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

/** `[bare specifier, `ext-*` entry basename]`, one per resolvable specifier. */
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

/** Just the specifiers, which is what a bundler's `external` takes. */
export const UPLINK_EXTERNAL_SPECIFIERS: readonly string[] =
  UPLINK_EXTERNAL_ENTRIES.map(([specifier]) => specifier);

/**
 * Externalised without an entry chunk of their own, because each is reached only
 * through a specifier that HAS one. A bundler must still leave them alone;
 * nothing needs to resolve them at load.
 */
export const UPLINK_EXTERNAL_NO_CHUNK: readonly string[] = [
  "react-dom/client",
  "react/jsx-dev-runtime",
];

/** Everything a bundler marks `external`, which is both lists together. */
export const UPLINK_BUNDLE_EXTERNALS: readonly string[] = [
  ...UPLINK_EXTERNAL_SPECIFIERS,
  ...UPLINK_EXTERNAL_NO_CHUNK,
];
