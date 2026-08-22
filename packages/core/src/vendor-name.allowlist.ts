/**
 * Data for the vendor-name ratchet (`vendor-name.test.ts`). Pure data module, no
 * test logic, so the counts can be read at an arbitrary git ref without pulling
 * in vitest or the scan. Same split-module shape as
 * `uplink-isolation.allowlist.ts`.
 *
 * WHAT THIS GUARDS. The app's telemetry source before the R6 cutover was a
 * third-party mod, and its key vocabulary (`o.sma`, `v.altitude`, `tar.o.PeA`)
 * outlived it as the API 27 widgets were written against. The operator has asked
 * for the name to be removed from the codebase several times; each sweep removed
 * instances and the total barely moved, because nothing counted it. Two reasons
 * it did not move, both invisible without an instrument:
 *
 *   - the vocabulary was a live API, so a string-level sweep could not touch it
 *     without migrating 27 widgets first
 *   - comments kept RE-INTRODUCING the name as provenance ("the old X `o.sma`"),
 *     which reads as good practice and was the thing being asked against
 *
 * So this counts PROSE, not just symbols. A symbol-only guard would have called
 * `mod/sitrep-sdk` clean on the day the spine moved there carrying 86 lines of
 * doc comment naming the vendor, including a `LEGACY_KEY_HOMES` header that
 * pointed an outside author at `packages/components/src`.
 *
 * WHERE THE PROVENANCE LIVES NOW: `local_docs/design/telemachus-provenance.md`,
 * every removed comment reproduced verbatim under its file and line. Deleting a
 * mention here loses nothing. What must NOT be lost is a comment that records a
 * SEMANTIC DISTINCTION rather than a rename: those get rewritten to state the
 * distinction without the name. The cost of getting that wrong is not abstract,
 * a duration and an instant were collapsed into one field and shipped a
 * twenty-minute encounter as "46d 2h" in two widgets.
 *
 * EXEMPT: `CLAUDE.md` and `local_docs/**` keep their history, and this file and
 * its test are excluded because naming the thing they guard is their job.
 *
 * SHRINK-ONLY, and the counts are EXACT. Clean a file and the test fails until
 * you lower its number; that is the ratchet, and it is why the numbers are here
 * rather than a bare file list. Remove the entry entirely when it reaches zero.
 * Never raise a number and never add a file.
 */

/**
 * `mod/sitrep-sdk/**`: the PUBLISHED, author-facing surface, kept separate
 * because a line here is worse than a line anywhere else. A third-party Uplink
 * author reads this package and cannot install any of ours; a vendor name in it
 * is both noise and, where the comment points into `packages/*`, a pointer to
 * something they cannot obtain.
 *
 * THIS BUCKET IS AT ZERO as of 2026-08-20, so it is no longer a shrinking list,
 * it is a hard gate: any entry appearing here at all is a regression, and the
 * test says so rather than asking for a number to be lowered.
 *
 * It reached zero the hard way. The stream spine moved into this package for
 * test-ergonomics reasons and carried 86 lines of doc comment with it, including
 * a `LEGACY_KEY_HOMES` header that pointed an outside author at
 * `packages/components/src`, a directory they cannot obtain. Nothing caught
 * that, because nothing was counting. Keeping it empty is cheaper than clearing
 * it twice.
 */
export const SDK_SURFACE: Readonly<Record<string, number>> = {};

/**
 * Everything else in the tree: app packages, the mod's C# side, tests and
 * recorded fixtures. Same shrink-only rule, lower priority than the SDK bucket
 * because none of it is read by anyone outside this repo.
 */
