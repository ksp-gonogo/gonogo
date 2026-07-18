import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Uplink-boundary guardrail: prevent mod names/types leaking outside the
 * package that owns their integration ("Uplink"). Ratchet-style, same
 * shape as `styleguide.test.ts`'s hex-literal gate — but per-file instead
 * of per-count, because a boundary violation is "this specific file
 * imports/references a mod it doesn't own", not a fungible occurrence.
 *
 * Full catalogue, categorisation (HARD / gray / test / comment-only), and
 * the reasoning behind every entry below:
 *   docs/superpowers/specs/2026-07-13-uplink-boundary-audit.md
 *
 * How the ratchet works:
 *   1. Scan `packages/*\/src` and `mod/*` (.ts/.tsx/.cs) for each mod
 *      token, excluding that mod's own owning directory.
 *   2. Every file found is checked against ALLOWLIST[token].
 *   3. A file found but NOT allowlisted = a NEW violation -> fail, named.
 *   4. An allowlist entry that no longer matches any found file = STALE
 *      -> fail, named. This is what makes it a ratchet: fixing a
 *      violation (moving code into the owning Uplink, or dropping the
 *      reference) makes its allowlist line stale, and the test forces
 *      you to delete that line in the same commit.
 *
 * The allowlist is seeded from the audit above and is expected to SHRINK
 * over time, never grow except via a deliberate, reviewed edit.
 */

type ModToken = "kerbcast" | "scansat" | "kos" | "realantennas" | "agx";

interface ModOwnership {
  // Distinctive-form patterns for this mod. Deliberately NOT bare
  // substrings like "kos" — see the kos entry below for why.
  patterns: RegExp[];
  // Directories (relative to repo root) that own this mod's integration.
  // Any match inside one of these is not a boundary violation.
  ownedDirs: string[];
}

const MOD_OWNERSHIP: Record<ModToken, ModOwnership> = {
  kerbcast: {
    // GonogoKerbcastUplink owns kerbcast's CONTROL plane (camera inventory,
    // capabilities, docking-port association, health, aim/zoom commands) — see
    // .superpowers/sdd/kerbcast-uplink-design.md. Its §8 left open whether the
    // MEDIA half (the WebRTC/playout path, npm name @ksp-gonogo/kerbcast-feed)
    // folds into the Uplink's client; it now has: that package moved from
    // packages/kerbcast to this Uplink's client/ half, so ONE directory owns
    // both planes and the client is no longer a special-cased core package.
    // (mod/GonogoKerbcastUplink covers client/ — isUnderOwnedDir is a prefix
    // match — so the client half needs no separate entry.)
    patterns: [/kerbcast/i, /hullcam/i],
    ownedDirs: ["mod/GonogoKerbcastUplink", "mod/GonogoKerbcastUplink.Tests"],
  },
  scansat: {
    patterns: [/scansat/i],
    ownedDirs: ["mod/GonogoScansatUplink", "mod/GonogoScansatUplink.Tests"],
  },
  kos: {
    // "kos" alone false-matches inside unrelated words, so match only
    // distinctive forms: the npm package, PascalCase Kos-prefixed
    // identifiers, the kos.* topic namespaces, and the mod's own
    // capitalisation "kOS".
    patterns: [
      /@ksp-gonogo\/kos/,
      /Kos[A-Z]/,
      /kos\.(processors|run|compute|terminal|keystroke)/,
      /kOS/,
    ],
    ownedDirs: ["mod/GonogoKosUplink", "mod/GonogoKosUplink.Tests"],
  },
  realantennas: {
    // Matches both "realantennas" and the singular "realantenna".
    patterns: [/realantenna/i],
    ownedDirs: [
      "mod/GonogoRealAntennasUplink",
      "mod/GonogoRealAntennasUplink.Tests",
    ],
  },
  agx: {
    // Deliberately NOT a bare "actionGroups" match — that field/topic name
    // is ubiquitous outside this mod (VesselControl.ActionGroups,
    // vessel.control.setActionGroup, StockActionGroupsBackend, etc.), so a
    // bare substring would false-match almost every vessel-control file.
    // These three patterns match only AGX-DISTINCTIVE forms: the "Action
    // Groups Extended" name (with or without a separator, so it also
    // catches the provider id "actionGroupsExtended" and identifiers like
    // "ActionGroupsExtendedProviderId"), the AGExt assembly/type name, and
    // AGX-prefixed API identifiers (AGXListOfAssignedGroups, AGXGroupState,
    // AGXActivateGroup, AGXInstalled, ...) — none of which match plain
    // "actionGroups".
    patterns: [
      /action[- ]?groups?[- ]?extended/i,
      /\bAGExt\b/,
      /\bAGX[0-9A-Za-z]/,
    ],
    ownedDirs: [
      "mod/GonogoActionGroupsExtendedUplink",
      "mod/GonogoActionGroupsExtendedUplink.Tests",
    ],
  },
  // Excluded on purpose (per task scope):
  //   telemachus  — legacy system being deleted, not an Uplink; tracked
  //                 as separate migration debt in the audit doc, §5.
  //   commnet     — stock KSP networking, not a third-party mod.
};

