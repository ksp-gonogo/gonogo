/**
 * Data for the uplink-isolation ratchet (`uplink-isolation.test.ts`). Pure data
 * module, no test logic, so the shrink-only check can load this file's content at
 * an arbitrary git ref without pulling in vitest or the scan machinery. Same
 * split-module shape as `uplink-boundary.allowlist.ts`.
 *
 * THIS GUARD RUNS THE OPPOSITE DIRECTION TO `uplink-boundary`. That one stops the
 * app naming a mod. This one stops a mod reaching into the app, which nothing
 * checked until 2026-08-18, because the name `uplink-boundary` read as though it
 * covered both and so nobody looked.
 *
 * WHAT AN UPLINK MAY IMPORT is the PUBLISHED surface, plus the genuinely
 * third-party runtime singletons:
 *
 *   `@ksp-gonogo/sitrep-sdk`, `@ksp-gonogo/ui-kit`, `react`, `styled-components`
 *
 * Everything else in this repo is forbidden because an outside author cannot
 * obtain it. `core`, `ui`, `components`, `data`, `logger`, `sitrep-client` and
 * `test-utils` are all `private: true` and unpublished, so there is nothing to
 * install, nothing to typecheck against, and no way to build. So are the Uplinks
 * themselves, which is why one Uplink may not import another.
 *
 * The app DOES bake an import map (`packages/app/src/uplinks/externals/`) that
 * resolves all of those specifiers at runtime to its singleton chunks, and that
 * mechanism is load-bearing for widget registration. It is not a licence to
 * import them: it fixes RUNTIME resolution only, and says nothing about how an
 * author outside this repo builds in the first place.
 *
 * There is NO first-party exemption. Some Uplinks ship bundled with the mod,
 * which changes how they are distributed and not what they may import. Every
 * Uplink here is meant to be a working example of what an outside author can
 * build. An earlier revision of the SDK barrel's header exempted in-tree code,
 * and that exemption is both where this debt came from and what taught
 * `docs/creating-an-uplink.md` to tell authors to depend on `core`.
 *
 * Every entry here is DEBT and the list is SHRINK-ONLY. Fix one by re-pointing the
 * import at a published package, or by moving the export into one, then delete
 * the line. Never add one.
 *
 * The test-side entries have a single shared cause: nothing published carried a
 * test harness, so every Uplink reached into `core` / `sitrep-client` /
 * `test-utils` for one. `@ksp-gonogo/sitrep-testing` is that harness, published
 * and sitting ABOVE the spine so it can hand an author the REAL
 * `TelemetryClient` / `TimelineStore` / `StubTransport` rather than a
 * reimplementation of them.
 *
 * See `docs/uplink-isolation.md`.
 */

/**
 * Packages an Uplink client must not import, by their `@ksp-gonogo/` suffix.
 *
 * Every private package in the workspace an Uplink has ever named. `test-utils`
 * and the eight Uplinks themselves joined on 2026-08-18: they are `private: true`
 * on exactly the same footing as `core`, and the first pass at this list simply
 * missed them, so the ratchet read as clean while 56 files still could not be
 * built by an outsider. `theme`, `serial` and `sitrep-kernel` are private too and
 * belong here the moment an Uplink names one.
 */
export const FORBIDDEN_PACKAGES = [
  "core",
  "components",
  "data",
  "ui",
  "logger",
  "sitrep-client",
  "test-utils",
  "gonogo-avionics-uplink",
  "gonogo-breaking-ground-uplink",
  "gonogo-kerbalism-uplink",
  "gonogo-kerbcast-uplink",
  "gonogo-kos-uplink",
  "gonogo-mechjeb-uplink",
  "gonogo-realantennas-uplink",
  "gonogo-scansat-uplink",
] as const;

export type ForbiddenPackage = (typeof FORBIDDEN_PACKAGES)[number];

/**
 * Blocked strategies: patterns that must never be re-introduced, independent of
 * the debt list. Adding a file here is not an allowlist, it is a ban.
 *
 * `widgetDeclarations.test.ts` is a registry-introspection gate, and one inside
 * an Uplink client is removed rather than allowlisted: the app-side copy at
 * `packages/components/src/test/widgetDeclarations.test.ts` already covers the
 * built-in components, and a gate that lives in the Uplink makes the
 * first-party Uplinks less like the third-party ones they are meant to model.
 */
