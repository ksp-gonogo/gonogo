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
 * obtain it. `core`, `ui`, `components`, `data`, `logger` and `sitrep-client` are
 * all `private: true` and unpublished, so there is nothing to install, nothing to
 * typecheck against, and no way to build.
 *
 * The app DOES bake an import map (`packages/app/src/uplinks/externals/`) that
 * resolves all of those specifiers at runtime to its singleton chunks, and that
 * mechanism is load-bearing for widget registration. It is not a licence to
 * import them: it fixes RUNTIME resolution only, and says nothing about how an
 * author outside this repo builds in the first place.
 *
 * The supported seam already exists. `mod/sitrep-sdk/src/api/index.ts` carries
 * fail-loud shims for every stateful member (each `registerX`, the hooks) that
 * delegate to the app-injected host and import no core, so a packed Uplink never
 * bundles a second registry. Import those instead. Its own header notes that
 * first-party in-tree code bypasses them and reaches for core directly, which is
 * exactly why the built-in Uplinks stopped being reference implementations of
 * what we ask outside authors to write.
 *
 * `docs/creating-an-uplink.md` still tells authors to declare `@ksp-gonogo/core`
 * as a dependency. That instruction cannot be followed and is being corrected.
 *
 * Every entry here is DEBT and the list is SHRINK-ONLY. Fix one by re-pointing the
 * import at `sitrep-sdk` or `ui-kit`, or by moving the export there, then delete
 * the line. Never add one.
 *
 * The test-side entries have a single shared cause: the SDK publishes
 * `installTestHost` / `resetTestHost` and nothing else, so every Uplink reaches
 * elsewhere for its harness. Publishing that kit through
 * `@ksp-gonogo/sitrep-sdk/testing` clears most of this file in one change.
 *
 * See `docs/uplink-isolation.md`.
 */

/**
 * Packages an Uplink client must not import. NOT the same as "private": see this
 * file's header for why `core` is absent.
 */
