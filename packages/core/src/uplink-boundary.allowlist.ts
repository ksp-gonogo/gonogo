/**
 * Data for the uplink-boundary ratchet (`uplink-boundary.test.ts`). Pure
 * data module: no test logic, no scan mechanics: so the shrink-only
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
 *   - `permanent`: wire/contract/generated-code files (naming the mod IS
 *     the file's job), cross-Uplink ratchet/inventory files that by design
 *     enumerate every Uplink, sanctioned self-registration imports, and
 *     text-only doc/comment mentions with zero code coupling. Unconstrained:
 *     add or remove via a normal reviewed edit, same as the allowlist
 *     worked before this split.
 *   - `domainDebt`: real code coupling to the mod, living outside its
 *     owning Uplink directory. SHRINK-ONLY, mechanically enforced by the
 *     "domain-debt allowlist entries only ever shrink" test in
 *     `uplink-boundary.test.ts`: it diffs each token's `domainDebt` set
 *     against the same file's content at a base git ref and fails if the
 *     new set isn't a subset of the old one. Remove a line here when the
 *     coupling is fixed (code moved into the owning Uplink dir). Never add
 *     one: if a new reference genuinely belongs here, that means new code
 *     just created a boundary violation; move the code instead of filing
 *     it here. (If it's actually a permanent wire/contract/doc-mention
 *     reference, it goes in `permanent`, which has no such gate.)
 *
 * The dividing line in one sentence: if there's code to move, it's
 * domain-debt; if naming the mod is the file's actual job (wire shape) or
 * the mention is just words, it's permanent.
 */

export type ModToken =
  | "kerbcast"
  | "scansat"
  | "kos"
  | "realantennas"
  | "agx"
  | "mechjeb"
  | "avionics";

export interface ModAllowlist {
  /** Wire/contract/generated-code files, cross-Uplink ratchet/inventory
   *  files, sanctioned self-registration imports, and text-only doc/
   *  comment mentions with zero code coupling. Unconstrained. */
  permanent: string[];
  /** Real code coupling to the mod, outside its owning Uplink dir.
   *  SHRINK-ONLY: see the shrink-only test in uplink-boundary.test.ts.
   *  Remove a line when the coupling is fixed. Never add one. */
  domainDebt: string[];
}