// ---------------------------------------------------------------------
// Seeded allowlist. One entry per (token, file) pair. Every entry here
// corresponds to a file the audit doc found and categorised; entries not
// individually named in the audit's prose are marked "found by ratchet
// scan" and are lower-severity comment mentions (verified by hand while
// seeding this list) unless noted otherwise.
//
// To ratchet down: when a file's violation is fixed (code moved into the
// owning Uplink dir, or the reference removed), delete its line here.
// The test will tell you if you missed one (stale-entry failure) or if
// you deleted one that's still live (new-violation failure).
// ---------------------------------------------------------------------

const ALLOWLIST: Record<ModToken, string[]> = {
  // === kerbcast — owning dir mod/GonogoKerbcastUplink/ (incl. its client/).
  // The remaining HARD cluster is the app's own bootstrap/peer wiring, which
  // stays until the Uplink-client LOADER lands — today every Uplink client
  // (this one, GonogoKosUplink/client, GonogoScansatUplink/client) is still bundled
  // at build, so the app must name them to import them. See uplink
  // architecture §1's "P7 retires" tech-debt note; these lines are the shape
  // of that debt, not of this Uplink.
  kerbcast: [
    // -- HARD violations (audit §1, "HARD violations" table) --
    "packages/app/src/dataSources/index.ts",
    "packages/app/src/peer/PeerClientService.ts",
    "packages/app/src/peer/PeerHostProvider.tsx",
    "packages/app/src/peer/PeerHostService.ts",
    "packages/app/src/peer/protocol.ts",
    "packages/app/src/screens/MainScreen.tsx",
    "packages/app/src/screens/StationScreen.tsx",
    "packages/app/src/settings/SettingsModal.tsx",
    // packages/components/src/DistanceToTarget/index.tsx was here: its built-in
    // HudCamera imported @ksp-gonogo/kerbcast-feed directly. That backdrop is
    // now the `kerbcast-docking-camera` AUGMENT filling the widget's
    // `distance-to-target.camera` slot, and the widget names no camera mod at
    // all — so the entry went stale and ratcheted off.

    // -- GRAY — sitrep-client / contract layer, comment or string-literal only --
    "mod/GonogoKosUplink/client/src/index.ts",
    "mod/Sitrep.Contract/UplinkContract.cs",
    "mod/Sitrep.Host/ChannelEngine.cs",
    "packages/sitrep-client/src/context.tsx",
    "packages/sitrep-client/src/delay-authority.ts",
    "packages/sitrep-client/src/map-command.ts",
    "packages/sitrep-client/src/map-topic.test.ts",
    "packages/sitrep-client/src/map-topic.ts",
    // view-clock.ts/view-clock-formula.ts: cross-browser kerbcast
    // video-delay design (2026-07-16) extracted ViewClock's
    // confirmedEdgeUt()/utNowEstimate() formula into pure functions
    // (view-clock-formula.ts) so the kerbcast per-frame delay WORKER can
    // mirror it exactly instead of forking it — see ViewClock.snapshot().
    // Comment/doc mentions only; neither file imports anything
    // kerbcast-specific, and sitrep-client stays mod-agnostic — same GRAY
    // shape as the other entries in this block.
    "packages/sitrep-client/src/view-clock-formula.ts",
    "packages/sitrep-client/src/view-clock.ts",

    // -- GRAY — the kerbcast Uplink's CONTRACT/SDK layer --
    // Every Uplink's wire types live in Sitrep.Contract and its generated
    // SDK, by design: that is the arm's-length compile surface a
    // third-party Uplink author codes against, and it is the same shape
    // the scansat/kos/comms payload types already have there. These name
    // kerbcast because they ARE kerbcast's contract — they are not core
    // reaching into a mod.
    "mod/Sitrep.Contract/ContractVersion.cs",
    "mod/Sitrep.Contract/KerbcastPayloads.cs",
    "mod/Sitrep.Contract/RtConfig.cs",
    "mod/sitrep-sdk/src/__generated__/contract.ts",
    "mod/sitrep-sdk/src/__generated__/topic-map.ts",
    "mod/sitrep-sdk/src/topics.test.ts",
    "mod/sitrep-sdk/src/topics.ts",
    // default-carried-topics.ts: the raw-topic promotion allowlist, which
    // is a literal-string set and so must name every Uplink's topics —
    // it already names scansat.*, kos.*, recovery.* and comms.* the same
    // way. String literals only; nothing kerbcast-specific is imported.
    "packages/sitrep-client/src/default-carried-topics.ts",

    // WirePayloadCoverageTests.cs: the wire-coverage ratchet. Its
    // FlattenedByProducer set is a literal-string allowlist over every
    // [SitrepContract] type, so it necessarily names every Uplink's payload
    // types — kOS's and the career/vessel POCOs are already listed there the
    // same way. kerbcast's entries record that KerbcastCameraEntry is
    // flattened by its producer (KerbcastCameraEntryBuilder.Build returns a
    // Dictionary) and that the two command-arg types are inbound-only.
    // Type-name strings in a ratchet, not a dependency.
    "mod/Sitrep.Core.Tests/WirePayloadCoverageTests.cs",

    // truenow-allowlist.test.ts: the sibling architectural ratchet. It is a
    // path-keyed allowlist over every Uplink's .cs files, so it necessarily
    // names them all (Gonogo.KSP's SpaceCenter/Career/System/Comms uplinks are
    // already listed there the same way). A path string in a ratchet, not a
    // dependency.
    "packages/core/src/truenow-allowlist.test.ts",

    // -- TEST-only, exercising the HARD cluster above --
    "packages/app/src/__tests__/gamehost-repoints-both.test.tsx",
    "packages/app/src/__tests__/peer-client-service.test.ts",
    "packages/app/src/settings/SettingsModal.test.tsx",

    // -- Doc/comment-only mentions (audit §1, "DOC/comment-only") --
    "packages/app/src/dataSources/migrateGameHost.ts",
    "packages/app/src/dataSources/seedKspHost.ts",
    "packages/core/src/settings/store.ts",
    "packages/core/src/testing/installDomStubs.ts",
    "packages/data/src/FlightsManager/AutoRecordController.tsx",
    "packages/relay/src/bootstrapConfig.ts",
  ],

  // === scansat — owning dir mod/GonogoScansatUplink/
  scansat: [
    // -- HARD violations (audit §2) --
    "packages/app/src/peer/protocol.ts",
    "packages/app/src/screens/StationScreen.tsx",
    "packages/components/src/MapView/MapViewConfig.tsx",
    "packages/components/src/MapView/index.tsx",
    "packages/components/src/MapView/scanOverlay.ts",
    "packages/components/src/MapView/types.ts",
    "packages/components/src/index.ts",
    "packages/core/src/index.ts",
    "packages/core/src/schemas/scansat.ts",
    "packages/core/src/schemas/telemachus.ts",
    "packages/data/src/fog/scanCoverageSync.ts",
    "packages/data/src/fog/useScanSatFogSync.ts",
    "packages/data/src/index.ts",
    "packages/data/src/scansat/scanDecode.ts",
    "packages/data/src/scansat/useScanLayers.ts",

    // -- GRAY — contract/SDK layer --
    "mod/Sitrep.Contract/ContractVersion.cs",
    "mod/Sitrep.Contract/RtConfig.cs",
    "mod/Sitrep.Contract/ScanPayloads.cs",
    "mod/Sitrep.Contract/UplinkContract.cs",
    "mod/sitrep-sdk/src/__generated__/topic-map.ts",
    "mod/sitrep-sdk/src/topics.test-d.ts",
    "mod/sitrep-sdk/src/topics.test.ts",
    "mod/sitrep-sdk/src/topics.ts",
    "packages/sitrep-client/src/default-carried-topics.ts",
    "packages/sitrep-client/src/map-topic.ts",

    // -- TEST-only --
    "mod/Sitrep.Core.Tests/WirePayloadCoverageTests.cs",
    "mod/Sitrep.Host.IntegrationTests/FoundationChannelsEndToEndTests.cs",
    "packages/components/src/MapView/index.test.tsx",
    "packages/components/src/MapView/scanOverlay.test.ts",
    "packages/components/src/MapView/stream.test.tsx",
    "packages/core/src/augments.test.tsx",
    "packages/data/src/fog/scanCoverageSync.test.ts",
    "packages/sitrep-client/src/map-topic.test.ts",

    // -- Cross-mod / doc-comment-only mentions (audit §2, "not violations") --
    "mod/Gonogo.KSP/CareerUplink.cs",
    "mod/Gonogo.KSP/CommsCoreUplink.cs",
    "mod/Gonogo.KSP/SystemUplink.cs",
    "mod/GonogoKosUplink.Tests/KosVersionGuardTests.cs",
    "mod/GonogoKosUplink/KosExtension.cs",
    "mod/GonogoKosUplink/KosVersionGuard.cs",
    "mod/GonogoDevTools/GonogoDevAutoLoad.cs",
    "mod/Sitrep.Host/ChannelEngine.cs",
    // sanctioned self-registration import, same pattern as `@ksp-gonogo/kos`
    // in main.tsx below.
    "packages/app/src/main.tsx",
    // borderline/soft per audit: only imports the SCANType *type* from core,
    // which is itself the schema-location violation tracked above.
    "packages/data/src/fog/FogMaskStore.ts",
    // G2 TrueNow-allowlist ratchet (task 4) names ScansatUplink.cs in a
    // justification comment while inventorying every TrueNow declaration
    // in mod/ — doc-mention only, same class as CareerUplink.cs above.
    "packages/core/src/truenow-allowlist.test.ts",
    // -- Uplink LOADER (Phase A, 2026-07-17): the runtime client loader names
    // scansat as the first-party Uplink it loads via import() behind a flag —
    // sanctioned loader-config, the concrete shape of the "P7 retires" debt the
    // kerbcast header above anticipates. flag.ts holds the enabled-id list; the
    // loader's unit test uses scansat as its example Uplink (TEST-only). The
    // loader module itself (loader.ts) is generic and names no mod.
    "packages/app/src/uplinks/flag.ts",
    "packages/app/src/uplinks/loader.test.ts",
  ],

  // === kos — owning dir mod/GonogoKosUplink/
  kos: [
    // -- HARD violations (audit §3): a full second kOS client living in
    // packages/app, plus JsonWriter.cs hardcoding kOS payload shapes in the
    // shared engine, plus PeerHostService.ts's handleKosExecuteRequest
    // (same shape as the other peer-transport HARD hits; found by this
    // ratchet's scan, not individually named in the audit's kOS table).
    "mod/Sitrep.Core/Serialization/JsonWriter.cs",
    "packages/app/src/dataSources/KosCpuDiscovery.tsx",
    "packages/app/src/dataSources/kos.ts",
    "packages/app/src/dataSources/kosCompute.ts",
    "packages/app/src/dataSources/kosUplinkExecutor.ts",
    "packages/app/src/dataSources/kosWrapper.ts",
    "packages/app/src/peer/PeerClientDataSource.ts",
    "packages/app/src/peer/PeerClientService.ts",
    "packages/app/src/peer/PeerHostService.ts",
    "packages/app/src/peer/protocol.ts",
    "packages/app/src/screens/MainScreen.tsx",
    "packages/app/src/telemetry/SitrepPeerRelay.tsx",

    // -- GRAY — contract/SDK layer (real kOS POCOs, not just topic strings) --
    "mod/Sitrep.Contract/ContractVersion.cs",
    "mod/Sitrep.Contract/KosCommands.cs",
    "mod/Sitrep.Contract/KosRun.cs",
    "mod/Sitrep.Contract/KosTerminal.cs",
    "mod/Sitrep.Contract/RtConfig.cs",
    "mod/Sitrep.Contract/UplinkContract.cs",
    // Engine sticky-reveal integration test: the diff-channel keyframe-retention
    // feature is generic engine behaviour, but its canonical test case is the kOS
    // terminal, so the test names KosTerminalFrame as the concrete diff-channel
    // example. Engine test, not engine shipping code — the boundary holds. (2026-07-16)
    "mod/Sitrep.Host.IntegrationTests/ChannelEngineTests.cs",
    // pending-uplink contract: its Command field doc-comment gives
    // `kos.run` as the example wire command name — doc-mention only.
    "mod/Sitrep.Contract/UplinkPending.cs",
    "mod/sitrep-sdk/src/__generated__/contract.ts",
    "mod/sitrep-sdk/src/__generated__/topic-map.ts",
    "mod/sitrep-sdk/src/topics.test-d.ts",
    "mod/sitrep-sdk/src/topics.test.ts",
    "mod/sitrep-sdk/src/topics.ts",
    // The author-facing SDK barrel re-exposes `registerKosScript` /
    // `KosScriptDefinition` — a CORE framework capability (centralised kOS
    // feeds, CLAUDE.md), not the kOS Uplink's internals. The shims delegate to
    // the injected host and name kOS only as a framework author-surface member,
    // exactly the GRAY contract/SDK-layer exception. The conformance guard in
    // core and the shape-gate tests reference the same surface. (2026-07-17)
    "mod/sitrep-sdk/src/api/host.ts",
    "mod/sitrep-sdk/src/api/index.ts",
    "mod/sitrep-sdk/src/api/types.ts",
    "mod/sitrep-sdk/src/api/api-shape.gate.test.ts",
    "mod/sitrep-sdk/src/api/api-shape.test-d.ts",
    "packages/core/src/sdk-facade.conformance.test-d.ts",
    // The Uplink loader's injected-host facade (Phase A, 2026-07-17) wires the
    // app's real `registerKosScript` into globalThis.__GONOGO_SDK__ — it names
    // kOS only as a framework author-surface member (same GRAY exception as the
    // sitrep-sdk api barrel above), not the kOS Uplink's internals.
    "packages/app/src/uplinks/host.ts",
    // dispatch()'s label doc-comment cites `kos.keystroke` as the example
    // line-mode command whose composed text becomes the queue label —
    // comment-only, no kOS coupling in the client spine.
    "packages/sitrep-client/src/client.ts",
    // -- comment/doc + pending-topic mentions (no kOS coupling) --
    // FleetComms + CameraFeed doc-comments reference `KosTerminal`'s
    // in-transit-strip / command-response pattern; Comms.cs's CommsLink doc
    // mentions the kOS terminal reading comms.link. FleetComms/pendingPulse
    // render `system.uplink.pending` entries whose commands include
    // kos.run/kos.keystroke (topic-string mention, like UplinkPending.cs).
    "packages/components/src/FleetComms/index.tsx",
    "packages/components/src/FleetComms/pendingPulse.ts",
    "packages/components/src/FleetComms/slot.test.tsx",
    "mod/GonogoKerbcastUplink/client/src/CameraFeed/CameraFeed.tsx",
    "mod/GonogoKerbcastUplink/client/src/CameraFeed/CameraFeed.test.tsx",
    "mod/Sitrep.Contract/Comms.cs",
    "packages/sitrep-client/src/default-carried-topics.ts",
    "packages/sitrep-client/src/map-command.test.ts",
    "packages/sitrep-client/src/map-topic.test.ts",
    "packages/sitrep-client/src/map-topic.ts",

    // -- TEST-only --
    // pending-uplink wire tests use "kos.run" as the sample command name;
    // CommsGateCommandTests's doc-comment cites a kOS keystroke as the
    // canonical delayed command gated during a blackout — test/doc only.
    "mod/Sitrep.Core.Tests/CommandRequestLabelWireTests.cs",
    "mod/Sitrep.Core.Tests/CourierReliableOrderedDeliveryTests.cs",
    "mod/Sitrep.Core.Tests/KosProcessorInfoWireTests.cs",
    "mod/Sitrep.Core.Tests/PendingUplinkQueueWireTests.cs",
    "mod/Sitrep.Core.Tests/WirePayloadCoverageTests.cs",
    "mod/Sitrep.Host.IntegrationTests/CommsGateCommandTests.cs",
    "mod/Sitrep.Host.IntegrationTests/KosProcessorsWireTests.cs",
    "mod/Sitrep.Host.Tests/UplinkDiscoveryTests.cs",
    "mod/sitrep-sdk/src/generated.test.ts",
    "packages/app/src/__tests__/fixtures/FakeKosUplink.ts",
    "packages/app/src/__tests__/kos-compute-centralised.test.tsx",
    "packages/app/src/__tests__/kos-compute-integration.test.tsx",
    "packages/app/src/__tests__/kos-cpu-discovery.test.tsx",
    "packages/app/src/__tests__/kos-execute-tunnel.test.ts",
    "packages/app/src/__tests__/kos-execute-uplink.test.ts",
    "packages/app/src/__tests__/peer-client-service.test.ts",
    // peer label/topic tunnel tests use "kos.run" as the sample command and
    // cite a kOS command in a doc-comment — test/doc-only, no coupling.
    "packages/app/src/__tests__/sitrep-command-label-topic-tunnel.test.ts",
    "packages/app/src/dataSources/kosUplinkExecutor.test.ts",
    "packages/app/src/dataSources/kosWrapper.test.ts",
    "packages/app/src/settings/SettingsModal.test.tsx",
    "packages/app/src/telemetry/PeerTransport.test.ts",
    "packages/app/src/telemetry/SitrepPeerRelay.test.tsx",
    "packages/components/src/DataSourceStatus/index.test.tsx",
    "packages/components/src/ManeuverPlanner/index.test.tsx",
    "packages/components/src/test/widgets.axe.test.tsx",
    "packages/core/src/hooks/map-command.coverage.test.ts",
    "packages/core/src/kos/scriptRegistry.test.ts",
    "packages/core/src/styleguide-styled-components.test.ts",
    "packages/data/src/BufferedDataSource.test.ts",
    "packages/data/src/hooks/useDataSchema.test.tsx",
    "packages/data/src/hooks/useKosWidget.test.tsx",
    "packages/data/src/kos/kos-data-parser.test.ts",

    // -- SPECIAL-CASE: "centralised kOS scripts" infra (audit §3). CLAUDE.md
    // documents registerKosScript / ScriptableDataSource / KosScriptError /
    // CpuRegistryService as a deliberate generic extension point, judged
    // clean by the audit. The files below are that infra plus its direct
    // satellites (barrel exports, the registry's clearKosScripts() import,
    // the [KOSDATA] parser, the CPU-registry context) — same judgment,
    // found by this ratchet's scan rather than individually audited.
    "packages/core/src/kos/scriptRegistry.ts",
    "packages/core/src/registry.ts",
    "packages/data/src/hooks/useKosScriptStatus.ts",
    "packages/data/src/hooks/useKosWidget.ts",
    "packages/data/src/index.ts",
    "packages/data/src/kos/CpuRegistryContext.tsx",
    "packages/data/src/kos/CpuRegistryService.ts",
    "packages/data/src/kos/KosScriptError.ts",
    "packages/data/src/kos/ScriptableDataSource.ts",
    "packages/data/src/kos/hashKosScript.ts",
    "packages/data/src/kos/kos-data-parser.ts",

    // -- Doc/comment-only mentions elsewhere (kOS is a documented Key
    // Design Constraint — "optional, not a hard dependency" — so it is
    // named in prose across many otherwise-unrelated files) --
    // dev-only comms override: its doc-comment cites `kos.keystroke` as an
    // example command to gate during a blackout — comment-only.
    "mod/Gonogo.KSP/DevCommsOverride.cs",
    "mod/Gonogo.KSP/VesselUplink.cs",
    "mod/GonogoTelemetry/src/TechTreeApi.cs",
    "mod/Sitrep.Contract/SitrepUplinkAttribute.cs",
    "mod/Sitrep.Contract/VesselControl.cs",
    "mod/Sitrep.Core.Tests/CommsWireTests.cs",
    "mod/Sitrep.Core/Courier.cs",
    "mod/Sitrep.Host.IntegrationTests/FoundationChannelsEndToEndTests.cs",
    "mod/Sitrep.Host/ChannelEngine.cs",
    "mod/Sitrep.Host/UplinkDiscovery.cs",
    "packages/app/src/__tests__/peer-client-data-source.test.ts",
    "packages/app/src/alarms/types.ts",
    "packages/app/src/components/ComponentOverlay.tsx",
    "packages/app/src/dataSources/seedKspHost.ts",
    "packages/app/src/logs/LogsManager.tsx",
    // sanctioned self-registration import (`import "@ksp-gonogo/kos"`),
    // same pattern as importing @ksp-gonogo/components.
    "packages/app/src/main.tsx",
    "packages/app/src/peer/PeerBroadcastingDataSource.ts",
    "packages/app/src/peer/RequestTracker.ts",
    "packages/components/src/CrewManifest/index.tsx",
    "packages/components/src/ManeuverPlanner/index.tsx",
    "packages/components/src/TargetPicker/index.tsx",
    "packages/core/src/safeRandomUuid.ts",
    "packages/core/src/testing/installDomStubs.ts",
    "packages/core/src/types.ts",
    "packages/data/src/BufferedDataSource.ts",
    "packages/data/src/flightDetector.ts",
    "packages/data/src/hooks/useDataSchema.ts",
    "packages/data/src/replaySession/ReplaySessionProvider.tsx",
    "packages/data/src/types.ts",
    // packages/kerbcast/src/index.ts was here (a "alongside Telemachus / kOS /
    // etc." aside in its header). That package is now
    // mod/GonogoKerbcastUplink/client, and its rewritten header no longer names
    // another Uplink at all — stale twice over, so it ratcheted off.
    "packages/relay/src/bootstrapConfig.ts",
    "packages/sitrep-client/src/stream-status.ts",
    "packages/sitrep-client/src/timeline-store.ts",
    "packages/sitrep-client/src/use-certainty.ts",
    "packages/sitrep-client/src/use-stream-status.ts",
    "packages/ui/src/VersionMismatchBanner.tsx",
  ],

  // === realantennas — owning dir mod/GonogoRealAntennasUplink/. The
  // cleanest of the four: zero HARD violations per the audit.
  realantennas: [
    // -- Judgment calls, all resolved clean (audit §4) --
    "mod/Gonogo.KSP/CommNetBackend.cs",
    "mod/Gonogo.KSP/CommsCoreUplink.cs",
    // dev-only comms override + its DevTools driver both name the stock
    // comms backends ("CommNet / RealAntennas") in doc-comments explaining
    // what they force — comment-only, no RA coupling.
    "mod/Gonogo.KSP/DevCommsOverride.cs",
    "mod/Gonogo.KSP/GonogoAddon.cs",
    "mod/GonogoDevTools/GonogoDevForceComms.cs",
    "mod/Sitrep.Contract/UplinkContract.cs",
    "mod/Sitrep.Host/ChannelEngine.cs",
    "mod/Sitrep.Host/Comms/CommsElection.cs",
    "mod/Sitrep.Host/Comms/SignalDelay.cs",
    // The action-groups capability seam is a deliberate copy of the comms
    // precedent above, and its doc-comments say so: they cite
    // GonogoRealAntennasUplink as the worked example of a provider elected
    // over the stock backend that ships no client code of its own. Prose
    // only — no RA type, reference or coupling; same category as
    // Comms/CommsElection.cs itself.
    "mod/Sitrep.Host/ActionGroups/ActionGroupsElection.cs",
    "mod/Sitrep.Host/ActionGroups/IActionGroupsBackend.cs",
    "packages/components/src/CommSignal/index.tsx",
    "packages/components/src/SystemView/index.tsx",
    // G2 TrueNow-allowlist ratchet (task 4) names RealAntennasUplink.cs in
    // a justification comment while inventorying every TrueNow
    // declaration in mod/ — doc-mention only.
    "packages/core/src/truenow-allowlist.test.ts",
    // The AGX uplink is the SAME election shape RA established for comms
    // (docs/superpowers/specs/2026-07-17-agx-backend-design.md §2), and its
    // doc-comments say so explicitly, citing GonogoRealAntennasUplink /
    // RaReflection as the worked precedent — prose only, no RA type,
    // reference or coupling.
    "mod/GonogoActionGroupsExtendedUplink/ActionGroupsExtendedUplink.cs",
    "mod/GonogoActionGroupsExtendedUplink/AgxReflection.cs",

    // -- GRAY — Sitrep.Contract/Comms.cs carries three RA-only payload types --
    "mod/Sitrep.Contract/Comms.cs",

    // -- TEST-only --
    "mod/Sitrep.Core.Tests/CommsWireTests.cs",
    "mod/Sitrep.Host.IntegrationTests/FoundationChannelsEndToEndTests.cs",
    "mod/Sitrep.Host.Tests/CommsElectionTests.cs",
    "packages/components/src/CommSignal/slot.test.tsx",
    "packages/sitrep-client/src/map-topic.rawFieldRoots.coverage.test.ts",
    // AGX's own election/reflection tests cite CommsElectionTests /
    // RaReflection as the pattern they mirror — doc-mention only.
    "mod/GonogoActionGroupsExtendedUplink.Tests/ActionGroupsExtendedElectionTests.cs",
    "mod/GonogoActionGroupsExtendedUplink.Tests/AgxReflectionTests.cs",
  ],

  // === agx — owning dir mod/GonogoActionGroupsExtendedUplink/. Every entry
  // below PRE-DATES the AGX uplink (Phase 1 named action groups and left the
  // seam ready, per docs/superpowers/specs/2026-07-17-agx-backend-design.md
  // §0/§1) — doc-comment mentions of "Action Groups Extended (AGX)" or the
  // provider-id identifiers explaining WHY the seam is shaped the way it is,
  // not AGX coupling. No file below imports, references, or derives from
  // anything in the new owning dir.
  agx: [
    // -- Judgment calls, all doc-mention only (Phase 1's seam commentary) --
    // The provider-registration seam itself: constant/method names
    // (ActionGroupsExtendedProviderId, RegisterActionGroupsExtendedProvider)
    // and prose explaining this file IS where a future AGX uplink plugs in
    // — the whole point of §1's "the seam Phase 1 left ready".
    "mod/Sitrep.Host/ActionGroups/ActionGroupsElection.cs",
    // Doc-comment explaining why the capability's Groups() list is
    // named/arbitrary-length rather than a positional bool[] — cites
    // "Action Groups Extended (AGX)" as the reason, no AGX coupling.
    "mod/Sitrep.Host/ActionGroups/IActionGroupsBackend.cs",
    // ContractVersion's migration-history doc-comment for the
    // bool[]->ActionGroupState[] change names AGX as the reason the
    // contract had to stop being positional.
    "mod/Sitrep.Contract/ContractVersion.cs",
    // VesselControl.ActionGroupState's doc-comment: same "AGX needs named,
    // arbitrary-length groups" rationale for the wire type's shape.
    "mod/Sitrep.Contract/VesselControl.cs",
    // VesselCommandProvider's SetActionGroup handler doc-comment: explains
    // it can no longer assume a 1..10 bound "because Action Groups Extended
    // legitimately goes to 250" — prose only, no AGX type/reference.
    "mod/Sitrep.Host/VesselCommandProvider.cs",
    "packages/sitrep-client/src/map-topic.ts",
    "packages/sitrep-client/src/vessel-state.ts",

    // -- TEST-only --
    // Regression-comment mirrors the VesselCommandProvider rationale above.
    "mod/Sitrep.Host.Tests/VesselCommandProviderTests.cs",
  ],
};

