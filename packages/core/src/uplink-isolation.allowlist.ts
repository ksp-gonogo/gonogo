/**
 * Data for the uplink-isolation ratchet (`uplink-isolation.test.ts`). Pure data
 * module, no test logic, so the shrink-only check can load this file's content
 * at an arbitrary git ref without pulling in vitest or the scan machinery. Same
 * split-module shape as `uplink-boundary.allowlist.ts`.
 *
 * THIS GUARD RUNS THE OPPOSITE DIRECTION TO `uplink-boundary`. That one stops the
 * app naming a mod. This one stops a mod reaching into the app, which nothing
 * checked until 2026-08-18, because the name `uplink-boundary` read as though it
 * covered both and so nobody looked.
 *
 * An Uplink client may import `@ksp-gonogo/sitrep-sdk` and `@ksp-gonogo/ui-kit`.
 * Those are the published surfaces a third-party author actually has. Importing
 * `core`, `components`, `data`, `ui` or `logger` means the Uplink cannot be built
 * by anyone outside this repo, whatever its package.json claims: several of the
 * entries below are not declared as dependencies at all and resolve only through
 * workspace hoisting.
 *
 * Every entry here is DEBT and the list is SHRINK-ONLY. Fix one by moving the
 * export it needs into `sitrep-sdk` or `ui-kit` and re-pointing the import, then
 * delete the line. Never add one: a new entry means new code just created the
 * violation. There is deliberately no `permanent` bucket, because no Uplink file
 * has a legitimate permanent reason to import an app-internal package.
 *
 * Test-side entries dominate this list and have a single shared cause: the SDK
 * publishes `installTestHost` / `resetTestHost` and nothing else, so every Uplink
 * reaches into `core` for `clearRegistry`, `MockDataSource`, `installDomStubs`,
 * `clearUplinkHandles` and `clearActionHandlers`. Publishing those through
 * `@ksp-gonogo/sitrep-sdk/testing` clears most of this file in one change.
 *
 * See `docs/uplink-isolation.md` for what an Uplink may import and why.
 */

/** App-internal packages an Uplink client must not import. */
export const FORBIDDEN_PACKAGES = [
  "core",
  "components",
  "data",
  "ui",
  "logger",
] as const;

export type ForbiddenPackage = (typeof FORBIDDEN_PACKAGES)[number];

/**
 * Blocked strategies: patterns that must never be re-introduced, independent of
 * the debt list. Adding a file here is not an allowlist, it is a ban.
 *
 * `widgetDeclarations.test.ts` put a registry-introspection gate INSIDE an Uplink
 * client, which needs `core` to run. It was removed on 2026-08-18 rather than
 * allowlisted: a gate a third-party author cannot run is not a gate, and the
 * app-side copy at `packages/components/src/test/widgetDeclarations.test.ts`
 * already covers the built-in components. If Uplink widget declarations need
 * governing, the check belongs app-side reaching Uplink registrations, never
 * inside the Uplink.
 */
export const BLOCKED_FILENAMES = ["widgetDeclarations.test.ts"] as const;

/**
 * file path -> the app-internal packages it imports. SHRINK-ONLY.
 */
export const INTERNAL_IMPORT_DEBT: Record<string, readonly ForbiddenPackage[]> =
  {
    "mod/GonogoAvionicsUplink/client/src/test/setup.ts": ["core"],
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
    "mod/GonogoBreakingGroundUplink/client/src/RoboticsConsole/snapshots.test.tsx":
      ["core"],
    "mod/GonogoBreakingGroundUplink/client/src/RoboticsConsole/stream.test.tsx":
      ["core"],
    "mod/GonogoBreakingGroundUplink/client/src/RotorTachometer/index.test.tsx":
      ["core"],
    "mod/GonogoBreakingGroundUplink/client/src/RotorTachometer/index.tsx": [
      "ui",
    ],
    "mod/GonogoBreakingGroundUplink/client/src/RotorTachometer/snapshots.test.tsx":
      ["core"],
    "mod/GonogoBreakingGroundUplink/client/src/RotorTachometer/stream.test.tsx":
      ["core"],
    "mod/GonogoBreakingGroundUplink/client/src/slot-registry.conformance.test-d.ts":
      ["core"],
    "mod/GonogoBreakingGroundUplink/client/src/test/setup.ts": ["core"],
    "mod/GonogoKerbalismUplink/client/src/CrewSurvival/panel-badge.test.tsx": [
      "core",
    ],
    "mod/GonogoKerbalismUplink/client/src/test/setup.ts": ["core"],
    "mod/GonogoKerbcastUplink/client/src/CameraFeed/CameraFeed.test.tsx": [
      "core",
    ],
    "mod/GonogoKerbcastUplink/client/src/CrewAvatarGate/index.test.tsx": [
      "core",
      "ui",
    ],
    "mod/GonogoKerbcastUplink/client/src/CrewAvatarGate/index.tsx": ["ui"],
    "mod/GonogoKerbcastUplink/client/src/CrewAvatarGate/slot.test.tsx": [
      "core",
      "ui",
    ],
    "mod/GonogoKerbcastUplink/client/src/DockingCameraAugment/slot.test.tsx": [
      "core",
    ],
    "mod/GonogoKerbcastUplink/client/src/KerbcastDataSource.test.ts": ["core"],
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
    "mod/GonogoKerbcastUplink/client/src/test/setup.ts": ["core", "logger"],
    "mod/GonogoKosUplink/client/src/KosTerminal/index.test.tsx": ["core"],
    "mod/GonogoKosUplink/client/src/KosTerminal/lineMode.headless.test.tsx": [
      "core",
    ],
    "mod/GonogoKosUplink/client/src/test/setup.ts": ["core", "data", "logger"],
    "mod/GonogoMechJebUplink/client/src/MechJeb/index.test.tsx": ["core"],
    "mod/GonogoMechJebUplink/client/src/MechJeb/index.tsx": ["core"],
    "mod/GonogoMechJebUplink/client/src/test/setup.ts": ["core"],
    "mod/GonogoRealAntennasUplink/client/src/test/setup.ts": ["core"],
    "mod/GonogoScansatUplink/client/src/AnomalyOverlay/index.test.tsx": [
      "core",
    ],
    "mod/GonogoScansatUplink/client/src/CoveragePanel/index.test.tsx": [
      "core",
      "data",
    ],
    "mod/GonogoScansatUplink/client/src/FogReveal/useScanSatFogSync.test.tsx": [
      "core",
      "data",
    ],
    "mod/GonogoScansatUplink/client/src/FootprintOverlay/index.test.tsx": [
      "core",
      "data",
    ],
    "mod/GonogoScansatUplink/client/src/Scanning/Minimap.test.tsx": [
      "core",
      "data",
    ],
    "mod/GonogoScansatUplink/client/src/Scanning/index.test.tsx": [
      "core",
      "data",
    ],
    "mod/GonogoScansatUplink/client/src/Scanning/slot.test.tsx": [
      "core",
      "data",
    ],
    "mod/GonogoScansatUplink/client/src/ScienceAugment/slot.test.tsx": ["core"],
    "mod/GonogoScansatUplink/client/src/TerrainBase/AltimetryBase.test.tsx": [
      "core",
      "data",
    ],
    "mod/GonogoScansatUplink/client/src/TerrainBase/BiomeBase.test.tsx": [
      "core",
      "data",
    ],
    "mod/GonogoScansatUplink/client/src/test/setup.ts": ["core", "data"],
    "mod/GonogoScansatUplink/client/src/test/withScansatAvailability.tsx": [
      "core",
    ],
  };
