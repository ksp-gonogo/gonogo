/**
 * The specifier -> external-entry-chunk pairs the app bakes into its import map.
 *
 * Extracted out of `vite.config.ts` so a test can read the same list the build
 * uses. Checking a hand-copied duplicate of it proves nothing: the defect this
 * list governs is a MISSING pair, and a copy that also omits the pair agrees
 * with the build and reports clean.
 *
 * Paths deliberately stay in `vite.config.ts`. This module resolves nothing and
 * imports nothing, so both a Vite config load and a vitest run can read it
 * without either needing the other's module semantics.
 */

/** `[bare specifier, `ext-*.ts` entry basename]`, one per resolvable specifier. */
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
  // Each sdk subpath needs its OWN pair: an import map matches a key without a
  // trailing slash EXACTLY, so the bare `@ksp-gonogo/sitrep-sdk` entry above
  // resolves nothing for a subpath import.
  ["@ksp-gonogo/sitrep-sdk/frames", "ext-sitrep-sdk-frames"],
  ["@ksp-gonogo/sitrep-sdk/media", "ext-sitrep-sdk-media"],
  ["@ksp-gonogo/sitrep-sdk/spine", "ext-sitrep-sdk-spine"],
  ["@ksp-gonogo/logger", "ext-logger"],
] as const satisfies readonly (readonly [string, string])[];

/**
 * The specifiers a runtime-loaded Uplink bundle may leave unresolved at build
 * time, because the import map resolves them at load.
 */
export const UPLINK_EXTERNAL_SPECIFIERS: readonly string[] =
  UPLINK_EXTERNAL_ENTRIES.map(([specifier]) => specifier);

/**
 * Externalised without an entry chunk of their own, because each is reached
 * only through a specifier that HAS one.
 *
 * `react-dom/client` and `react/jsx-dev-runtime` are marked external so esbuild
 * leaves them alone, but nothing needs to resolve them at load: the app's own
 * bundle owns the DOM root, and the dev JSX runtime is never in a production
 * build. Listing them here rather than beside the pairs above keeps them out of
 * the Rollup `input` map, where a chunk with no importer would be dead weight.
 */
export const UPLINK_EXTERNAL_NO_CHUNK: readonly string[] = [
  "react-dom/client",
  "react/jsx-dev-runtime",
];