const SCAN_EXTENSIONS = /\.(tsx?|cs)$/;
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "bin",
  "obj",
  "coverage",
  ".turbo",
]);
// This file itself names every mod token in its patterns/comments/allowlist
// — that's the guardrail's own vocabulary, not a boundary violation.
const SELF_PATH = "packages/core/src/uplink-boundary.test.ts";

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) yield* walk(path);
    else if (SCAN_EXTENSIONS.test(name)) yield path;
  }
}

function scanRoots(root: string): string[] {
  const roots: string[] = [];
  const packagesDir = join(root, "packages");
  if (existsSync(packagesDir)) {
    for (const pkg of readdirSync(packagesDir)) {
      const src = join(packagesDir, pkg, "src");
      if (existsSync(src) && statSync(src).isDirectory()) roots.push(src);
    }
  }
  const modDir = join(root, "mod");
  if (existsSync(modDir)) roots.push(modDir);
  return roots;
}

function isUnderOwnedDir(relPath: string, ownedDirs: string[]): boolean {
  return ownedDirs.some(
    (dir) => relPath === dir || relPath.startsWith(`${dir}/`),
  );
}

/** All files (relative to repo root) that reference `token` outside its owning dir. */
function findViolations(root: string, token: ModToken): string[] {
  const { patterns, ownedDirs } = MOD_OWNERSHIP[token];
  const hits: string[] = [];
  for (const scanRoot of scanRoots(root)) {
    for (const file of walk(scanRoot)) {
      const rel = relative(root, file);
      if (rel === SELF_PATH) continue;
      if (isUnderOwnedDir(rel, ownedDirs)) continue;
      const content = readFileSync(file, "utf8");
      if (patterns.some((re) => re.test(content))) hits.push(rel);
    }
  }
  return hits;
}