export const APP_INTERNAL: Readonly<Record<string, number>> = {
  "mod/Directory.Build.props": 3,
  "mod/Gonogo.KSP/GonogoAddon.cs": 1,
  "mod/Gonogo.KSP/KspVesselActuator.cs": 1,
  "mod/Gonogo.KSP/RUN.md": 1,
  "mod/GonogoScansatUplink.Tests/ScanChannelsTests.cs": 1,
  "mod/GonogoScansatUplink/ScanChannels.cs": 2,
  "mod/GonogoScansatUplink/ScanGrids.cs": 1,
  "mod/Sitrep.Contract/CommandResult.cs": 2,
  "mod/Sitrep.Contract/Flight.cs": 1,
  "mod/Sitrep.Contract/FlightOpsCommands.cs": 1,
  "mod/Sitrep.Contract/OrbitPatch.cs": 1,
  "mod/Sitrep.Contract/SitrepUnitAttribute.cs": 2,
  "mod/Sitrep.Contract/SpaceCenterPayloads.cs": 1,
  "mod/Sitrep.Contract/StageDeltaV.cs": 1,
  "mod/Sitrep.Contract/SystemPayloads.cs": 3,
  "mod/Sitrep.Contract/Vec3.cs": 1,
  "mod/Sitrep.Contract/VesselAttitude.cs": 1,
  "mod/Sitrep.Contract/VesselCommands.cs": 3,
  "mod/Sitrep.Contract/VesselComms.cs": 1,
  "mod/Sitrep.Contract/VesselControl.cs": 1,
  "mod/Sitrep.Contract/VesselManeuver.cs": 1,
  "mod/Sitrep.Contract/VesselResources.cs": 1,
  "mod/Sitrep.Contract/VesselTarget.cs": 1,
  "mod/Sitrep.Contract/WarpState.cs": 1,
  "mod/Sitrep.Core/README.md": 1,
  "mod/Sitrep.Host.IntegrationTests/MilestoneReplayEndToEndTests.cs": 1,
  "mod/Sitrep.Host.IntegrationTests/ReplayToWebSocketEndToEndTests.cs": 1,
  "mod/Sitrep.Host.Tests/StageDeltaVViewProviderTests.cs": 1,
  "mod/Sitrep.Host.Tests/SystemViewProviderTests.cs": 2,
  "mod/Sitrep.Host.Tests/VesselViewProviderTests.cs": 1,
  "mod/Sitrep.Host/Crash/FlightStatsTracker.cs": 1,
  "mod/Sitrep.Host/SnapshotDict.cs": 2,
  "mod/Sitrep.Host/SystemViewProvider.cs": 7,
  "mod/Sitrep.Host/VesselViewProvider.cs": 1,
  "packages/app/src/App.tsx": 1,
  "packages/app/src/__tests__/action-group.test.tsx": 15,
  "packages/app/src/__tests__/fixtures/crash-payloads.ts": 1,
  "packages/app/src/__tests__/fixtures/fakeTelemachus.ts": 17,
  "packages/app/src/__tests__/peer-broadcast-benchmark.test.ts": 1,
  "packages/app/src/__tests__/peer-client-data-source.test.ts": 1,
  "packages/app/src/__tests__/peer-client-service.test.ts": 4,
  "packages/app/src/__tests__/peer-data-sources.test.ts": 1,
  "packages/app/src/__tests__/peer-roundtrip.test.ts": 29,
  "packages/app/src/__tests__/serial-to-sitrep-command.test.tsx": 2,
  "packages/app/src/__tests__/sitrep-station-forwarding.test.tsx": 1,
  "packages/app/src/__tests__/sitrep-stream.test.tsx": 1,
  "packages/app/src/__tests__/telemetry-components.test.tsx": 6,
  "packages/app/src/alarms/AlarmBanner.tsx": 2,
  "packages/app/src/alarms/AlarmStatusBridge.test.tsx": 2,
  "packages/app/src/alarms/AlarmStatusBridge.tsx": 1,
  "packages/app/src/alarms/AlarmsLauncherBridge.tsx": 1,
  "packages/app/src/alarms/AlarmsModal.test.tsx": 1,
  "packages/app/src/alarms/AlarmsModal.tsx": 1,
  "packages/app/src/alarms/types.ts": 5,
  "packages/app/src/components/Dashboard/GridItemContent.tsx": 1,
  "packages/app/src/components/FlightOutcomeBanner.tsx": 1,
  "packages/app/src/goNoGo/GoNoGoHostService.ts": 1,
  "packages/app/src/missionProfiles/MissionProfilesService.ts": 1,
  "packages/app/src/notes/NotesComponent.tsx": 2,
  "packages/app/src/notes/TagAutocomplete.tsx": 4,
  "packages/app/src/notes/templating.ts": 1,
  "packages/app/src/peer/PeerBroadcastingDataSource.ts": 2,
  "packages/app/src/peer/PeerClientDataSource.ts": 1,
  "packages/app/src/peer/PeerHostProvider.tsx": 3,
  "packages/app/src/peer/PeerHostService.ts": 1,
  "packages/app/src/telemetry/SitrepTelemetryProvider.defaultOn.test.tsx": 1,
  "packages/app/src/telemetry/SitrepTelemetryProvider.tsx": 2,
  "packages/app/src/test/setupStreamFixture.tsx": 1,
  "packages/app/src/vite-env.d.ts": 1,
  "packages/components/scripts/gen-landing-status-fixtures.ts": 1,
  "packages/components/scripts/probe/probe-entry.tsx": 1,
  "packages/components/scripts/render-fixtures.ts": 1,
  "packages/components/src/CommSignal/__fixtures__/no-signal-data.json": 1,
  "packages/components/src/ContractManager/__fixtures__/awaiting-telemetry.json": 1,
  "packages/components/src/CurrentOrbit/__fixtures__/escape-trajectory.json": 1,
  "packages/components/src/DataSourceStatus/index.test.tsx": 4,
  "packages/components/src/OrbitView/__fixtures__/escape-trajectory.json": 1,
  "packages/components/src/OrbitView/stream.test.tsx": 1,
  "packages/components/src/ShipMap/__fixtures__/fuelline-tester-22parts-prelaunch.json": 4,
  "packages/components/src/ShipMap/__fixtures__/fuelline-tester-22parts-prelaunch.partState.json": 1,
  "packages/components/src/ShipMap/__fixtures__/fuelline-tester-poststage2.json": 4,
  "packages/components/src/ShipMap/__fixtures__/oxstat-ring-17parts.json": 2,
  "packages/components/src/ShipMap/__fixtures__/rover-b-alone-28parts.json": 2,
  "packages/components/src/ShipMap/__fixtures__/rover-merged-56parts.json": 4,
  "packages/components/src/SystemView/index.test.tsx": 1,
  "packages/components/src/SystemView/usePhaseAngles.test.tsx": 1,
  "packages/components/src/TargetPicker/__fixtures__/no-target.json": 1,
  "packages/components/src/TechTree/__fixtures__/early-career-63-nodes.json": 4,
  "packages/components/src/ThermalStatus/__fixtures__/no-thermal-data.json": 1,
  "packages/core/src/calc/maneuver.ts": 4,
  "packages/core/src/calc/trajectory.ts": 1,
  "packages/core/src/declarations.ts": 1,
  "packages/core/src/fog.ts": 4,
  "packages/core/src/hooks/mapTopic.coverage.test.ts": 9,
  "packages/core/src/hooks/useGameContext.test.tsx": 2,
  "packages/core/src/hooks/useGameContext.ts": 3,
  "packages/core/src/index.ts": 1,
  "packages/core/src/orbital.ts": 1,
  "packages/core/src/schemas/orbit.ts": 4,
  "packages/core/src/schemas/telemachus-scan-types.ts": 4,
  "packages/core/src/schemas/telemachus.ts": 8,
  "packages/core/src/schemas/vessel-parts.ts": 2,
  "packages/core/src/types.ts": 4,
  "packages/core/src/uplink-boundary.allowlist.ts": 20,
  "packages/core/src/uplink-boundary.test.ts": 24,
  "packages/data/src/FlightsManager/FlightGraph.tsx": 1,
  "packages/data/src/FlightsManager/MissionHistorySource.test.ts": 1,
  "packages/data/src/FlightsManager/MissionHistorySource.ts": 4,
  "packages/data/src/hooks/useDataSchema.ts": 1,
  "packages/data/src/hooks/useDataSeries.shim.test.tsx": 1,
  "packages/data/src/hooks/useManeuverNodes.ts": 1,
  "packages/data/src/hooks/useTopology.ts": 1,
  "packages/data/src/hooks/useValueKeys.ts": 1,
  "packages/data/src/index.ts": 1,
  "packages/data/src/schema/legacyDataCatalog.ts": 3,
  "packages/data/src/schema/telemachusMeta.ts": 5,
  "packages/data/src/storage/IndexedDbStore.ts": 1,
  "packages/data/src/types.ts": 1,
  "packages/relay/src/bootstrapConfig.ts": 1,
  "packages/sitrep-client/src/map-command.test.ts": 1,
  "packages/sitrep-client/src/map-topic.test.ts": 3,
  "packages/sitrep-client/src/orbit-patches.test.ts": 1,
  "packages/sitrep-client/src/vessel-state.test.ts": 1,
  "packages/sitrep-client/src/websocket-transport.test.ts": 1,
  "packages/sitrep-client/src/websocket-transport.ts": 2,
  "packages/ui-kit/src/AugmentSettingsPanel.test.tsx": 1,
  "tests/playwright/sitrep-stream-mirror.spec.ts": 4,
  "tests/playwright/sitrep-stream-server.mjs": 7,
  "tests/playwright/widget-dom-mirror.spec.ts": 1,
  "tests/playwright/widgets/data-source-status.spec.ts": 1,
  "tests/playwright/widgets/distance-to-target.spec.ts": 1,
};
