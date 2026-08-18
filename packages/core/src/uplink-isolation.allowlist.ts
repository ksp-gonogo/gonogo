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
    "mod/GonogoAvionicsUplink/client/src/AvionicsGoNoGo/index.test.tsx": [
      "test-utils",
    ],
    "mod/GonogoAvionicsUplink/client/src/test/setup.ts": ["core"],
    "mod/GonogoAvionicsUplink/client/src/test/setupStreamFixture.tsx": [
      "sitrep-client",
    ],
    "mod/GonogoBreakingGroundUplink/client/src/DeployedScience/dual-run.test.tsx":
      ["core", "test-utils"],
    "mod/GonogoBreakingGroundUplink/client/src/DeployedScience/index.test.tsx":
      ["core", "test-utils"],
    "mod/GonogoBreakingGroundUplink/client/src/DeployedScience/snapshots.test.tsx":
      ["core", "test-utils"],
    "mod/GonogoBreakingGroundUplink/client/src/DeployedScience/stream.test.tsx":
      ["core", "test-utils"],
    "mod/GonogoBreakingGroundUplink/client/src/RoboticsConsole/index.test.tsx":
      ["core", "test-utils"],
    "mod/GonogoBreakingGroundUplink/client/src/RoboticsConsole/index.tsx": [
      "sitrep-client",
    ],
    "mod/GonogoBreakingGroundUplink/client/src/RoboticsConsole/snapshots.test.tsx":
      ["core", "test-utils"],
    "mod/GonogoBreakingGroundUplink/client/src/RoboticsConsole/stream.test.tsx":
      ["core", "test-utils"],
    "mod/GonogoBreakingGroundUplink/client/src/RotorTachometer/index.test.tsx":
      ["core", "test-utils"],
    "mod/GonogoBreakingGroundUplink/client/src/RotorTachometer/index.tsx": [
      "sitrep-client",
      "ui",
    ],
    "mod/GonogoBreakingGroundUplink/client/src/RotorTachometer/snapshots.test.tsx":
      ["core", "test-utils"],
    "mod/GonogoBreakingGroundUplink/client/src/RotorTachometer/stream.test.tsx":
      ["core", "test-utils"],
    "mod/GonogoBreakingGroundUplink/client/src/slot-registry.conformance.test-d.ts":
      ["core"],
    "mod/GonogoBreakingGroundUplink/client/src/test/setup.ts": ["core"],
    "mod/GonogoBreakingGroundUplink/client/src/test/setupStreamFixture.tsx": [
      "sitrep-client",
    ],
    "mod/GonogoKerbalismUplink/client/src/CrewSurvival/index.test.tsx": [
      "sitrep-client",
      "test-utils",
    ],
    "mod/GonogoKerbalismUplink/client/src/CrewSurvival/panel-badge.test.tsx": [
      "core",
      "sitrep-client",
      "test-utils",
    ],
    "mod/GonogoKerbalismUplink/client/src/CrewSurvival/summary.test.tsx": [
      "test-utils",
    ],
    "mod/GonogoKerbalismUplink/client/src/isru.test.ts": ["test-utils"],
    "mod/GonogoKerbalismUplink/client/src/reliability.test.ts": ["test-utils"],
    "mod/GonogoKerbalismUplink/client/src/resourceProjection.test.ts": [
      "sitrep-client",
    ],
    "mod/GonogoKerbalismUplink/client/src/resourceProjection.ts": [
      "sitrep-client",
    ],
    "mod/GonogoKerbalismUplink/client/src/science.test.ts": ["test-utils"],
    "mod/GonogoKerbalismUplink/client/src/ScienceFileManager/index.test.tsx": [
      "test-utils",
    ],
    "mod/GonogoKerbalismUplink/client/src/ShipSystems/GreenhouseSection.test.tsx":
      ["test-utils"],
    "mod/GonogoKerbalismUplink/client/src/ShipSystems/index.test.tsx": [
      "test-utils",
    ],
    "mod/GonogoKerbalismUplink/client/src/ShipSystems/RadiationSection.test.tsx":
      ["test-utils"],
    "mod/GonogoKerbalismUplink/client/src/ShipSystems/resourceColorMap.test.ts":
      ["test-utils"],
    "mod/GonogoKerbalismUplink/client/src/shipSystemsProvenance.test.ts": [
      "sitrep-client",
    ],
    "mod/GonogoKerbalismUplink/client/src/test/setup.ts": [
      "core",
      "sitrep-client",
    ],
    "mod/GonogoKerbalismUplink/client/src/test/setupStreamFixture.tsx": [
      "sitrep-client",
    ],
    "mod/GonogoKerbalismUplink/client/src/topics.test.ts": ["test-utils"],
    "mod/GonogoKerbcastUplink/client/src/CameraFeed/CameraFeed.test.tsx": [
      "core",
      "sitrep-client",
      "test-utils",
    ],
    "mod/GonogoKerbcastUplink/client/src/CameraFeed/CameraFeed.tsx": [
      "sitrep-client",
    ],
    "mod/GonogoKerbcastUplink/client/src/CameraFeed/useDelayedKerbcastStream.ts":
      ["sitrep-client"],
    "mod/GonogoKerbcastUplink/client/src/CameraSetpoint/CameraSetpointSurface.dispatch.test.tsx":
      ["test-utils"],
    "mod/GonogoKerbcastUplink/client/src/CameraSetpoint/CameraSetpointSurface.integration.test.tsx":
      ["test-utils"],
    "mod/GonogoKerbcastUplink/client/src/CameraSetpoint/CameraSetpointSurface.test.tsx":
      ["test-utils"],
    "mod/GonogoKerbcastUplink/client/src/CameraSetpoint/CameraSetpointSurface.tsx":
      ["sitrep-client"],
    "mod/GonogoKerbcastUplink/client/src/CameraSetpoint/FramingPreview.test.tsx":
      ["test-utils"],
    "mod/GonogoKerbcastUplink/client/src/CrewAvatarGate/index.test.tsx": [
      "core",
      "test-utils",
      "ui",
    ],
    "mod/GonogoKerbcastUplink/client/src/CrewAvatarGate/index.tsx": ["ui"],
    "mod/GonogoKerbcastUplink/client/src/CrewAvatarGate/slot.test.tsx": [
      "core",
      "sitrep-client",
      "test-utils",
      "ui",
    ],
    "mod/GonogoKerbcastUplink/client/src/DockingCameraAugment/slot.test.tsx": [
      "core",
      "sitrep-client",
      "test-utils",
    ],
    "mod/GonogoKerbcastUplink/client/src/hooks/useKerbcastCameras.test.ts": [
      "core",
      "test-utils",
    ],
    "mod/GonogoKerbcastUplink/client/src/hooks/useKerbcastMainConnect.test.ts":
      ["test-utils"],
    "mod/GonogoKerbcastUplink/client/src/hooks/useKerbcastStream.delay.test.tsx":
      ["core", "test-utils"],
    "mod/GonogoKerbcastUplink/client/src/hooks/useKerbcastStream.encodedBackend.test.tsx":
      ["core", "test-utils"],
    "mod/GonogoKerbcastUplink/client/src/hooks/useKerbcastStream.test.tsx": [
      "core",
      "test-utils",
    ],
    "mod/GonogoKerbcastUplink/client/src/hooks/useKerbcastStream.ts": [
      "sitrep-client",
    ],
    "mod/GonogoKerbcastUplink/client/src/KerbcastDataSource.test.ts": [
      "core",
      "test-utils",
    ],
    "mod/GonogoKerbcastUplink/client/src/KerbcastDataSource.ts": [
      "sitrep-client",
    ],
    "mod/GonogoKerbcastUplink/client/src/KerbcastEventProducer.ts": [
      "sitrep-client",
    ],
    "mod/GonogoKerbcastUplink/client/src/test/commandHarness.tsx": [
      "sitrep-client",
      "test-utils",
    ],
    "mod/GonogoKerbcastUplink/client/src/test/setup.ts": [
      "core",
      "logger",
      "sitrep-client",
    ],
    "mod/GonogoKerbcastUplink/client/src/test/setupStreamFixture.tsx": [
      "sitrep-client",
    ],
    "mod/GonogoKerbcastUplink/client/src/topics.test.ts": ["test-utils"],
    "mod/GonogoKosUplink/client/src/dataSource/__fixtures__/FakeKosUplink.ts": [
      "sitrep-client",
    ],
    "mod/GonogoKosUplink/client/src/dataSource/kos-cpu-discovery.test.tsx": [
      "sitrep-client",
      "test-utils",
    ],
    "mod/GonogoKosUplink/client/src/dataSource/kos-execute-uplink.test.ts": [
      "sitrep-client",
    ],
    "mod/GonogoKosUplink/client/src/dataSource/kosUplinkExecutor.test.ts": [
      "sitrep-client",
    ],
    "mod/GonogoKosUplink/client/src/KosTerminal/index.test.tsx": [
      "core",
      "test-utils",
    ],
    "mod/GonogoKosUplink/client/src/KosTerminal/lineMode.headless.test.tsx": [
      "core",
      "test-utils",
    ],
    "mod/GonogoKosUplink/client/src/test/setup.ts": [
      "core",
      "data",
      "logger",
      "sitrep-client",
    ],
    "mod/GonogoKosUplink/client/src/test/setupStreamFixture.tsx": [
      "sitrep-client",
    ],
    "mod/GonogoKosUplink/client/src/topics.test.ts": ["test-utils"],
    "mod/GonogoMechJebUplink/client/src/MechJeb/index.test.tsx": [
      "core",
      "test-utils",
    ],
    "mod/GonogoMechJebUplink/client/src/MechJeb/index.tsx": [
      "core",
      "sitrep-client",
    ],
    "mod/GonogoMechJebUplink/client/src/test/setup.ts": [
      "core",
      "sitrep-client",
    ],
    "mod/GonogoMechJebUplink/client/src/test/setupStreamFixture.tsx": [
      "sitrep-client",
    ],
    "mod/GonogoRealAntennasUplink/client/src/test/setup.ts": ["core"],
    "mod/GonogoRealAntennasUplink/client/src/test/setupStreamFixture.tsx": [
      "sitrep-client",
    ],
    "mod/GonogoRealAntennasUplink/client/src/topics.test.ts": ["test-utils"],
    "mod/GonogoScansatUplink/client/src/AnomalyOverlay/index.test.tsx": [
      "core",
      "sitrep-client",
      "test-utils",
    ],
    "mod/GonogoScansatUplink/client/src/CoveragePanel/index.test.tsx": [
      "core",
      "data",
      "sitrep-client",
      "test-utils",
    ],
    "mod/GonogoScansatUplink/client/src/FogReveal/useScanSatFogSync.test.tsx": [
      "core",
      "data",
      "sitrep-client",
      "test-utils",
    ],
    "mod/GonogoScansatUplink/client/src/FootprintOverlay/index.test.tsx": [
      "core",
      "data",
      "sitrep-client",
      "test-utils",
    ],
    "mod/GonogoScansatUplink/client/src/Scanning/index.test.tsx": [
      "core",
      "data",
      "sitrep-client",
      "test-utils",
    ],
    "mod/GonogoScansatUplink/client/src/Scanning/Minimap.test.tsx": [
      "core",
      "data",
      "test-utils",
    ],
    "mod/GonogoScansatUplink/client/src/Scanning/slot.test.tsx": [
      "core",
      "data",
      "sitrep-client",
      "test-utils",
    ],
    "mod/GonogoScansatUplink/client/src/scansat-wire-contract.test.ts": [
      "sitrep-client",
    ],
    "mod/GonogoScansatUplink/client/src/ScienceAugment/slot.test.tsx": [
      "core",
      "sitrep-client",
      "test-utils",
    ],
    "mod/GonogoScansatUplink/client/src/TerrainBase/AltimetryBase.test.tsx": [
      "core",
      "data",
      "sitrep-client",
      "test-utils",
    ],
    "mod/GonogoScansatUplink/client/src/TerrainBase/BiomeBase.test.tsx": [
      "core",
      "data",
      "sitrep-client",
      "test-utils",
    ],
    "mod/GonogoScansatUplink/client/src/test/setup.ts": [
      "core",
      "data",
      "sitrep-client",
    ],
    "mod/GonogoScansatUplink/client/src/test/setupStreamFixture.tsx": [
      "sitrep-client",
    ],
    "mod/GonogoScansatUplink/client/src/test/withScansatAvailability.tsx": [
      "core",
    ],
    "mod/GonogoScansatUplink/client/src/topics.test.ts": ["test-utils"],
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
  "mod/GonogoAvionicsUplink/client/package.json": [
    "core",
    "sitrep-client",
    "test-utils",
  ],
  "mod/GonogoBreakingGroundUplink/client/package.json": [
    "core",
    "sitrep-client",
    "test-utils",
    "ui",
  ],
  "mod/GonogoKerbalismUplink/client/package.json": [
    "core",
    "sitrep-client",
    "test-utils",
  ],
  "mod/GonogoKerbcastUplink/client/package.json": [
    "core",
    "logger",
    "sitrep-client",
    "test-utils",
    "ui",
  ],
  "mod/GonogoKosUplink/client/package.json": [
    "core",
    "data",
    "logger",
    "sitrep-client",
    "test-utils",
  ],
  "mod/GonogoMechJebUplink/client/package.json": [
    "core",
    "sitrep-client",
    "test-utils",
  ],
  "mod/GonogoRealAntennasUplink/client/package.json": [
    "core",
    "sitrep-client",
    "test-utils",
  ],
  "mod/GonogoScansatUplink/client/package.json": [
    "core",
    "data",
    "sitrep-client",
    "test-utils",
  ],
};