export const ALLOWLIST: Record<ModToken, ModAllowlist> = {
  // === kerbcast: owning dir mod/GonogoKerbcastUplink/ (incl. its client/).
  kerbcast: {
    domainDebt: [
      // -- HARD violations (audit §1, "HARD violations" table). The
      // app's own bootstrap/peer wiring, which stays until the
      // Uplink-client LOADER lands: today every Uplink client is still
      // bundled at build, so the app must name them to import them. See
      // uplink architecture §1's "P7 retires" tech-debt note.
      "packages/app/src/screens/MainScreen.tsx",
      "packages/app/src/screens/StationScreen.tsx",
      // packages/components/src/DistanceToTarget/index.tsx was here: its built-in
      // HudCamera imported @ksp-gonogo/gonogo-kerbcast-uplink directly. That backdrop is
      // now the `kerbcast-docking-camera` AUGMENT filling the widget's
      // `distance-to-target.camera` slot, and the widget names no camera mod at
      // all: so the entry went stale and ratcheted off.

      // -- TEST-only, exercising the HARD cluster above --
      "packages/app/src/__tests__/gamehost-repoints-both.test.tsx",
    ],
    permanent: [
      // -- Uplink Hub wizard welcome copy: user-facing onboarding text naming
      // example Uplinks the Hub can load. Copy, not code coupling.
      "packages/app/src/wizard/steps/WelcomeStep.tsx",
      // -- Uplink LOADER (Phase A, 2026-07-17; kerbcast migration, 2026-07-18):
      // the runtime client loader names kerbcast as a first-party Uplink it
      // loads via import(), same as the pre-existing scansat/kos entries.
      // flag.ts's LOADER_UPLINK_IDS names "kerbcast"; flag.test.ts asserts all
      // three ids are present, sanctioned loader-config, not a boundary hole.
      // main.tsx (D4 step 2, 2026-07-25): its `registerScansatAndRender`
      // function name and doc comments name "kerbcast" as one of the loader-
      // covered first-party 3: no static import left, prose only.
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
      // mirror it exactly instead of forking it; see ViewClock.snapshot().
      // Comment/doc mentions only; neither file imports anything
      // kerbcast-specific, and sitrep-client stays mod-agnostic.
      "packages/sitrep-client/src/view-clock-formula.ts",
      "packages/sitrep-client/src/view-clock.ts",

      // -- the kerbcast Uplink's provenance record in core --
      // ContractVersion.cs's Minor-history doc comment records the ORIGINAL
      // add of kerbcast's control-plane types (Major-4 line, Bumped 0 -> 1)
      // AND RtConfig.cs's own comment records where they went (moved OUT of
      // core into GonogoKerbcastUplink.Contract, uplink-types-out-of-core
      // plan, third relocation, 2026-08-10): prose/history only, the types
      // themselves no longer live here.
      "mod/Sitrep.Contract/ContractVersion.cs",
      "mod/Sitrep.Contract/RtConfig.cs",
      // topic-cs-sync.test.ts: the relocated C#↔runtime-registry sync gate
      // (2026-07-20). It statically imports every first-party Uplink client
      // (kerbcast/kos/scansat) so their `registerBarePrimitiveTopic` calls fire
      // before it reads `getAllKnownTopicIds()`, then asserts that union matches
      // the C#-declared Topic set. A new test that imports the clients for
      // registration; no product-code coupling.
      "packages/app/src/__tests__/topic-cs-sync.test.ts",
      // default-carried-topics.ts: the raw-topic promotion allowlist, which
      // is a literal-string set and so must name every Uplink's topics,
      // it already names scansat.*, kos.*, recovery.* and comms.* the same
      // way. String literals only; nothing kerbcast-specific is imported.
      "packages/sitrep-client/src/default-carried-topics.ts",

      // WirePayloadCoverageTests.cs: the wire-coverage ratchet. Its
      // FlattenedByProducer set is a literal-string allowlist over every
      // [SitrepContract] type, so it necessarily names every Uplink's payload
      // types: kOS's and the career/vessel POCOs are already listed there the
      // same way. kerbcast's comment now records the RELOCATION (the three
      // types left this assembly for GonogoKerbcastUplink.Contract, so no
      // allowlist entry is needed there any more), for the record noting
      // KerbcastCameraEntry was flattened by its producer even while it
      // lived here. Type-name strings in a ratchet, not a dependency.
      "mod/Sitrep.Core.Tests/WirePayloadCoverageTests.cs",

      // UplinkContractOwnershipTests.cs: the mod-side relocation-ownership
      // ratchet (uplink-types-out-of-core plan, §5a). It necessarily names
      // every relocated Uplink's token in its own RelocatedModTokens data and
      // doc comment, kerbcast included now that its three types have moved
      // out: a ratchet naming its own subject, not a boundary violation, same
      // class as the WirePayloadCoverageTests.cs entry above.
      "mod/Sitrep.Core.Tests/UplinkContractOwnershipTests.cs",

      // truenow-allowlist.test.ts: the sibling architectural ratchet. It is a
      // path-keyed allowlist over every Uplink's .cs files, so it necessarily
      // names them all (Gonogo.KSP's SpaceCenter/Career/System/Comms uplinks are
      // already listed there the same way). A path string in a ratchet, not a
      // dependency.
      "packages/core/src/truenow-allowlist.test.ts",
      // styleguide.test.ts: the raw-hex ratchet. Its scan roots now cover
      // mod/*/client/src (they did not, which is how three raw hex literals in
      // shipped uplink widgets went ungated), so its baseline comment names the
      // one remaining offender by path: CameraFeed.tsx's feed-unavailable
      // scrim colour. A path string in a ratchet inventory, same category as
      // truenow-allowlist.test.ts above; nothing is imported.
      "packages/core/src/styleguide.test.ts",

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
      // Uplink client package: the same turbo `^build` cycle the whole
      // file's mirroring approach exists to avoid). Comment-only; nothing
      // kerbcast-specific is imported or re-exported.
      "mod/sitrep-sdk/src/api/slots.ts",
      // sdk-facade.conformance.test-d.ts: the drift-guard's own comment on
      // the new DelayClockLike assertion names kerbcast as the mirror's
      // consumer (facade-sealing the kerbcast client, 2026-07-19). Prose
      // only: the file imports sitrep-client/sitrep-sdk types, never
      // anything kerbcast-specific.
      "packages/core/src/sdk-facade.conformance.test-d.ts",
      // Comms + kOS IUplinkHealthReporter implementations (2026-07-19) cite
      // KerbcastUplink/KerbcastHealth in doc comments as the reference
      // reporter pattern they mirror (the KerbcastHealth pure-Evaluate split
      // was the first-party precedent). Prose only, no import, type, or code
      // coupling to the kerbcast Uplink; same class as the RA/AGX "worked
      // example" citations elsewhere in this file.
      "mod/Gonogo.KSP/CommsCoreUplink.cs",
      "mod/Sitrep.Host/Comms/CommsHealth.cs",
      "mod/Sitrep.Host.Tests/CommsHealthTests.cs",
      "mod/GonogoKosUplink/KosExtension.cs",
      "mod/GonogoKosUplink/KosExtension.Ksp.cs",
      "mod/GonogoKosUplink/KosHealth.cs",
      "mod/GonogoKosUplink.Tests/KosHealthTests.cs",
      // loaderState.test.ts (Hub-wizard plumbing, 2026-07-19): TEST-only,
      // names kerbcast as one of the three bundled-fallback ids it feeds
      // recordBundledOutcomes(): same shape as loader.test.ts/flag.test.ts
      // below (loaderState.ts itself is generic and names no mod).
      "packages/app/src/uplinks/loaderState.test.ts",
      // event-timeline.ts (event-stream primitive, 2026-07-22): a text-only
      // doc-comment mention ("see the kerbcast-Uplink") in a mod-agnostic
      // sitrep-client primitive. Words only, nothing kerbcast-specific is
      // imported: permanent, same class as the other doc-mention citations.
      "packages/sitrep-client/src/event-timeline.ts",
      // AlarmHostService.ts (event alarm wiring, 2026-07-22): a text-only
      // doc-comment mention ("the kerbcast Uplink's producer"): the service
      // is mod-agnostic and takes an externally-wired producer; nothing
      // kerbcast-specific is imported. Its test names the "kerbcast.events"
      // topic id as a string literal only (TEST-only, same class as
      // loaderState.test.ts / flag.test.ts above). Both permanent.
      "packages/app/src/alarms/AlarmHostService.ts",
      "packages/app/src/alarms/AlarmHostService.test.ts",
    ],
  },

  // === scansat: owning dir mod/GonogoScansatUplink/
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
      // entirely in mod/GonogoScansatUplink/client/src/schema.ts now: this
      // file exists solely so telemachus.ts keeps typing without reaching
      // into the owning Uplink.
      "packages/core/src/schemas/telemachus-scan-types.ts",
    ],
    permanent: [
      // -- Uplink Hub wizard welcome copy: user-facing onboarding text naming
      // example Uplinks the Hub can load. Copy, not code coupling.
      "packages/app/src/wizard/steps/WelcomeStep.tsx",
      // -- contract/SDK layer --
      "mod/Sitrep.Contract/ContractVersion.cs",
      "mod/Sitrep.Contract/RtConfig.cs",
      "mod/Sitrep.Contract/ScanPayloads.cs",
      "mod/Sitrep.Contract/UplinkContract.cs",
      "mod/sitrep-sdk/src/__generated__/topic-map.ts",
      // Same codegen run as topic-map.ts above, same reflection over the same
      // assembly: it names a payload type for every field carrying a
      // [SitrepUnit], and ScanPayloads.cs (already listed here) now carries
      // them. Generated output, not core reaching into a mod.
      "mod/sitrep-sdk/src/__generated__/units.ts",
      // topics.test-d.ts stays: it still type-asserts the GENERATED
      // `scansat.scanningVessels` Topic (a real Sitrep.Contract payload,
      // `ScanningVesselEntry[]`). Only the bare-primitive `scansat.available` (which
      // had no contract type) moved out to the Uplink client, its resolution proof
      // now lives in mod/GonogoScansatUplink/client/src/topics.ts. (topics.ts and
      // topics.test.ts were REMOVED from this bucket 2026-07-20: the bare-primitive
      // fix scrubbed their scansat mentions.)
      "mod/sitrep-sdk/src/topics.test-d.ts",
      // topic-cs-sync.test.ts: the relocated C#↔runtime-registry sync gate
      // (2026-07-20): statically imports the Uplink clients (incl. scansat) so
      // their `registerBarePrimitiveTopic` calls fire, then asserts the registry
      // union matches the C#-declared Topics. A new test importing the clients for
      // registration; no product-code coupling.
      "packages/app/src/__tests__/topic-cs-sync.test.ts",
      // scansat-coverage-roundtrip.test.tsx: the app-level MSW acceptance gate
      // (2026-07-20) for the dynamic-topic fix: drives the real client stack and
      // asserts the mod's canonical scansat.coverage.<body>.<typeBit> string surfaces
      // to the widget. A new acceptance test naming the canonical wire string; no
      // product-code coupling.
      "packages/app/src/__tests__/scansat-coverage-roundtrip.test.tsx",
      // -- SCANsat startup-recovery fix (2026-07-20): these name "SCANsat" only in
      // comments/tests, no product coupling. --
      // GonogoAddon.cs: a doc-comment on the diagnostic sink notes the silent
      // fail-soft "hid the SCANsat coverage root cause". Comment-only.
      "mod/Gonogo.KSP/GonogoAddon.cs",
      // The host retry-recovery regression + its test uplink name scansat as the
      // concrete case (a sampler disabled by an early-tick throw must re-run). Tests.
      "mod/Sitrep.Host.IntegrationTests/ChannelEngineTests.cs",
      "mod/Sitrep.Host.IntegrationTests/TestUplinks.cs",
      "mod/Sitrep.Host.Tests/SampledSourceTests.cs",
      // RevealGateTests.cs: the reseed/late-subscriber regression tests describe the
      // SCANsat coverage shape (delayed dynamic per-(body,type)) in comments. Tests.
      "mod/Sitrep.Host.IntegrationTests/RevealGateTests.cs",
      // GonogoDevStampScan.cs: the Deck-only dev tool that stamps SCANsat coverage
      // for testing (reflects into SCANsat's API). Dev tooling, never shipped.
      "mod/GonogoDevTools/GonogoDevStampScan.cs",
      // slots.ts's header comment explains why scansat's OWN Scanning
      // slots ("scanning.sections"/".badges") are deliberately NOT
      // centrally mirrored here (would need the sdk leaf to import from an
      // Uplink client package: the same turbo `^build` cycle the whole
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
      // framework: no import of, or coupling to, the real scansat Uplink.
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
      // main.tsx (D4 step 2, 2026-07-25): no more static `@ksp-gonogo/gonogo-scansat-uplink`
      // import: scansat now always loads through the runtime loader. Its
      // `registerScansatAndRender` function name and doc comments still name
      // "scansat" as one of the loader-covered first-party 3, prose only.
      "packages/app/src/main.tsx",
      // T11 (2026-07-19) re-verified this one against current code, not just
      // the original audit prose: FogMaskStore.ts's fog-store rewrite
      // (landed since the original audit) means it no longer imports
      // SCANType/SCAN_TYPE at all: scanType has been an opaque string
      // `layerId` since the v2→v3 migration noted inline. What's left is
      // doc-comment-only mentions of SCANsat as the historical motivator
      // for the migration wipe ("SCANsat regenerates the underlying
      // coverage cheaply", "let SCANsat repopulate..."). Zero code
      // coupling today, so this sits in `permanent`, not `domainDebt`,
      // despite the ratchet-hardening design doc's Part 2.3 example citing
      // "FogMaskStore.ts's SCANType import" as the textbook domain-debt
      // case; that characterisation predates the fog-store rewrite.
      "packages/data/src/fog/FogMaskStore.ts",
      // G2 TrueNow-allowlist ratchet (task 4) names ScansatUplink.cs in a
      // justification comment while inventorying every TrueNow declaration
      // in mod/: doc-mention only, same class as CareerUplink.cs above.
      "packages/core/src/truenow-allowlist.test.ts",
      // styleguide.test.ts: the raw-hex ratchet, whose scan roots now cover
      // mod/*/client/src. Its ALLOWED_PATHS names the ScanSat Minimap by path,
      // for the same canvas-2D `fillStyle` reason the packages/ copy of that
      // widget is already allowed for (fillStyle takes a colour string, not a
      // var()). A path string in a ratchet inventory, same class as
      // truenow-allowlist.test.ts above; nothing is imported.
      "packages/core/src/styleguide.test.ts",
      // -- Uplink LOADER (Phase A, 2026-07-17): the runtime client loader names
      // scansat as the first-party Uplink it loads via import() behind a flag,
      // sanctioned loader-config, the concrete shape of the "P7 retires" debt the
      // kerbcast header above anticipates. flag.ts holds the enabled-id list; the
      // loader's unit test uses scansat as its example Uplink (TEST-only). The
      // loader module itself (loader.ts) is generic and names no mod.
      "packages/app/src/uplinks/flag.ts",
      "packages/app/src/uplinks/loader.test.ts",
      // flag.test.ts (kerbcast migration, 2026-07-18): asserts LOADER_UPLINK_IDS
      // contains all three first-party loader ids (scansat/kos/kerbcast),
      // TEST-only, same shape as loader.test.ts above.
      "packages/app/src/uplinks/flag.test.ts",
      // loaderState.test.ts (Hub-wizard plumbing, 2026-07-19): TEST-only,
      // names scansat as one of the three bundled-fallback ids it feeds
      // recordBundledOutcomes(): same shape as flag.test.ts above.
      "packages/app/src/uplinks/loaderState.test.ts",
      // useLateTelemetrySubscribe (2026-07-19): scansat's fog-sync is the
      // motivating call site for the new hook (a runtime-templated topic,
      // `scansat.mask.<body>.<scanType>`, that has no fixed `TopicId` member),
      // so its doc comments and its conformance-gate justification name
      // scansat as the example: same "illustrative, zero coupling" shape as
      // augments.test.tsx above. Neither file imports anything from the
      // scansat Uplink.
      "packages/core/src/sdk-facade.conformance.test-d.ts",
      "packages/sitrep-client/src/use-late-telemetry-subscribe.test.tsx",
      "packages/sitrep-client/src/use-late-telemetry-subscribe.ts",
      // GonogoMechJebUplink (2026-08-08): its version-guard + Register doc
      // comments cite "mirrors GonogoScansatUplink.VersionGuard" as the
      // pattern this Uplink's own MechJebVersionGuard/Register-inert-path
      // copies. Doc-comment-only, no scansat import or coupling.
      "mod/GonogoMechJebUplink/MechJebUplink.Ksp.cs",
      "mod/GonogoMechJebUplink/MechJebVersionGuard.cs",
      "mod/GonogoMechJebUplink/client/src/test/setup.ts",
      "mod/GonogoMechJebUplink.Tests/MechJebVersionGuardFakes.cs",
      // Breaking Ground uplink extraction (2026-08-08): the new bundled
      // uplink's doc comments and its client package's scaffolding name
      // GonogoScansatUplink/client as the structural template they were
      // built from ("mirroring GonogoScansatUplink/client's structure").
      // Doc mentions + boilerplate config only, nothing imports from the
      // scansat Uplink.
      "mod/Gonogo.KSP/BreakingGroundUplink.cs",
      "mod/GonogoBreakingGroundUplink/client/scripts/widgets.ts",
      "mod/GonogoBreakingGroundUplink/client/vitest.config.ts",
    ],
  },

  // === kos: owning dir mod/GonogoKosUplink/
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
      // MainScreen.tsx HARD-violation entry above): same "moved, not
      // removed" pattern the kerbcast migration's own MainScreen.tsx/
      // StationScreen.tsx entries establish for its Uplink.
      "packages/app/src/screens/StationScreen.tsx",
      // Task 5: ComponentOverlay/WidgetGearMenu tests import kos's real
      // kosChromeProvider self-registration (via CpuRegistryProvider/
      // CpuRegistryService, both re-exported by @ksp-gonogo/gonogo-kos-uplink) rather than
      // hand-rolling a bespoke fixture: the more honest integration test per
      // this repo's "mock as little as possible" philosophy, and TEST-only
      // exercising the real domain-coupled provider above.
      "packages/app/src/__tests__/component-overlay-add.test.tsx",
      "packages/app/src/__tests__/dashboard-error-boundary.test.tsx",
      "packages/app/src/__tests__/dashboard-tabbed-config.test.tsx",

      // -- TEST-only, exercising SitrepPeerRelay.tsx (HARD, above) --
      "packages/app/src/telemetry/SitrepPeerRelay.test.tsx",
    ],
    permanent: [
      // -- Uplink Hub wizard welcome copy: user-facing onboarding text naming
      // example Uplinks the Hub can load. Copy, not code coupling.
      "packages/app/src/wizard/steps/WelcomeStep.tsx",
      // -- new test (Plan 3): a kOS-terminal-SHAPED keyframe diff-stream fixture
      // (the shared-vantage multi-client catch-up test). A text-only mention of
      // "kos" in a fixture comment/shape name, no code coupling to the kOS Uplink.
      "mod/Sitrep.Host.IntegrationTests/SharedVantageCatchUpTests.cs",
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
      // example. Engine test, not engine shipping code, the boundary holds. (2026-07-16)
      "mod/Sitrep.Host.IntegrationTests/ChannelEngineTests.cs",
      // pending-uplink contract: its Command field doc-comment gives
      // `kos.run` as the example wire command name, doc-mention only.
      "mod/Sitrep.Contract/UplinkPending.cs",
      "mod/sitrep-sdk/src/__generated__/contract.ts",
      "mod/sitrep-sdk/src/__generated__/topic-map.ts",
      // The third file the same codegen run emits, from the same reflection over
      // the same assembly. It joined this bucket when the unit-coverage ratchet
      // annotated the kOS command-arg and terminal-frame payloads, so it now
      // names their types the way its two siblings above already do. Generated,
      // not authored; same class, same reason.
      "mod/sitrep-sdk/src/__generated__/units.ts",
      // topics.test-d.ts / topics.test.ts / topics.ts stay in the kos bucket: each
      // still names a kos.* dynamic namespace or a Kos-prefixed contract type
      // (`kos.compute.*`, `kos.processors`, `KosProcessorInfo`) as a generic
      // example. Their scansat/kerbcast mentions were scrubbed by the
      // bare-primitive fix (2026-07-20), so they left those two buckets, but the
      // kos references are legitimate and remain.
      "mod/sitrep-sdk/src/topics.test-d.ts",
      "mod/sitrep-sdk/src/topics.test.ts",
      "mod/sitrep-sdk/src/topics.ts",
      // topic-cs-sync.test.ts: the relocated C#↔runtime-registry sync gate
      // (2026-07-20): statically imports the Uplink clients (incl. `@ksp-gonogo/gonogo-kos-uplink`)
      // so registration fires, then asserts the registry union matches the
      // C#-declared Topics. A new test importing the clients; no product-code coupling.
      "packages/app/src/__tests__/topic-cs-sync.test.ts",
      // mod/sitrep-sdk/src/api/api-shape.gate.test.ts stays: it uses "kos" as
      // an example dataSourceId in a generic `useTelemetry("kos", "k")`
      // assertion, unrelated to the (since-removed) registerKosScript/SPI
      // mirrors this file used to also guard.
      "mod/sitrep-sdk/src/api/api-shape.gate.test.ts",
      // dispatch()'s label doc-comment cites `kos.keystroke` as the example
      // line-mode command whose composed text becomes the queue label,
      // comment-only, no kOS coupling in the client spine.
      "packages/sitrep-client/src/client.ts",
      // command-delay.ts's doc-comment cites the kOS terminal's original
      // isPastReach judder fix as the precedent latchForward generalizes;
      // its test fixture uses "kos.run"/"kos/7" as sample command/topic
      // strings (same class as PeerTransport.test.ts's sample strings
      // below): the delayed-command primitives themselves are mod-
      // agnostic and import nothing kOS-specific.
      "packages/sitrep-client/src/command-delay.ts",
      "packages/sitrep-client/src/command-delay.test.ts",
      // use-route-commands.ts's doc-comment cites the kOS terminal's
      // original hand-rolled strip as the precedent it generalizes; its
      // test fixture uses "kos/7"/"kos.run" as sample topic/command
      // strings. Same class as command-delay.ts above: mod-agnostic,
      // imports nothing kOS-specific.
      "packages/sitrep-client/src/use-route-commands.ts",
      "packages/sitrep-client/src/use-route-commands.test.tsx",
      // connectivity-history.ts's doc-comment cites the kOS terminal's own
      // noPath gate convention ("undefined/unknown = connected") as the
      // precedent its own unknown-history default follows: doc-mention
      // only, no kOS import or coupling.
      "packages/sitrep-client/src/connectivity-history.ts",
      // -- comment/doc + pending-topic mentions (no kOS coupling) --
      // CameraFeed's doc-comment references `KosTerminal`'s command-response
      // pattern; Comms.cs's CommsLink doc mentions the kOS terminal reading
      // comms.link. FleetComms/pendingPulse render `system.uplink.pending`
      // entries whose commands include kos.run/kos.keystroke (topic-string
      // mention, like UplinkPending.cs); slot.test.tsx's fixture uses
      // "kos.run" as a sample command string. FleetComms/index.tsx itself no
      // longer carries a kos-pattern match (its own `KosTerminal` doc mention
      // was rewritten during the comms.link connectivity migration), so it
      // is NOT relisted here: see the 2026-07-29 systemview-overlays branch.
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
      // canonical delayed command gated during a blackout, test/doc only.
      "mod/Sitrep.Core.Tests/CommandRequestLabelWireTests.cs",
      "mod/Sitrep.Core.Tests/CourierReliableOrderedDeliveryTests.cs",
      "mod/Sitrep.Core.Tests/PendingUplinkQueueWireTests.cs",
      "mod/Sitrep.Core.Tests/WirePayloadCoverageTests.cs",
      "mod/Sitrep.Host.IntegrationTests/CommsGateCommandTests.cs",
      // KosProcessorsWireTests.cs exercises the kos.processors wire SHAPE:
      // a contract-level wire test, same class as CommandRequestLabelWireTests.
      "mod/Sitrep.Host.IntegrationTests/KosProcessorsWireTests.cs",
      "mod/Sitrep.Host.Tests/UplinkDiscoveryTests.cs",
      "mod/sitrep-sdk/src/generated.test.ts",
      // kos-execute-tunnel.test.ts has zero real kos coupling, it only uses
      // "kos" as a generic Uplink-handle id while exercising app-owned PeerJS
      // relay machinery (kos migration Task 8, 2026-07-18: moved into the kos
      // package and back out once that became clear). Stays in
      // packages/app/src/__tests__ where this entry already covers it.
      "packages/app/src/__tests__/kos-execute-tunnel.test.ts",
      // peer label/topic tunnel tests use "kos.run" as the sample command and
      // cite a kOS command in a doc-comment, test/doc-only, no coupling.
      "packages/app/src/__tests__/sitrep-command-label-topic-tunnel.test.ts",
      // SettingsModal.test.tsx / DataSourceStatus/index.test.tsx use "kos"
      // purely as a generic fixture data-source id ("kOS" display label)
      // exercising the generic Data Sources panel: no real kOS import.
      "packages/app/src/settings/SettingsModal.test.tsx",
      // PeerTransport.test.ts uses "kos.run" / "kos/cpu-1" as sample
      // command/topic strings exercising generic PeerJS transport framing,
      // no real kOS import.
      "packages/app/src/telemetry/PeerTransport.test.ts",
      "packages/components/src/DataSourceStatus/index.test.tsx",
      // ManeuverPlanner/index.test.tsx tests ManeuverPlanner/index.tsx, whose
      // own kOS mention (below) is doc-comment-only, same subject, same
      // category.
      "packages/components/src/ManeuverPlanner/index.test.tsx",
      // widgets.axe.test.tsx's only kOS mention is a doc-comment pointing
      // implementers at Kos*-specific axe-smoke test files elsewhere, no
      // import, no coupling.
      "packages/components/src/test/widgets.axe.test.tsx",
      // map-command coverage test exercises map-command.ts (permanent,
      // above): same subject, same category.
      "packages/core/src/hooks/map-command.coverage.test.ts",
      "packages/core/src/styleguide-styled-components.test.ts",
      // uplink-health-render-gating feature (2026-07-19): uplink-health.test.ts,
      // useUplinkHealthFor.test.tsx, and RequiresGuard.test.tsx use
      // "kos.terminal."/"kos.processors" as sample owned-prefix/channel
      // strings exercising the generic longest-prefix-match resolver and the
      // framework render-gate, same "topic string, no real kOS import"
      // category as PeerTransport.test.ts above.
      "packages/components/src/shared/RequiresGuard.test.tsx",
      "packages/core/src/hooks/useUplinkHealthFor.test.tsx",
      "packages/sitrep-client/src/uplink-health.test.ts",
      // BufferedDataSource.test.ts / useDataSchema.test.tsx test the doc-
      // comment-only files of the same name below, same subject.
      "packages/data/src/BufferedDataSource.test.ts",
      "packages/data/src/hooks/useDataSchema.test.tsx",

      // "centralised kOS scripts" infra (audit §3; CLAUDE.md). Kos migration
      // (2026-07-18) Tasks 2-4/6 moved registerKosScript/ScriptableDataSource/
      // KosScriptError/CpuRegistryService and their satellites (barrel
      // exports, the [KOSDATA] parser, the CPU-registry context, their own
      // tests) wholesale into the kos Uplink per the operator's explicit
      // "no generalising" call. Only registry.ts's own clearKosScripts()
      // import removal remains a core-side trace: doc/comment-only now.
      "packages/core/src/registry.ts",

      // -- Doc/comment-only mentions elsewhere (kOS is a documented Key
      // Design Constraint: "optional, not a hard dependency": so it is
      // named in prose across many otherwise-unrelated files) --
      // dev-only comms override: its doc-comment cites `kos.keystroke` as an
      // example command to gate during a blackout, comment-only.
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
      "packages/app/src/alarms/types.ts",
      "packages/app/src/components/ComponentOverlay.tsx",
      "packages/app/src/dataSources/seedKspHost.ts",
      "packages/app/src/logs/LogsManager.tsx",
      // main.tsx was here (`import "@ksp-gonogo/gonogo-kos-uplink"`, a sanctioned self-
      // registration import). D4 step 2 (2026-07-25) removed the static
      // import: kos now always loads through the runtime loader, referenced
      // only via flag.ts's `LOADER_UPLINK_IDS` (no "kOS"/"Kos*"/"kos.*"
      // distinctive-form text left in main.tsx itself): stale, ratcheted off.
      // CrewStatus/index.tsx was here (a doc-comment aside claiming gonogo
      // "doesn't support Kerbalism because of the known kOS sensor
      // incompatibility"). Kerbalism-fixture-truth's crew-rules verification
      // pass found that claim stale: the widget already reads real Kerbalism
      // survival data off `kerbalism.crew`/`kerbalism.lifesupport`: and
      // rewrote the comment to describe the actual Kerbalism integration
      // instead, dropping the only "kOS" text in the file, stale, ratcheted off.
      "packages/components/src/ManeuverPlanner/index.tsx",
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
      // another Uplink at all: stale twice over, so it ratcheted off.
      "packages/relay/src/bootstrapConfig.ts",
      "packages/sitrep-client/src/stream-status.ts",
      "packages/sitrep-client/src/timeline-store.ts",
      "packages/sitrep-client/src/use-certainty.ts",
      "packages/sitrep-client/src/use-stream-status.ts",
      "packages/ui/src/VersionMismatchBanner.tsx",
      // GonogoMechJebUplink (2026-08-08): copies GonogoKosUplink's
      // MainThreadDispatcher/RunOnMainThread drop-not-run-on-timeout
      // discipline and its KosMainThreadDispatcherAddon/KosChannels shape
      // verbatim, citing the source class names in doc comments so the
      // mirrored pattern is traceable. Doc-comment-only: this Uplink builds
      // its OWN MainThreadDispatcher/addon/channels, never imports kOS's.
      "mod/GonogoMechJebUplink/MainThreadDispatcher.cs",
      "mod/GonogoMechJebUplink/MechJebChannels.cs",
      "mod/GonogoMechJebUplink/MechJebMainThreadDispatcherAddon.cs",
      "mod/GonogoMechJebUplink/MechJebUplink.Ksp.cs",
      "mod/GonogoMechJebUplink/MechJebUplink.cs",
      "mod/GonogoMechJebUplink/MechJebVersionGuard.cs",
      "mod/GonogoMechJebUplink/client/src/test/setup.ts",
      "mod/GonogoMechJebUplink.Tests/MechJebUplinkRunOnMainThreadTests.cs",
      "mod/GonogoMechJebUplink.Tests/MechJebVersionGuardFakes.cs",
    ],
  },

  // === realantennas: owning dir mod/GonogoRealAntennasUplink/. The
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
      // what they force: comment-only, no RA coupling.
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
      // only: no RA type, reference or coupling; same category as
      // Comms/CommsElection.cs itself.
      "mod/Sitrep.Host/ActionGroups/ActionGroupsElection.cs",
      "mod/Sitrep.Host/ActionGroups/IActionGroupsBackend.cs",
      "packages/components/src/CommSignal/index.tsx",
      "packages/components/src/SystemView/index.tsx",
      // G2 TrueNow-allowlist ratchet (task 4) names RealAntennasUplink.cs in
      // a justification comment while inventorying every TrueNow
      // declaration in mod/: doc-mention only.
      "packages/core/src/truenow-allowlist.test.ts",
      // The AGX uplink is the SAME election shape RA established for comms
      // (docs/superpowers/specs/2026-07-17-agx-backend-design.md §2), and its
      // doc-comments say so explicitly, citing GonogoRealAntennasUplink /
      // RaReflection as the worked precedent: prose only, no RA type,
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
      // RaReflection as the pattern they mirror: doc-mention only.
      "mod/GonogoActionGroupsExtendedUplink.Tests/ActionGroupsExtendedElectionTests.cs",
      "mod/GonogoActionGroupsExtendedUplink.Tests/AgxReflectionTests.cs",
    ],
  },

  // === agx: owning dir mod/GonogoActionGroupsExtendedUplink/. Every entry
  // below PRE-DATES the AGX uplink (Phase 1 named action groups and left the
  // seam ready, per docs/superpowers/specs/2026-07-17-agx-backend-design.md
  // §0/§1): doc-comment mentions of "Action Groups Extended (AGX)" or the
  // provider-id identifiers explaining WHY the seam is shaped the way it is,
  // not AGX coupling. No file below imports, references, or derives from
  // anything in the new owning dir. Zero domainDebt entries.
  agx: {
    domainDebt: [],
    permanent: [
      // -- Judgment calls, all doc-mention only (Phase 1's seam commentary) --
      // The provider-registration seam itself: constant/method names
      // (ActionGroupsExtendedProviderId, RegisterActionGroupsExtendedProvider)
      // and prose explaining this file IS where a future AGX uplink plugs in,
      // the whole point of §1's "the seam Phase 1 left ready".
      "mod/Sitrep.Host/ActionGroups/ActionGroupsElection.cs",
      // Doc-comment explaining why the capability's Groups() list is
      // named/arbitrary-length rather than a positional bool[]: cites
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
      // legitimately goes to 250": prose only, no AGX type/reference.
      "mod/Sitrep.Host/VesselCommandProvider.cs",
      "packages/sitrep-client/src/map-topic.ts",
      "packages/sitrep-client/src/vessel-state.ts",
      // f.ag<N>-beyond-10 toggle fix (2026-07-19): actionGroupHome's
      // doc-comment explains why the write bridge is now a generic
      // `/^f\.ag(\d+)$/` rule instead of a 10-row static table, AGX assigns
      // indices up to 250, same rationale as VesselCommandProvider.cs's own
      // comment above. Prose only; no AGX type or import.
      "packages/sitrep-client/src/map-command.ts",

      // -- TEST-only --
      // Regression-comment mirrors the VesselCommandProvider rationale above.
      "mod/Sitrep.Host.Tests/VesselCommandProviderTests.cs",
      // map-command.test.ts's new AGX-index test cites "AGX" in a doc-comment
      // (same rationale as map-command.ts above): no AGX import, just
      // exercising the generic mapCommand rule with high indices.
      "packages/sitrep-client/src/map-command.test.ts",
    ],
  },
  // === mechjeb: owning dirs mod/GonogoMechJebUplink/ (incl. its client/),
  // mod/GonogoMechJebUplink.Tests, and mod/GonogoMechJebUplink.Contract (the
  // uplink-types-out-of-core pilot's own contract slice, 2026-08-10). Every
  // hit below is a comment/doc-mention or the sanctioned loader import; there
  // is no real code coupling outside the owning dirs, so domainDebt is empty.
  mechjeb: {
    domainDebt: [],
    permanent: [
      // -- Uplink loader: the sanctioned self-registration import, same
      // pattern as kerbcast/kos/scansat's main.tsx entries above.
      "packages/app/src/main.tsx",

      // -- The mod-side ownership ratchet itself (§5a of the plan) --
      // UplinkContractOwnershipTests.cs is a new xUnit test asserting
      // Sitrep.Contract carries zero non-comment "MechJeb" references: it
      // necessarily names the token it is testing FOR, in its own doc
      // comment and its RelocatedModTokens data. A ratchet naming its own
      // subject, not a boundary violation, same class as the C#
      // WirePayloadCoverageTests.cs entry a few lines below.
      "mod/Sitrep.Core.Tests/UplinkContractOwnershipTests.cs",

      // -- Widget-name mentions in doc comments, zero code coupling --
      // "ManeuverPlanner, TargetPicker, RoboticsConsole, MechJeb, Navball,"
      // lists sibling command widgets this shared list-item helper serves.
      "packages/ui-kit/src/CommandDelay/toInFlightListItems.ts",
      // Porkchop heatmap doc-comment: "(MechJeb/alexmoon style)" cites the
      // familiar visual convention it mirrors, not a dependency.
      "packages/core/src/calc/porkchop.ts",
      // ActionGroup's own doc-comment lists sibling vessel command widgets
      // sharing its pattern, MechJeb among them.
      "packages/components/src/ActionGroup/stream.test.tsx",
      // Navball's doc-comments describe a FUTURE "autopilot Uplink
      // (MechJeb-alike)" as the proposed filler for an open badge slot:
      // aspirational prose, no MechJeb import.
      "packages/components/src/Navball/index.tsx",
      // RoboticsConsole/RotorTachometer doc-comments cite MechJeb as a
      // precedent for this widget's shape; no MechJeb import or coupling.
      "mod/GonogoBreakingGroundUplink/client/src/RoboticsConsole/index.tsx",
      "mod/GonogoBreakingGroundUplink/client/src/RotorTachometer/index.tsx",

      // -- Core-mod doc-comments citing MechJeb2 as prior art or a use case,
      // zero coupling --
      "mod/Gonogo.KSP/KspHost.cs",
      "mod/Sitrep.Contract/VesselAttitude.cs",

      // -- The Avionics relocation's own doc comments, citing the MechJeb
      // pilot as prior art (the mechanism it copies, and the specific
      // contrast that AvionicsStatus is a real read payload where MechJeb's
      // two types were command args) -- zero MechJeb code or type coupling --
      "mod/GonogoAvionicsUplink.Contract/AvionicsPayloads.cs",
      "mod/GonogoAvionicsUplink.Contract/AvionicsRtConfig.cs",
      "mod/GonogoAvionicsUplink.Tests/AvionicsUnitCoverageTests.cs",
      "mod/GonogoAvionicsUplink/client/src/generated-value-import.test.ts",

      // -- The relocation's own provenance record --
      // ContractVersion.cs's Minor-history doc-comment records the original
      // add AND the later relocation of MechJebAscentArgs/MechJebNoArgs out
      // of this assembly: see ContractVersion.Minor's doc comment. Prose
      // only, the types themselves no longer live here.
      "mod/Sitrep.Contract/ContractVersion.cs",
      // RtConfig.cs's wirePayloadTypes comment records where the two types
      // went (GonogoMechJebUplink.Contract) and EmitTopicMap/EmitUnitMap's
      // doc comments name MechJebRtConfig as the first caller of the
      // assembly-generic overloads: provenance/seam documentation, no type
      // reference.
      "mod/Sitrep.Contract/RtConfig.cs",
      // SitrepUnitAttribute.cs's Kilometres doc-comment explains why that
      // token exists by citing MechJebAscentArgs.TargetAltitudeKm as the
      // originating field: prose only.
      "mod/Sitrep.Contract/SitrepUnitAttribute.cs",
      // WirePayloadCoverageTests.cs's comment records that the mechjeb.*
      // command-arg allowlist entries were removed because the types left
      // this assembly: provenance, not a reference to the types.
      "mod/Sitrep.Core.Tests/WirePayloadCoverageTests.cs",

      // -- The Kerbcast relocation's own doc comments, citing the MechJeb
      // pilot as prior art (its two command-arg types are the precedent
      // KerbcastSetFieldOfViewArgs/KerbcastSetPanArgs follow: ApplyUnitValueTypes
      // skips retyping both alike) -- zero MechJeb code or type coupling --
      "mod/GonogoKerbcastUplink.Contract/KerbcastPayloads.cs",
      "mod/GonogoKerbcastUplink.Contract/KerbcastRtConfig.cs",
      "mod/GonogoKerbcastUplink.Tests/KerbcastUnitCoverageTests.cs",
      "mod/GonogoKerbcastUplink/client/src/generated-value-import.test.ts",
    ],
  },
  // === avionics: owning dirs mod/GonogoAvionicsUplink/ (incl. its client/),
  // mod/GonogoAvionicsUplink.Tests, and mod/GonogoAvionicsUplink.Contract
  // (the second uplink-types-out-of-core relocation, 2026-08-10). Every hit
  // below is a comment/doc-mention, a sanctioned loader import, or a fixture
  // topic-id string; there is no real code coupling outside the owning dirs,
  // so domainDebt is empty.
  avionics: {
    domainDebt: [],
    permanent: [
      // -- Uplink loader: the sanctioned self-registration import, same
      // pattern as kerbcast/kos/scansat/mechjeb's main.tsx entries above.
      "packages/app/src/main.tsx",

      // -- Cross-Uplink topic-registry sync test: imports every Uplink
      // client (avionics included) to build the full C#<->registry topic
      // union, and asserts avionics.available (the TrueNow presence
      // primitive) is a known id. Enumerating every Uplink IS this file's
      // job, not a boundary violation.
      "packages/app/src/__tests__/topic-cs-sync.test.ts",

      // -- TrueNow-classification ratchet: names avionics.available (the
      // presence primitive, TrueNow) alongside its sibling avionics.status
      // (a per-vessel telemetry fact, Delayed) purely to explain why the
      // FIRST is allowlisted and the second is not. Same "cross-Uplink
      // inventory naming every mod" class as topic-cs-sync.test.ts above.
      "packages/core/src/truenow-allowlist.test.ts",

      // -- The mod-side ownership ratchet itself (§5a of the plan) --
      // UplinkContractOwnershipTests.cs necessarily names the token it is
      // testing FOR, in its own doc comment and its RelocatedModTokens data.
      // A ratchet naming its own subject, not a boundary violation, same
      // class as the C# WirePayloadCoverageTests.cs entry a few lines below.
      "mod/Sitrep.Core.Tests/UplinkContractOwnershipTests.cs",

      // -- The relocation's own provenance record --
      // ContractVersion.cs's Major/Minor-history doc comments record the
      // original add of the avionics.status Topic AND its later relocation
      // out of this assembly: prose only, the type itself no longer lives
      // here. RtConfig.cs's wirePayloadTypes comment records where it went
      // (GonogoAvionicsUplink.Contract).
      "mod/Sitrep.Contract/ContractVersion.cs",
      "mod/Sitrep.Contract/RtConfig.cs",
      // WirePayloadCoverageTests.cs's comment records that the AvionicsStatus
      // allowlist entry was removed because the type left this assembly:
      // provenance, not a reference to the type.
      "mod/Sitrep.Core.Tests/WirePayloadCoverageTests.cs",

      // -- The MechJeb pilot's own forward-looking cross-references --
      // MechJebRtConfig.cs's and MechJebUnitCoverageTests.cs's doc comments
      // both named Avionics as "the next Uplink in the plan's sequencing"
      // before this relocation landed: historical prose from the pilot
      // commit, no Avionics code or type reference.
      "mod/GonogoMechJebUplink.Contract/MechJebRtConfig.cs",
      "mod/GonogoMechJebUplink.Tests/MechJebUnitCoverageTests.cs",
      // MechJeb's own generated-value-import.test.ts and client index.ts
      // cite Avionics as the sibling that actually exercises the Value<>
      // path / as a fellow runtime-loader-exempt Uplink: doc-comment
      // cross-references, no coupling.
      "mod/GonogoMechJebUplink/client/src/generated-value-import.test.ts",
      "mod/GonogoMechJebUplink/client/src/index.ts",

      // -- sitrep-sdk's own registration mechanism, naming its first
      // relocated-Uplink caller in a doc comment (registerTopicUnits /
      // registerBarePrimitiveTopic in topics.ts), plus the test that records
      // avionics.status no longer being the SDK's own codegen output --
      "mod/sitrep-sdk/src/topics.ts",
      "mod/sitrep-sdk/src/topics.test.ts",

      // -- Unrelated RP-1/RP-0 module-name collision --
      // GonogoDevKerbalismDump.cs is a GonogoDevTools debug dump unrelated to
      // this Uplink; it lists "RP0Avionics" as one of many third-party
      // PartModule class names it reflects, and separately explains in prose
      // why RP-1's avionics controllable-mass isn't dumped there. No
      // GonogoAvionicsUplink code or type reference.
      "mod/GonogoDevTools/GonogoDevKerbalismDump.cs",

      // -- The Kerbcast relocation's own doc comments, citing Avionics as
      // prior art (the second relocation, first to prove the Value<>/
      // Vec3Of<> retype end to end; KerbcastCameraEntry's nine Units.Degrees
      // fields are the second proof) -- zero Avionics code or type coupling --
      "mod/GonogoKerbcastUplink.Contract/KerbcastPayloads.cs",
      "mod/GonogoKerbcastUplink.Contract/KerbcastRtConfig.cs",
      "mod/GonogoKerbcastUplink.Tests/KerbcastUnitCoverageTests.cs",
      "mod/GonogoKerbcastUplink/client/src/generated-value-import.test.ts",
      "mod/GonogoKerbcastUplink/client/src/topics.test.ts",
    ],
  },
};
