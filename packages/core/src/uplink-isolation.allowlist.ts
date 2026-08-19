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
 * `widgetDeclarations.test.ts` put a registry-introspection gate INSIDE an Uplink
 * client. It was removed on 2026-08-18 rather than allowlisted: the app-side copy
 * at `packages/components/src/test/widgetDeclarations.test.ts` already covers the
 * built-in components, and a gate that lives in the Uplink makes the first-party
 * Uplinks less like the third-party ones they are meant to model.
 */
export const BLOCKED_FILENAMES = ["widgetDeclarations.test.ts"] as const;

/** file path -> the forbidden packages it imports. SHRINK-ONLY. */
export const INTERNAL_IMPORT_DEBT: Record<string, readonly ForbiddenPackage[]> =
  {
    "mod/GonogoKerbcastUplink/client/src/CameraFeed/CameraFeed.tsx": [
      "sitrep-client",
    ],
    "mod/GonogoKerbcastUplink/client/src/CameraFeed/useDelayedKerbcastStream.ts":
      ["sitrep-client"],
    "mod/GonogoKerbcastUplink/client/src/KerbcastDataSource.ts": [
      "sitrep-client",
    ],
    "mod/GonogoKerbcastUplink/client/src/KerbcastEventProducer.ts": [
      "sitrep-client",
    ],
    "mod/GonogoKerbcastUplink/client/src/hooks/useKerbcastStream.ts": [
      "sitrep-client",
    ],
  };

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
 */
export const DECLARED_DEPENDENCY_DEBT: Record<
  string,
  readonly ForbiddenPackage[]
> = {
  "mod/GonogoKerbcastUplink/client/package.json": ["sitrep-client"],
};