export const FORBIDDEN_PACKAGES = [
  "core",
  "components",
  "data",
  "ui",
  "logger",
  "sitrep-client",
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
    "mod/GonogoAvionicsUplink/client/src/test/setup.ts": ["core"],
    "mod/GonogoAvionicsUplink/client/src/test/setupStreamFixture.tsx": [
      "sitrep-client",
    ],
    "mod/GonogoBreakingGroundUplink/client/src/DeployedScience/dual-run.test.tsx":
      ["core"],
    "mod/GonogoBreakingGroundUplink/client/src/DeployedScience/index.test.tsx":
      ["core"],
    "mod/GonogoBreakingGroundUplink/client/src/DeployedScience/snapshots.test.tsx":
      ["core"],
    "mod/GonogoBreakingGroundUplink/client/src/DeployedScience/stream.test.tsx":
      ["core"],
    "mod/GonogoBreakingGroundUplink/client/src/RoboticsConsole/index.test.tsx":
      ["core"],
    "mod/GonogoBreakingGroundUplink/client/src/RoboticsConsole/index.tsx": [
      "sitrep-client",
    ],
    "mod/GonogoBreakingGroundUplink/client/src/RoboticsConsole/snapshots.test.tsx":
      ["core"],
    "mod/GonogoBreakingGroundUplink/client/src/RoboticsConsole/stream.test.tsx":
      ["core"],
    "mod/GonogoBreakingGroundUplink/client/src/RotorTachometer/index.test.tsx":
      ["core"],
    "mod/GonogoBreakingGroundUplink/client/src/RotorTachometer/index.tsx": [
      "sitrep-client",
      "ui",
    ],
    "mod/GonogoBreakingGroundUplink/client/src/RotorTachometer/snapshots.test.tsx":
      ["core"],
    "mod/GonogoBreakingGroundUplink/client/src/RotorTachometer/stream.test.tsx":
      ["core"],
    "mod/GonogoBreakingGroundUplink/client/src/slot-registry.conformance.test-d.ts":
      ["core"],
    "mod/GonogoBreakingGroundUplink/client/src/test/setup.ts": ["core"],
    "mod/GonogoBreakingGroundUplink/client/src/test/setupStreamFixture.tsx": [
      "sitrep-client",
    ],
    "mod/GonogoKerbalismUplink/client/src/CrewSurvival/index.test.tsx": [
      "sitrep-client",
    ],
    "mod/GonogoKerbalismUplink/client/src/CrewSurvival/panel-badge.test.tsx": [
      "core",
      "sitrep-client",
    ],
    "mod/GonogoKerbalismUplink/client/src/resourceProjection.test.ts": [
      "sitrep-client",
    ],
    "mod/GonogoKerbalismUplink/client/src/resourceProjection.ts": [
      "sitrep-client",
    ],
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
    "mod/GonogoKerbcastUplink/client/src/CameraFeed/CameraFeed.test.tsx": [
      "core",
      "sitrep-client",
    ],
    "mod/GonogoKerbcastUplink/client/src/CameraFeed/CameraFeed.tsx": [
      "sitrep-client",
    ],
    "mod/GonogoKerbcastUplink/client/src/CameraFeed/useDelayedKerbcastStream.ts":
      ["sitrep-client"],
    "mod/GonogoKerbcastUplink/client/src/CameraSetpoint/CameraSetpointSurface.tsx":
      ["sitrep-client"],
    "mod/GonogoKerbcastUplink/client/src/CrewAvatarGate/index.test.tsx": [
      "core",
      "ui",
    ],
    "mod/GonogoKerbcastUplink/client/src/CrewAvatarGate/index.tsx": ["ui"],
    "mod/GonogoKerbcastUplink/client/src/CrewAvatarGate/slot.test.tsx": [
      "core",
      "sitrep-client",
      "ui",
    ],
    "mod/GonogoKerbcastUplink/client/src/DockingCameraAugment/slot.test.tsx": [
      "core",
      "sitrep-client",
    ],
    "mod/GonogoKerbcastUplink/client/src/KerbcastDataSource.test.ts": ["core"],
    "mod/GonogoKerbcastUplink/client/src/KerbcastDataSource.ts": [
      "sitrep-client",
    ],
    "mod/GonogoKerbcastUplink/client/src/KerbcastEventProducer.ts": [
      "sitrep-client",
    ],
    "mod/GonogoKerbcastUplink/client/src/hooks/useKerbcastCameras.test.ts": [
      "core",
    ],
    "mod/GonogoKerbcastUplink/client/src/hooks/useKerbcastStream.delay.test.tsx":
      ["core"],
    "mod/GonogoKerbcastUplink/client/src/hooks/useKerbcastStream.encodedBackend.test.tsx":
      ["core"],
    "mod/GonogoKerbcastUplink/client/src/hooks/useKerbcastStream.test.tsx": [
      "core",
    ],
    "mod/GonogoKerbcastUplink/client/src/hooks/useKerbcastStream.ts": [
      "sitrep-client",
    ],
    "mod/GonogoKerbcastUplink/client/src/test/commandHarness.tsx": [
      "sitrep-client",
    ],
    "mod/GonogoKerbcastUplink/client/src/test/setup.ts": [
      "core",
      "logger",
      "sitrep-client",
    ],
    "mod/GonogoKerbcastUplink/client/src/test/setupStreamFixture.tsx": [
      "sitrep-client",
    ],
    "mod/GonogoKosUplink/client/src/KosTerminal/index.test.tsx": ["core"],
    "mod/GonogoKosUplink/client/src/KosTerminal/lineMode.headless.test.tsx": [
      "core",
    ],
    "mod/GonogoKosUplink/client/src/dataSource/__fixtures__/FakeKosUplink.ts": [
      "sitrep-client",
    ],
    "mod/GonogoKosUplink/client/src/dataSource/kos-cpu-discovery.test.tsx": [
      "sitrep-client",
    ],
    "mod/GonogoKosUplink/client/src/dataSource/kos-execute-uplink.test.ts": [
      "sitrep-client",
    ],
    "mod/GonogoKosUplink/client/src/dataSource/kosUplinkExecutor.test.ts": [
      "sitrep-client",
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
    "mod/GonogoMechJebUplink/client/src/MechJeb/index.test.tsx": ["core"],
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
    "mod/GonogoScansatUplink/client/src/AnomalyOverlay/index.test.tsx": [
      "core",
      "sitrep-client",
    ],
    "mod/GonogoScansatUplink/client/src/CoveragePanel/index.test.tsx": [
      "core",
      "data",
      "sitrep-client",
    ],
    "mod/GonogoScansatUplink/client/src/FogReveal/useScanSatFogSync.test.tsx": [
      "core",
      "data",
      "sitrep-client",
    ],
    "mod/GonogoScansatUplink/client/src/FootprintOverlay/index.test.tsx": [
      "core",
      "data",
      "sitrep-client",
    ],
    "mod/GonogoScansatUplink/client/src/Scanning/Minimap.test.tsx": [
      "core",
      "data",
    ],
    "mod/GonogoScansatUplink/client/src/Scanning/index.test.tsx": [
      "core",
      "data",
      "sitrep-client",
    ],
    "mod/GonogoScansatUplink/client/src/Scanning/slot.test.tsx": [
      "core",
      "data",
      "sitrep-client",
    ],
    "mod/GonogoScansatUplink/client/src/ScienceAugment/slot.test.tsx": [
      "core",
      "sitrep-client",
    ],
    "mod/GonogoScansatUplink/client/src/TerrainBase/AltimetryBase.test.tsx": [
      "core",
      "data",
      "sitrep-client",
    ],
    "mod/GonogoScansatUplink/client/src/TerrainBase/BiomeBase.test.tsx": [
      "core",
      "data",
      "sitrep-client",
    ],
    "mod/GonogoScansatUplink/client/src/scansat-wire-contract.test.ts": [
      "sitrep-client",
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
  };
