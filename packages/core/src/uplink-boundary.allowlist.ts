/**
 * Data for the uplink-boundary ratchet (`uplink-boundary.test.ts`). Pure
 * data module — no test logic, no scan mechanics — so the shrink-only
 * check in that file can load this module's content at an arbitrary git
 * ref (via `git show <ref>:<path>` + an esbuild transpile) without pulling
 * in vitest or the walk/pattern machinery.
 *
 * Full catalogue, categorisation (HARD / gray / test / comment-only), and
 * the reasoning behind every entry below:
 *   docs/superpowers/specs/2026-07-13-uplink-boundary-audit.md
 *   docs/superpowers/specs/2026-07-18-ratchet-hardening-design.md
 *
 * Every token's allowlist splits into two buckets:
 *
 *   - `permanent` — wire/contract/generated-code files (naming the mod IS
 *     the file's job), cross-Uplink ratchet/inventory files that by design
 *     enumerate every Uplink, sanctioned self-registration imports, and
 *     text-only doc/comment mentions with zero code coupling. Unconstrained:
 *     add or remove via a normal reviewed edit, same as the allowlist
 *     worked before this split.
 *   - `domainDebt` — real code coupling to the mod, living outside its
 *     owning Uplink directory. SHRINK-ONLY, mechanically enforced by the
 *     "domain-debt allowlist entries only ever shrink" test in
 *     `uplink-boundary.test.ts`: it diffs each token's `domainDebt` set
 *     against the same file's content at a base git ref and fails if the
 *     new set isn't a subset of the old one. Remove a line here when the
 *     coupling is fixed (code moved into the owning Uplink dir). Never add
 *     one — if a new reference genuinely belongs here, that means new code
 *     just created a boundary violation; move the code instead of filing
 *     it here. (If it's actually a permanent wire/contract/doc-mention
 *     reference, it goes in `permanent`, which has no such gate.)
 *
 * The dividing line in one sentence: if there's code to move, it's
 * domain-debt; if naming the mod is the file's actual job (wire shape) or
 * the mention is just words, it's permanent.
 */

export type ModToken = "kerbcast" | "scansat" | "kos" | "realantennas" | "agx";

export interface ModAllowlist {
  /** Wire/contract/generated-code files, cross-Uplink ratchet/inventory
   *  files, sanctioned self-registration imports, and text-only doc/
   *  comment mentions with zero code coupling. Unconstrained. */
  permanent: string[];
  /** Real code coupling to the mod, outside its owning Uplink dir.
   *  SHRINK-ONLY — see the shrink-only test in uplink-boundary.test.ts.
   *  Remove a line when the coupling is fixed. Never add one. */
  domainDebt: string[];
}