describe("uplink boundary: mod references stay inside their owning Uplink", () => {
  for (const token of Object.keys(MOD_OWNERSHIP) as ModToken[]) {
    it(`${token} — matches the seeded allowlist exactly`, () => {
      const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
      const found = new Set(findViolations(root, token));
      const allowed = new Set(ALLOWLIST[token]);

      const newViolations = [...found].filter((f) => !allowed.has(f));
      const staleEntries = [...allowed].filter((f) => !found.has(f));

      if (newViolations.length > 0) {
        throw new Error(
          `New "${token}" reference(s) found outside ${MOD_OWNERSHIP[token].ownedDirs.join(", ")}:\n` +
            newViolations.map((f) => `  ${f}`).join("\n") +
            `\n\nEither move this code into the owning Uplink dir, or if it's an ` +
            `intentional, reviewed exception (contract/SDK layer, a new test, a ` +
            `sanctioned self-registration import), add it to ALLOWLIST.${token} in ` +
            `packages/core/src/uplink-boundary.test.ts with a comment explaining why. ` +
            `See docs/superpowers/specs/2026-07-13-uplink-boundary-audit.md.`,
        );
      }

      if (staleEntries.length > 0) {
        throw new Error(
          `Stale "${token}" allowlist entries — these no longer contain a matching ` +
            `reference (the violation was fixed, or the file moved/was deleted). ` +
            `Delete the line(s) from ALLOWLIST.${token} in packages/core/src/uplink-boundary.test.ts ` +
            `to ratchet the gate down:\n` +
            staleEntries.map((f) => `  ${f}`).join("\n"),
        );
      }

      expect(newViolations).toEqual([]);
      expect(staleEntries).toEqual([]);
      // Walks packages/*/src + mod/ once per token; under concurrent
      // core-suite load a single walk can exceed vitest's 5s default.
    }, 30_000);
  }
});