export const BLOCKED_FILENAMES = ["widgetDeclarations.test.ts"] as const;

/**
 * file path -> the forbidden packages it imports. SHRINK-ONLY.
 *
 * EMPTY as of 2026-08-19, down from 71. Every Uplink in this repo builds against
 * the published packages alone. An empty list is the point of the exercise, not
 * the end of it: the scan still runs, and the first import that reaches back
 * into the app fails the build rather than joining a list.
 */
export const INTERNAL_IMPORT_DEBT: Record<string, readonly ForbiddenPackage[]> =
  {};

/**
 * A dependency that resolves through pnpm workspace hoisting is not a
 * dependency you have. This is the DECLARATION half of the same rule: an
 * Uplink's `client/package.json` may not name a forbidden package in
 * `dependencies` or `devDependencies`, because an outside author installing
 * from the registry gets a module-not-found rather than a working build.
 *
 * Seeded 2026-08-18 alongside the import debt, and SHRINK-ONLY for the same
 * reason. It exists because `docs/uplink-isolation.md` had a "Which package
 * declares what" section that nothing enforced, which is how two Uplinks kept a
 * declared dependency on `components` for weeks after the last import of it
 * died.
 *
 * Also EMPTY as of 2026-08-19.
 */
export const DECLARED_DEPENDENCY_DEBT: Record<
  string,
  readonly ForbiddenPackage[]
> = {};

/**
 * Which SUBPATHS of the two published packages an Uplink may import.
 *
 * The package-level checks cannot express this. `IMPORT_RE` is a denylist of
 * package names and both of these are permitted, at any depth, so
 * `@ksp-gonogo/sitrep-sdk/spine` in a widget passes every gate in the tree, the
 * extraction probe included: `/spine` is published, so it resolves from the
 * tarball and typechecks standing alone. Measured 2026-08-26 by planting that
 * exact import in a production Uplink file, with the isolation suite at 12/12 and
 * the extraction probe at zero errors.
 *
 * That is the whole of the risk. `/spine` is where the read semantics of a topic
 * are implemented and `/registry` is dashboard orchestration; both barrels say in
 * their own headers that publishing them would freeze evolving internals as
 * third-party API, and `docs/uplink-isolation.md` says an Uplink may not import
 * either. Nothing said it to a compiler until this list existed.
 *
 * Every published subpath is classified here or in `NON_AUTHOR_SUBPATHS`, so a
 * new one forces the decision rather than defaulting to permitted. Same shape and
 * the same reason as the classification in `sdk-subpath-alias.test.ts`.
 */
export const AUTHOR_SUBPATHS: Record<
  string,
  Readonly<Record<string, string>>
> = {
  "@ksp-gonogo/sitrep-sdk": {
    frames: "reference-frame arithmetic a projection contribution needs",
    media: "the delayed-media layer a camera Uplink needs",
    testing: "the real host, spine and stream fixture, for an Uplink's tests",
  },
  "@ksp-gonogo/ui-kit": {
    testing: "the widget provider stack and the readout helpers",
    guards: "the render-time invariants a widget asserts against",
    "render-probe":
      "half of the render harness, driven by the gonogo-uplink bin",
    render: "the other half of the render harness",
    "page-check": "the generated-page assertions the render harness reads back",
    "tokens.css": "the design-system custom properties, imported as an asset",
  },
};

/**
 * Published subpaths that are NOT author surfaces, with the reason each one is
 * reachable anyway. Reachable is the point: every entry here resolves, installs
 * and typechecks, which is why only a named list can stop it.
 */
export const NON_AUTHOR_SUBPATHS: Record<
  string,
  Readonly<Record<string, string>>
> = {
  "@ksp-gonogo/sitrep-sdk": {
    spine:
      "the implementation behind every host shim the root barrel publishes. An Uplink calls the shim; the app and an Uplink's test wire into this. Take what you need off the root barrel, or /frames for the arithmetic",
    registry:
      "dashboard orchestration, which widgets a screen renders. The app reaches it through core's re-export and an Uplink has no business calling it",
    "uplink-externals":
      "the specifiers a client bundle leaves external, read by BUILD tooling (`gonogo-uplink bundle`) and by the app's import map. Published so an author's bundler and the app cannot drift, which they did while it lived only in the app; nothing in a widget's runtime imports it",
  },
  "@ksp-gonogo/ui-kit": {},
};