export const ALLOWLIST: Record<ModToken, ModAllowlist> = {
  // === kerbcast — owning dir mod/GonogoKerbcastUplink/ (incl. its client/).
  kerbcast: {
    domainDebt: [
      // -- HARD violations (audit §1, "HARD violations" table). The
      // app's own bootstrap/peer wiring, which stays until the
      // Uplink-client LOADER lands — today every Uplink client is still
      // bundled at build, so the app must name them to import them. See
      // uplink architecture §1's "P7 retires" tech-debt note.
      "packages/app/src/screens/MainScreen.tsx",
      "packages/app/src/screens/StationScreen.tsx",
      // packages/components/src/DistanceToTarget/index.tsx was here: its built-in
      // HudCamera imported @ksp-gonogo/kerbcast-feed directly. That backdrop is
      // now the `kerbcast-docking-camera` AUGMENT filling the widget's
      // `distance-to-target.camera` slot, and the widget names no camera mod at
      // all — so the entry went stale and ratcheted off.

      // -- TEST-only, exercising the HARD cluster above --
      "packages/app/src/__tests__/gamehost-repoints-both.test.tsx",
    ],
    permanent: [
      // -- Uplink LOADER (Phase A, 2026-07-17; kerbcast migration, 2026-07-18):
      // the runtime client loader names kerbcast as a first-party Uplink it
      // loads via import() behind a flag, same as the pre-existing scansat/kos
      // entries. main.tsx's bundled-fallback Promise.all() gained a third
      // `import("@ksp-gonogo/kerbcast-feed")` alongside kos/scansat; flag.ts's
      // LOADER_UPLINK_IDS gained "kerbcast"; flag.test.ts asserts all three ids
      // are present — sanctioned loader-config, not a boundary hole.
      "packages/app/src/main.tsx",
      "packages/app/src/uplinks/flag.test.ts",
      "packages/app/src/uplinks/flag.ts",

      // -- sitrep-client / contract layer, comment or string-literal only --
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
      // kerbcast-specific, and sitrep-client stays mod-agnostic.
      "packages/sitrep-client/src/view-clock-formula.ts",
      "packages/sitrep-client/src/view-clock.ts",

      // -- the kerbcast Uplink's CONTRACT/SDK layer --
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

      // -- Doc/comment-only mentions (audit §1, "DOC/comment-only") --
      "packages/app/src/dataSources/migrateGameHost.ts",
      "packages/app/src/dataSources/seedKspHost.ts",
      "packages/core/src/settings/store.ts",
      "packages/core/src/testing/installDomStubs.ts",
      "packages/data/src/FlightsManager/AutoRecordController.tsx",
      "packages/relay/src/bootstrapConfig.ts",
      // slots.ts's header comment explains why kerbcast's OWN CameraFeed
      // slots ("camera-feed.overlay"/".badges") are deliberately NOT
      // centrally mirrored here (would need the sdk leaf to import from an
      // Uplink client package — the same turbo `^build` cycle the whole
      // file's mirroring approach exists to avoid). Comment-only; nothing
      // kerbcast-specific is imported or re-exported.
      "mod/sitrep-sdk/src/api/slots.ts",
      // sdk-facade.conformance.test-d.ts: the drift-guard's own comment on
      // the new DelayClockLike assertion names kerbcast as the mirror's
      // consumer (facade-sealing the kerbcast client, 2026-07-19). Prose
      // only — the file imports sitrep-client/sitrep-sdk types, never
      // anything kerbcast-specific.
      "packages/core/src/sdk-facade.conformance.test-d.ts",
    ],
  },

  // === scansat — owning dir mod/GonogoScansatUplink/
  scansat: {
    domainDebt: [
      // -- HARD violations (audit §2) --
      "packages/app/src/peer/protocol.ts",
      "packages/app/src/screens/StationScreen.tsx",
      "packages/components/src/MapView/types.ts",
      "packages/core/src/schemas/telemachus.ts",
      // T9: a deliberately narrow, telemachus-only copy of the wire-shape
      // types the legacy (still-installable, no-longer-app-consumed)
      // Telemachus fork's `scan.*` keys need. The real SCANsat schema lives
      // entirely in mod/GonogoScansatUplink/client/src/schema.ts now — this
      // file exists solely so telemachus.ts keeps typing without reaching
      // into the owning Uplink.
      "packages/core/src/schemas/telemachus-scan-types.ts",
    ],
    permanent: [
      // -- contract/SDK layer --
      "mod/Sitrep.Contract/ContractVersion.cs",
      "mod/Sitrep.Contract/RtConfig.cs",
      "mod/Sitrep.Contract/ScanPayloads.cs",
      "mod/Sitrep.Contract/UplinkContract.cs",
      "mod/sitrep-sdk/src/__generated__/topic-map.ts",
      "mod/sitrep-sdk/src/topics.test-d.ts",
      "mod/sitrep-sdk/src/topics.test.ts",
      "mod/sitrep-sdk/src/topics.ts",
      // slots.ts's header comment explains why scansat's OWN Scanning
      // slots ("scanning.sections"/".badges") are deliberately NOT
      // centrally mirrored here (would need the sdk leaf to import from an
      // Uplink client package — the same turbo `^build` cycle the whole
      // file's mirroring approach exists to avoid). Comment-only; nothing
      // scansat-specific is imported or re-exported.
      "mod/sitrep-sdk/src/api/slots.ts",
      "packages/sitrep-client/src/default-carried-topics.ts",
      "packages/sitrep-client/src/map-topic.ts",

      // -- TEST-only --
      "mod/Sitrep.Core.Tests/WirePayloadCoverageTests.cs",
      "mod/Sitrep.Host.IntegrationTests/FoundationChannelsEndToEndTests.cs",
      // augments.test.tsx uses "scansat" purely as a generic example
      // provider id/channel name (requires: "scansat", channels:
      // ["scansat.available"]) exercising the augment-registration
      // framework — no import of, or coupling to, the real scansat Uplink.
      "packages/core/src/augments.test.tsx",
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
      // T11 (2026-07-19) re-verified this one against current code, not just
      // the original audit prose: FogMaskStore.ts's fog-store rewrite
      // (landed since the original audit) means it no longer imports
      // SCANType/SCAN_TYPE at all — scanType has been an opaque string
      // `layerId` since the v2→v3 migration noted inline. What's left is
      // doc-comment-only mentions of SCANsat as the historical motivator
      // for the migration wipe ("SCANsat regenerates the underlying
      // coverage cheaply", "let SCANsat repopulate..."). Zero code
      // coupling today, so this sits in `permanent`, not `domainDebt` —
      // despite the ratchet-hardening design doc's Part 2.3 example citing
      // "FogMaskStore.ts's SCANType import" as the textbook domain-debt
      // case; that characterisation predates the fog-store rewrite.
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
      // flag.test.ts (kerbcast migration, 2026-07-18): asserts LOADER_UPLINK_IDS
      // contains all three first-party loader ids (scansat/kos/kerbcast) —
      // TEST-only, same shape as loader.test.ts above.
      "packages/app/src/uplinks/flag.test.ts",
    ],
  },

  // === kos — owning dir mod/GonogoKosUplink/
  kos: {
    domainDebt: [
      // -- HARD violations (audit §3): a full second kOS client living in
      // packages/app, plus JsonWriter.cs hardcoding kOS payload shapes in the
      // shared engine, plus PeerHostService.ts's handleKosExecuteRequest
      // (same shape as the other peer-transport HARD hits; found by this
      // ratchet's scan, not individually named in the audit's kOS table).
      "mod/Sitrep.Core/Serialization/JsonWriter.cs",
      "packages/app/src/screens/MainScreen.tsx",
      "packages/app/src/telemetry/SitrepPeerRelay.tsx",

      // -- kos migration (2026-07-18), Task 4: CpuRegistryService/
      // CpuRegistryProvider moved from @ksp-gonogo/data into the kos Uplink.
      // StationScreen constructs its own CpuRegistryService and wraps
      // <CpuRegistryProvider> exactly as MainScreen already does (see the
      // MainScreen.tsx HARD-violation entry above) — same "moved, not
      // removed" pattern the kerbcast migration's own MainScreen.tsx/
      // StationScreen.tsx entries establish for its Uplink.
      "packages/app/src/screens/StationScreen.tsx",
      // Task 5: ComponentOverlay/WidgetGearMenu tests import kos's real
      // kosChromeProvider self-registration (via CpuRegistryProvider/
      // CpuRegistryService, both re-exported by @ksp-gonogo/kos) rather than
      // hand-rolling a bespoke fixture — the more honest integration test per
      // this repo's "mock as little as possible" philosophy, and TEST-only
      // exercising the real domain-coupled provider above.
      "packages/app/src/__tests__/component-overlay-add.test.tsx",
      "packages/app/src/__tests__/dashboard-error-boundary.test.tsx",
      "packages/app/src/__tests__/dashboard-tabbed-config.test.tsx",

      // -- TEST-only, exercising SitrepPeerRelay.tsx (HARD, above) --
      "packages/app/src/telemetry/SitrepPeerRelay.test.tsx",
    ],
    permanent: [
      // -- contract/SDK layer (real kOS POCOs, not just topic strings) --
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
      // mod/sitrep-sdk/src/api/api-shape.gate.test.ts stays: it uses "kos" as
      // an example dataSourceId in a generic `useDataValue("kos", "k")`
      // assertion, unrelated to the (since-removed) registerKosScript/SPI
      // mirrors this file used to also guard.
      "mod/sitrep-sdk/src/api/api-shape.gate.test.ts",
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
      "mod/Sitrep.Core.Tests/PendingUplinkQueueWireTests.cs",
      "mod/Sitrep.Core.Tests/WirePayloadCoverageTests.cs",
      "mod/Sitrep.Host.IntegrationTests/CommsGateCommandTests.cs",
      // KosProcessorsWireTests.cs exercises the kos.processors wire SHAPE —
      // a contract-level wire test, same class as CommandRequestLabelWireTests.
      "mod/Sitrep.Host.IntegrationTests/KosProcessorsWireTests.cs",
      "mod/Sitrep.Host.Tests/UplinkDiscoveryTests.cs",
      "mod/sitrep-sdk/src/generated.test.ts",
      // kos-execute-tunnel.test.ts has zero real kos coupling — it only uses
      // "kos" as a generic Uplink-handle id while exercising app-owned PeerJS
      // relay machinery (kos migration Task 8, 2026-07-18: moved into the kos
      // package and back out once that became clear). Stays in
      // packages/app/src/__tests__ where this entry already covers it.
      "packages/app/src/__tests__/kos-execute-tunnel.test.ts",
      // peer label/topic tunnel tests use "kos.run" as the sample command and
      // cite a kOS command in a doc-comment — test/doc-only, no coupling.
      "packages/app/src/__tests__/sitrep-command-label-topic-tunnel.test.ts",
      // SettingsModal.test.tsx / DataSourceStatus/index.test.tsx use "kos"
      // purely as a generic fixture data-source id ("kOS" display label)
      // exercising the generic Data Sources panel — no real kOS import.
      "packages/app/src/settings/SettingsModal.test.tsx",
      // PeerTransport.test.ts uses "kos.run" / "kos/cpu-1" as sample
      // command/topic strings exercising generic PeerJS transport framing —
      // no real kOS import.
      "packages/app/src/telemetry/PeerTransport.test.ts",
      "packages/components/src/DataSourceStatus/index.test.tsx",
      // ManeuverPlanner/index.test.tsx tests ManeuverPlanner/index.tsx, whose
      // own kOS mention (below) is doc-comment-only — same subject, same
      // category.
      "packages/components/src/ManeuverPlanner/index.test.tsx",
      // widgets.axe.test.tsx's only kOS mention is a doc-comment pointing
      // implementers at Kos*-specific axe-smoke test files elsewhere — no
      // import, no coupling.
      "packages/components/src/test/widgets.axe.test.tsx",
      // map-command coverage test exercises map-command.ts (permanent,
      // above) — same subject, same category.
      "packages/core/src/hooks/map-command.coverage.test.ts",
      "packages/core/src/styleguide-styled-components.test.ts",
      // BufferedDataSource.test.ts / useDataSchema.test.tsx test the doc-
      // comment-only files of the same name below — same subject.
      "packages/data/src/BufferedDataSource.test.ts",
      "packages/data/src/hooks/useDataSchema.test.tsx",

      // "centralised kOS scripts" infra (audit §3; CLAUDE.md). Kos migration
      // (2026-07-18) Tasks 2-4/6 moved registerKosScript/ScriptableDataSource/
      // KosScriptError/CpuRegistryService and their satellites (barrel
      // exports, the [KOSDATA] parser, the CPU-registry context, their own
      // tests) wholesale into the kos Uplink per the operator's explicit
      // "no generalising" call. Only registry.ts's own clearKosScripts()
      // import removal remains a core-side trace — doc/comment-only now.
      "packages/core/src/registry.ts",

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
  },

  // === realantennas — owning dir mod/GonogoRealAntennasUplink/. The
  // cleanest of the four: zero HARD violations per the audit, so zero
  // domainDebt entries.
  realantennas: {
    domainDebt: [],
    permanent: [
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

      // -- Sitrep.Contract/Comms.cs carries three RA-only payload types --
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
  },

  // === agx — owning dir mod/GonogoActionGroupsExtendedUplink/. Every entry
  // below PRE-DATES the AGX uplink (Phase 1 named action groups and left the
  // seam ready, per docs/superpowers/specs/2026-07-17-agx-backend-design.md
  // §0/§1) — doc-comment mentions of "Action Groups Extended (AGX)" or the
  // provider-id identifiers explaining WHY the seam is shaped the way it is,
  // not AGX coupling. No file below imports, references, or derives from
  // anything in the new owning dir. Zero domainDebt entries.
  agx: {
    domainDebt: [],
    permanent: [
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
  },
};
