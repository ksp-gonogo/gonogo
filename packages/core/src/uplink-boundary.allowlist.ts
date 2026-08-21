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
  | "avionics"
  | "kerbalism"
  | "testflight"
  | "principia"
  | "telemachus";

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
      // -- MAGNITUDE budget ratchet (2026-08-19): the per-file `.magnitude`
      // budget is keyed by file path, so it names every Uplink that unwraps a
      // Value. Ratchet-inventory file, the case this bucket documents.
      "packages/core/src/styleguide-magnitude-budget.test.ts",
      // -- Uplink ISOLATION ratchet inventory (2026-08-18): the inward guard's
      // debt list is keyed by file path, so it necessarily names every Uplink
      // directory. Ratchet-inventory file, the case this bucket documents.
      "packages/core/src/uplink-isolation.allowlist.ts",
      // -- TYPECHECK-COVERAGE ratchet inventory (2026-08-21): the debt list
      // of packages whose `typecheck` does not yet cover their own test files
      // is keyed by package directory, so it names every Uplink client.
      // Ratchet-inventory file, the case this bucket documents.
      "packages/core/src/typecheck-coverage.allowlist.ts",
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
      "mod/sitrep-sdk/src/spine/context.tsx",
      "mod/sitrep-sdk/src/spine/delay-authority.ts",
      "mod/sitrep-sdk/src/spine/map-command.ts",
      "packages/sitrep-client/src/map-topic.test.ts",
      "mod/sitrep-sdk/src/spine/map-topic.ts",
      // view-clock.ts/view-clock-formula.ts: cross-browser kerbcast
      // video-delay design (2026-07-16) extracted ViewClock's
      // confirmedEdgeUt()/utNowEstimate() formula into pure functions
      // (view-clock-formula.ts) so the kerbcast per-frame delay WORKER can
      // mirror it exactly instead of forking it; see ViewClock.snapshot().
      // Comment/doc mentions only; neither file imports anything
      // kerbcast-specific, and sitrep-client stays mod-agnostic.
      "mod/sitrep-sdk/src/view-clock-formula.ts",
      "mod/sitrep-sdk/src/spine/view-clock.ts",

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
      "mod/sitrep-sdk/src/default-carried-topics.ts",

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
      "mod/sitrep-sdk/src/testing/install-dom-stubs.ts",
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
      "mod/sitrep-sdk/src/event-timeline.ts",
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
      // The vendor-name ratchet's seed data enumerates every file in the tree
      // that still carries the retired source's name, so it necessarily lists
      // paths under this Uplink. Inventory data, same category as this file.
      "packages/core/src/vendor-name.allowlist.ts",
      // -- MAGNITUDE budget ratchet (2026-08-19): the per-file `.magnitude`
      // budget is keyed by file path, so it names every Uplink that unwraps a
      // Value. Ratchet-inventory file, the case this bucket documents.
      "packages/core/src/styleguide-magnitude-budget.test.ts",
      // -- FIRE-AND-FORGET command budget (2026-08-20): the per-file budget
      // for dispatches that discard their outcome is keyed by file path, so it
      // names every Uplink with a blind dispatch. Ratchet-inventory file, the
      // case this bucket documents.
      "packages/core/src/styleguide-fire-and-forget-commands.test.ts",
      // -- Uplink ISOLATION ratchet inventory (2026-08-18): the inward guard's
      // debt list is keyed by file path, so it necessarily names every Uplink
      // directory. Ratchet-inventory file, the case this bucket documents.
      "packages/core/src/uplink-isolation.allowlist.ts",
      // -- TYPECHECK-COVERAGE ratchet inventory (2026-08-21): the debt list
      // of packages whose `typecheck` does not yet cover their own test files
      // is keyed by package directory, so it names every Uplink client.
      // Ratchet-inventory file, the case this bucket documents.
      "packages/core/src/typecheck-coverage.allowlist.ts",
      // -- Kerbalism's own SCANsat bridge --
      // Kerbalism ships a `KerbalismScansat` PartModule and a config patch that
      // DELETES the part's `SCANexperiment` module to make room for it. So with
      // both mods installed the scanner is Kerbalism's to report, and the
      // Kerbalism provider reports it: one `science.instruments` row per module,
      // with its own half of the extension bag.
      //
      // These are not coupling to the SCANsat Uplink, and cannot shrink into it.
      // Every read goes through Kerbalism's reflection surface for a
      // Kerbalism-owned type; no SCANsat assembly, API or Topic is touched, and
      // GonogoScansatUplink is not referenced. What matches the token is the
      // module's NAME plus the prose explaining why a Kerbalism file talks about
      // SCANsat at all. Moving any of it into the SCANsat Uplink would be exactly
      // backwards: that Uplink cannot see Kerbalism's modules.
      "mod/GonogoKerbalismUplink/KerbalismReflection.cs",
      "mod/GonogoKerbalismUplink/KerbalismRawTypes.cs",
      "mod/GonogoKerbalismUplink/KerbalismScienceMap.cs",
      "mod/GonogoKerbalismUplink/client/src/science.ts",
      "mod/GonogoKerbalismUplink/client/src/science.test.ts",
      "mod/GonogoKerbalismUplink.Contract/KerbalismScienceExt.cs",
      "mod/GonogoKerbalismUplink.Tests/ScienceExtensionWireTests.cs",
      // -- Uplink Hub wizard welcome copy: user-facing onboarding text naming
      // example Uplinks the Hub can load. Copy, not code coupling.
      "packages/app/src/wizard/steps/WelcomeStep.tsx",
      // -- contract/SDK layer --
      "mod/Sitrep.Contract/ContractVersion.cs",
      "mod/Sitrep.Contract/RtConfig.cs",
      "mod/Sitrep.Contract/UplinkContract.cs",
      // ScanPayloads.cs and the two sitrep-sdk generated files (topic-map.ts,
      // units.ts) were REMOVED from this bucket 2026-08-10: the SCANsat
      // relocation (uplink-types-out-of-core plan, fourth step) moved all five
      // Scan* payload types into GonogoScansatUplink.Contract, which deleted the
      // source file outright and left both generated artifacts with no scansat
      // key at all. ContractVersion.cs and RtConfig.cs stay: each now carries
      // the relocation's PROVENANCE prose (the Major 8 -> 9 entry, and the
      // wirePayloadTypes comment recording what left), which is exactly what
      // the permanent bucket is for.
      // topics.test-d.ts stays too, but for the opposite reason to before: it no
      // longer type-asserts any scansat Topic (that proof moved inline into
      // mod/GonogoScansatUplink/client/src/topics.ts alongside
      // `scansat.available`'s). What matches now is the comment recording WHY the
      // assertion left. (topics.ts and topics.test.ts were REMOVED from this
      // bucket 2026-07-20: the bare-primitive fix scrubbed their scansat mentions.)
      "mod/sitrep-sdk/src/topics.test-d.ts",
      // units.ts (the hand-written accessor, not the generated map): its
      // registerTypeUnits doc comment names scansat.scanningVessels as the case
      // that forced a TYPE-keyed runtime registry alongside the Topic-keyed one.
      // The three earlier relocations moved flat payloads, so a topic-scoped unit
      // map was sufficient; this one nests (sensors: ScanSensorEntry[],
      // trackColor: ScanTrackColor) and wrapTopicPayload resolves a nested shape
      // by TYPE NAME, so the registry needed the second half. Prose in a
      // mod-agnostic file explaining a general mechanism, nothing
      // scansat-specific is imported.
      "mod/sitrep-sdk/src/units.ts",
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
      "mod/sitrep-sdk/src/default-carried-topics.ts",
      "mod/sitrep-sdk/src/spine/map-topic.ts",

      // -- TEST-only --
      "mod/Sitrep.Core.Tests/WirePayloadCoverageTests.cs",
      // UplinkContractOwnershipTests.cs: the mod-side relocation-ownership
      // ratchet (uplink-types-out-of-core plan §5a). Registers a "scansat"
      // token so no Scan* wire type may return to Sitrep.Contract. A ratchet
      // inventory naming the mods it guards, same class as the kerbcast/
      // mechjeb/avionics entries on the same file; nothing is imported.
      "mod/Sitrep.Core.Tests/UplinkContractOwnershipTests.cs",
      "mod/Sitrep.Host.IntegrationTests/FoundationChannelsEndToEndTests.cs",
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
      // `FogMaskStore.ts` was here, and is gone entirely rather than moved: the
      // store went into `@ksp-gonogo/sitrep-sdk` on 2026-08-19, and the sdk is
      // the leaf every Uplink depends on, so it cannot name one at all, not even
      // in prose. Its three remaining doc mentions (the historical motivator for
      // the migration wipe) now say "a reveal source" instead, which is what the
      // code has actually meant since scanType became an opaque `layerId` at
      // v2→v3. That also settles the ratchet-hardening design doc's Part 2.3
      // example, which cited "FogMaskStore.ts's SCANType import" as the textbook
      // domain-debt case: the import had already gone, and now the file has too.
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
      "mod/sitrep-sdk/src/spine/use-late-telemetry-subscribe.ts",
      // GonogoMechJebUplink (2026-08-08): its version-guard + Register doc
      // comments cite "mirrors GonogoScansatUplink.VersionGuard" as the
      // pattern this Uplink's own MechJebVersionGuard/Register-inert-path
      // copies. Doc-comment-only, no scansat import or coupling.
      "mod/GonogoMechJebUplink/MechJebUplink.Ksp.cs",
      "mod/GonogoMechJebUplink/MechJebVersionGuard.cs",
      "mod/GonogoMechJebUplink.Tests/MechJebVersionGuardFakes.cs",
      // Breaking Ground uplink extraction (2026-08-08): the new bundled
      // uplink's doc comments and its client package's scaffolding name
      // GonogoScansatUplink/client as the structural template they were
      // built from ("mirroring GonogoScansatUplink/client's structure").
      // Doc mentions + boilerplate config only, nothing imports from the
      // scansat Uplink.
      "mod/Gonogo.KSP/BreakingGroundUplink.cs",
      "mod/GonogoBreakingGroundUplink/client/scripts/widgets.ts",
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
      // -- MAGNITUDE budget ratchet (2026-08-19): the per-file `.magnitude`
      // budget is keyed by file path, so it names every Uplink that unwraps a
      // Value. Ratchet-inventory file, the case this bucket documents.
      "packages/core/src/styleguide-magnitude-budget.test.ts",
      // -- TYPECHECK-COVERAGE ratchet inventory (2026-08-21): the debt list
      // of packages whose `typecheck` does not yet cover their own test files
      // is keyed by package directory, so it names every Uplink client.
      // Ratchet-inventory file, the case this bucket documents.
      "packages/core/src/typecheck-coverage.allowlist.ts",
      // -- Uplink Hub wizard welcome copy: user-facing onboarding text naming
      // example Uplinks the Hub can load. Copy, not code coupling.
      "packages/app/src/wizard/steps/WelcomeStep.tsx",
      // -- new test (Plan 3): a kOS-terminal-SHAPED keyframe diff-stream fixture
      // (the shared-vantage multi-client catch-up test). A text-only mention of
      // "kos" in a fixture comment/shape name, no code coupling to the kOS Uplink.
      "mod/Sitrep.Host.IntegrationTests/SharedVantageCatchUpTests.cs",
      // -- contract/SDK layer. KosCommands.cs / KosRun.cs / KosTerminal.cs used
      // to sit here, and were the last three files in this whole allowlist
      // holding real Uplink POCOs in core: all eleven Kos* types relocated into
      // GonogoKosUplink.Contract (uplink-types-out-of-core plan, sixth and last
      // relocation, 2026-08-10), so the files are gone from Sitrep.Contract and
      // the ratchet demanded these lines go with them. The two below are prose
      // only now: ContractVersion.cs's Major/Minor history records what moved
      // and when, and RtConfig.cs's wirePayloadTypes carries the same
      // provenance note where the eleven typeof() entries used to be. That is
      // the rationale this file's header used to assert in the opposite
      // direction ("every Uplink's wire types live in Sitrep.Contract, by
      // design") fully inverted: for these tokens core now names them in
      // history and nowhere else.
      "mod/Sitrep.Contract/ContractVersion.cs",
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
      // The three generated SDK files (contract.ts / topic-map.ts / units.ts)
      // used to sit here too, because core's codegen reflected the Kos* types
      // out of Sitrep.Contract and emitted them. It does not any more: the
      // relocation moved them to this Uplink's own
      // client/src/__generated__/, so core's generated output names no kOS
      // type at all and the ratchet demanded these three lines go. Nothing was
      // fixed in those files; the input to the codegen changed.
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
      "mod/sitrep-sdk/src/spine/client.ts",
      // command-delay.ts's doc-comment cites the kOS terminal's original
      // isPastReach judder fix as the precedent latchForward generalizes;
      // its test fixture uses "kos.run"/"kos/7" as sample command/topic
      // strings (same class as PeerTransport.test.ts's sample strings
      // below): the delayed-command primitives themselves are mod-
      // agnostic and import nothing kOS-specific.
      "mod/sitrep-sdk/src/command-delay.ts",
      "mod/sitrep-sdk/src/command-delay.test.ts",
      // use-route-commands.ts's doc-comment cites the kOS terminal's
      // original hand-rolled strip as the precedent it generalizes; its
      // test fixture uses "kos/7"/"kos.run" as sample topic/command
      // strings. Same class as command-delay.ts above: mod-agnostic,
      // imports nothing kOS-specific.
      "mod/sitrep-sdk/src/spine/use-route-commands.ts",
      "packages/sitrep-client/src/use-route-commands.test.tsx",
      // connectivity-history.ts's doc-comment cites the kOS terminal's own
      // noPath gate convention ("undefined/unknown = connected") as the
      // precedent its own unknown-history default follows: doc-mention
      // only, no kOS import or coupling.
      "mod/sitrep-sdk/src/spine/connectivity-history.ts",
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
      // The `undefined.characterise.test.tsx` files pin what each widget does
      // with absent telemetry, so they name the same domain tokens their widget
      // does: a real topic id, a real wire value, or the widget's own copy. Same
      // debt as the widget beside them, not new debt.
      "packages/components/src/FleetComms/undefined.characterise.test.tsx",
      "mod/GonogoKerbcastUplink/client/src/CameraFeed/CameraFeed.tsx",
      "mod/GonogoKerbcastUplink/client/src/CameraFeed/CameraFeed.test.tsx",
      "mod/Sitrep.Contract/Comms.cs",
      "mod/sitrep-sdk/src/default-carried-topics.ts",
      "packages/sitrep-client/src/map-command.test.ts",
      "packages/sitrep-client/src/map-topic.test.ts",
      "mod/sitrep-sdk/src/spine/map-topic.ts",

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
      // BufferedDataSource.test.ts was here alongside the file it tests; it moved
      // to the sdk with it and its `kos.compute.*` fixture keys became
      // `compute.*`, since what they assert is per-feeder namespacing rather than
      // any one Uplink. Ratcheted off.
      // useDataSchema.test.tsx tests the doc-comment-only file of the same name
      // below, same subject.
      "packages/data/src/hooks/useDataSchema.test.tsx",

      // `registry.ts` was here for `clearRegistry`'s doc, which explained itself
      // by naming what it does NOT clear: the kOS script registry. The registry
      // moved into `@ksp-gonogo/sitrep-sdk` on 2026-08-19 and the sdk is the leaf
      // every Uplink depends on, so it cannot name one at all, not even in prose.
      // The doc now states the general rule instead (it never reaches a registry
      // an Uplink owns), which is what it always meant.

      // -- Doc/comment-only mentions elsewhere (kOS is a documented Key
      // Design Constraint: "optional, not a hard dependency": so it is
      // named in prose across many otherwise-unrelated files) --
      // dev-only comms override: its doc-comment cites `kos.keystroke` as an
      // example command to gate during a blackout, comment-only.
      "mod/Gonogo.KSP/DevCommsOverride.cs",
      "mod/Gonogo.KSP/VesselUplink.cs",
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
      "packages/core/src/types.ts",
      // BufferedDataSource.ts / flightDetector.ts were here (prose asides about a
      // kOS-sourced `vesselUid` and the kOS compute fanout as an example feeder).
      // Both moved into `@ksp-gonogo/sitrep-sdk` on 2026-08-19, and the sdk is the
      // leaf every Uplink depends on, so it cannot name one even in prose. They now
      // describe the general shape they always meant ("another feeder", "an
      // authoritative vesselUid from the vessel"), so both ratcheted off.
      "packages/data/src/hooks/useDataSchema.ts",
      "mod/sitrep-sdk/src/spine/replay-session.tsx",
      // types.ts was here for `FlightRecord.vesselUid`'s "arrives from kOS" aside.
      // The flight types moved to the sdk leaf with `BufferedDataSource` and the
      // aside now names the vessel rather than the Uplink that reads it, so this
      // ratcheted off; what stayed behind is the `declare module` block, which
      // names nothing.
      // packages/kerbcast/src/index.ts was here (a "alongside Telemachus / kOS /
      // etc." aside in its header). That package is now
      // mod/GonogoKerbcastUplink/client, and its rewritten header no longer names
      // another Uplink at all: stale twice over, so it ratcheted off.
      "packages/relay/src/bootstrapConfig.ts",
      "mod/sitrep-sdk/src/spine/timeline-store.ts",
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
      // -- Uplink ISOLATION ratchet inventory (2026-08-18): the inward guard's
      // debt list is keyed by file path, so it necessarily names every Uplink
      // directory. Ratchet-inventory file, the case this bucket documents.
      "packages/core/src/uplink-isolation.allowlist.ts",
      // -- TYPECHECK-COVERAGE ratchet inventory (2026-08-21): the debt list
      // of packages whose `typecheck` does not yet cover their own test files
      // is keyed by package directory, so it names every Uplink client.
      // Ratchet-inventory file, the case this bucket documents.
      "packages/core/src/typecheck-coverage.allowlist.ts",
      // -- Judgment calls, all resolved clean (audit §4) --
      "mod/Gonogo.KSP/CommNetBackend.cs",
      "mod/Gonogo.KSP/CommsCoreUplink.cs",
      // dev-only comms override + its DevTools driver both name the stock
      // comms backends ("CommNet / RealAntennas") in doc-comments explaining
      // what they force: comment-only, no RA coupling.
      "mod/Gonogo.KSP/DevCommsOverride.cs",
      // the node-to-node path walk names RealAntennas in a doc comment to record
      // WHY stock's pathfinder can be trusted over RA's links: RA overrides link
      // construction only, never the solver. Comment-only, no RA coupling.
      "mod/Gonogo.KSP/FleetCommsReader.cs",
      "mod/Gonogo.KSP/GonogoAddon.cs",
      "mod/GonogoDevTools/GonogoDevForceComms.cs",
      "mod/Sitrep.Contract/UplinkContract.cs",
      "mod/Sitrep.Host/ChannelEngine.cs",
      "mod/Sitrep.Host/Comms/CommsElection.cs",
      "mod/Sitrep.Host/Comms/SignalDelay.cs",
      // The action-groups election is a deliberate copy of the comms precedent
      // above, and its doc-comment says so: it cites GonogoRealAntennasUplink as
      // the worked example of a provider elected over the stock backend that
      // ships no client code of its own. Prose only: no RA type, reference or
      // coupling; same category as Comms/CommsElection.cs itself.
      "mod/Sitrep.Host/ActionGroups/ActionGroupsElection.cs",
      // Kernel provider-election tests, both halves of the golden-fixture pair.
      // They use "realantennas" as the id of a losing/failing provider because
      // the exclusive "comms" election is the real-world shape the kernel
      // exists to arbitrate, and a test that elects "provider-a" over
      // "provider-b" documents nothing. Fixture strings only: no RA type,
      // reference or dependency.
      "mod/Sitrep.Core.Tests/KernelFactoryFailureTests.cs",
      "mod/sitrep-kernel/src/registry.test.ts",
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
      // -- the occlusion-model seam: three prose mentions and one test --
      // All four name RealAntennas because the seam exists to record that the
      // two comms backends occlude at DIFFERENT radii (stock scales the body
      // down, RA takes it bare), and a comment that omitted the disagreement
      // would be describing the wrong problem. The contract declares the shape
      // both backends fill, stock's own rule file cites RA as the contrast, and
      // the builder records why no backend walks the body list itself: prose
      // only, no RA type or reference, same category as CommsElection.cs.
      "mod/Sitrep.Contract/CommsOcclusion.cs",
      "mod/Gonogo.KSP/CommNetOcclusion.cs",
      "mod/Sitrep.Host/Comms/CommsOcclusionBuilder.cs",
      // The one real reference, and the reviewed exception the ratchet's own
      // failure message names ("a new test"): this suite compiles BOTH
      // backends' KSP-free occlusion declarations side by side, because the
      // difference between them is the thing under test and asserting it
      // against re-stated constants instead would let the two drift silently.
      // Deliberately not domainDebt: there is no coupling here to pay off, the
      // comparison is the point.
      "mod/Sitrep.Host.Tests/CommsOcclusionTests.cs",
      // -- the visibility geometry and the capture analyser built on the seam --
      // Every one of these names RealAntennas for the same reason the occlusion
      // contract above does: the two backends occlude at different radii, and
      // that disagreement is the whole reason the code exists. The geometry's
      // doc-comments cite it to explain why the occluding radius is a parameter
      // rather than a constant, and why a station standing exactly on a
      // bare-radius occluder forced the sign convention it has. The analyser's
      // tests use "RealAntennas bare radius" as a candidate LABEL, which is a
      // string a report prints so the reader can see which assumption produced a
      // number. Prose and display strings only: no RA type, reference or
      // coupling, same category as CommsElection.cs.
      "mod/Sitrep.Propagation/Visibility/ChordOcclusion.cs",
      "mod/Sitrep.Propagation/Visibility/OrbitToGroundStationGeometry.cs",
      "mod/Sitrep.Propagation.Tests/Visibility/OrbitVisibilityTests.cs",
      "mod/Sitrep.CaptureAnalysis.Tests/CommandLineTests.cs",
      "mod/Sitrep.CaptureAnalysis.Tests/RealCaptureTests.cs",
      "mod/Sitrep.CaptureAnalysis.Tests/SyntheticCapture.cs",
      "mod/Sitrep.CaptureAnalysis.Tests/VerdictTests.cs",

      // -- app-side: the sanctioned self-registration import, and its gate --
      // main.tsx takes a static side-effect import of this Uplink's client,
      // alongside the four others that have no runtime-loader entry. It is the
      // "sanctioned self-registration import" category this ratchet's own
      // failure message names, and the relocation is what made it necessary:
      // these three Topics used to be static members of the SDK's Topic union,
      // so every consumer knew them for free, and they are runtime
      // registrations now.
      "packages/app/src/main.tsx",
      // topic-cs-sync.test.ts: the C#-to-runtime-registry sync gate, which
      // statically imports every first-party Uplink client so the assertions
      // read the complete registered union. It is also the test that CAUGHT the
      // gap above, by name, rather than letting three channels drop quietly.
      // Same "one inventory naming every mod" class as the ownership ratchet.
      "packages/app/src/__tests__/topic-cs-sync.test.ts",

      // -- contract/serializer/ratchet layer: PROVENANCE, no coupling --
      // The four files the relocation itself added a mention to, each the same
      // category the earlier relocations put ContractVersion.cs/RtConfig.cs in:
      // a record of what moved and when, on a comment line, with no reference
      // to a relocated type left behind.
      //   • ContractVersion.cs: the Major-bump history entry for the move.
      //   • RtConfig.cs: the note standing where the three typeof() entries were.
      //   • JsonWriter.cs: says where the three deleted serializer cases went
      //     and why core no longer needs them, which is the one thing a reader
      //     hitting the gap will want to know.
      //   • UplinkContractOwnershipTests.cs: the mod-side ownership ratchet has
      //     to NAME the token it registers, so it names this one too. Ratchet
      //     inventory, same as truenow-allowlist.test.ts below.
      "mod/Sitrep.Contract/ContractVersion.cs",
      "mod/Sitrep.Contract/RtConfig.cs",
      "mod/Sitrep.Core/Serialization/JsonWriter.cs",
      "mod/Sitrep.Core.Tests/UplinkContractOwnershipTests.cs",

      // -- Sitrep.Contract/Comms.cs, prose only as of the relocation --
      // It carried the three RA-only payload types until the last step of the
      // uplink-types-out-of-core plan moved them into this Uplink's own contract
      // slice. The entry stays, and it is the clearest example in this file of
      // why a mod name in core is not automatically a boundary problem: the
      // comms family is a two-provider channel set, so the file legitimately
      // explains which backend sources what, and names one of them to do it. It
      // also documents the one field it kept for that reason
      // (CommsHop.BandRateBitsPerSec, present only under that backend but a
      // field on a SHARED type). What it no longer holds is a declaration.
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
      // NOTE: mod/Sitrep.Host/ActionGroups/ActionGroupsElection.cs used to sit
      // here, justified as "constant/method names ... and prose". Naming the API
      // symbols in the justification should have been the tell: a public
      // RegisterActionGroupsExtendedProvider plus two constants is code coupling,
      // which is domainDebt, not the permanent bucket this file put it in. The
      // triple has been deleted and the provider id and priority now live on the
      // uplink that owns them, so the entry is gone rather than reclassified.
      // Doc-comment explaining why the capability's Groups() list is
      // named/arbitrary-length rather than a positional bool[]: cites
      // "Action Groups Extended (AGX)" as the reason, no AGX coupling. Moved
      // out of mod/Sitrep.Host/ActionGroups/ into the contract, which is where
      // a seam an Uplink implements has to live for the Uplink to be able to
      // build against it at all.
      "mod/Sitrep.Contract/ActionGroupsBackend.cs",
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
      "mod/sitrep-sdk/src/spine/map-topic.ts",
      "mod/sitrep-sdk/src/spine/vessel-state.ts",
      // f.ag<N>-beyond-10 toggle fix (2026-07-19): actionGroupHome's
      // doc-comment explains why the write bridge is now a generic
      // `/^f\.ag(\d+)$/` rule instead of a 10-row static table, AGX assigns
      // indices up to 250, same rationale as VesselCommandProvider.cs's own
      // comment above. Prose only; no AGX type or import.
      "mod/sitrep-sdk/src/spine/map-command.ts",

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
      // -- CI gating ratchet (2026-08-20): names the four Uplink test
      // projects that were in mod/Gonogo.sln and in no CI job, which is the
      // finding itself: "four projects drifted" without saying which is not
      // a usable comment. Text-only mention in a ratchet-inventory file, the
      // case this bucket documents.
      "packages/core/src/ci-test-project-coverage.test.ts",
      // -- FIRE-AND-FORGET command budget (2026-08-20): the per-file budget
      // for dispatches that discard their outcome is keyed by file path, so it
      // names every Uplink with a blind dispatch. Ratchet-inventory file, the
      // case this bucket documents.
      "packages/core/src/styleguide-fire-and-forget-commands.test.ts",
      // -- Uplink ISOLATION ratchet inventory (2026-08-18): the inward guard's
      // debt list is keyed by file path, so it necessarily names every Uplink
      // directory. Ratchet-inventory file, the case this bucket documents.
      "packages/core/src/uplink-isolation.allowlist.ts",
      // -- TYPECHECK-COVERAGE ratchet inventory (2026-08-21): the debt list
      // of packages whose `typecheck` does not yet cover their own test files
      // is keyed by package directory, so it names every Uplink client.
      // Ratchet-inventory file, the case this bucket documents.
      "packages/core/src/typecheck-coverage.allowlist.ts",
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
      // AvionicsUnitCoverageTests.cs used to sit here too, and stopped naming
      // the pilot when the five per-Uplink copies of the Unit-coverage sweep
      // were extracted into one shared helper: each Uplink's own file now
      // describes only its own types, and the cross-Uplink "same shape as
      // <sibling>'s" prose that had to be allowlisted went with the copies. The
      // ratchet demanded this line. Same for the Kerbcast entry below.
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
      // -- CI gating ratchet (2026-08-20): names the four Uplink test
      // projects that were in mod/Gonogo.sln and in no CI job, which is the
      // finding itself: "four projects drifted" without saying which is not
      // a usable comment. Text-only mention in a ratchet-inventory file, the
      // case this bucket documents.
      "packages/core/src/ci-test-project-coverage.test.ts",
      // -- Uplink ISOLATION ratchet inventory (2026-08-18): the inward guard's
      // debt list is keyed by file path, so it necessarily names every Uplink
      // directory. Ratchet-inventory file, the case this bucket documents.
      "packages/core/src/uplink-isolation.allowlist.ts",
      // -- TYPECHECK-COVERAGE ratchet inventory (2026-08-21): the debt list
      // of packages whose `typecheck` does not yet cover their own test files
      // is keyed by package directory, so it names every Uplink client.
      // Ratchet-inventory file, the case this bucket documents.
      "packages/core/src/typecheck-coverage.allowlist.ts",
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
      // MechJebRtConfig.cs's doc comment named Avionics as "the next Uplink in
      // the plan's sequencing" before this relocation landed: historical prose
      // from the pilot commit, no Avionics code or type reference.
      // MechJebUnitCoverageTests.cs used to be here for the same kind of prose
      // and stopped naming Avionics when the five per-Uplink copies of the
      // Unit-coverage sweep were extracted into one shared helper: each file now
      // describes only its own types. The ratchet demanded this line.
      "mod/GonogoMechJebUplink.Contract/MechJebRtConfig.cs",
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
      "mod/GonogoKerbcastUplink/client/src/generated-value-import.test.ts",
      "mod/GonogoKerbcastUplink/client/src/topics.test.ts",
    ],
  },

  // === kerbalism: owning dirs mod/GonogoKerbalismUplink/ (incl. its client/),
  //     mod/GonogoKerbalismUplink.Tests/, mod/GonogoKerbalismUplink.Contract/.
  //
  // SEEDED LATE, by the types-out-of-core relocation (fifth step) rather than by
  // the original boundary audit, so it does not carry that audit's HARD/gray
  // categorisation history. Two things follow from the late seed and are worth
  // stating rather than leaving to be inferred:
  //
  //   (1) The seed is LARGE (fifty-odd files) and overwhelmingly PROSE. Kerbalism
  //       is this repository's canonical worked example of the augment/slot
  //       architecture, so a dozen base widgets' doc comments name it while
  //       describing the slot they expose ("an augment, e.g. a Kerbalism
  //       Habitat/Radiation badge, binds here"). Those are words about a
  //       hypothetical contributor, not coupling. Filing them as debt would make
  //       the shrink-only gate demand that the ARCHITECTURE stop being explained.
  //   (2) The debt bucket is deliberately SMALL and specific: four files, all of
  //       them a single outstanding piece of work (the SpaceWeather widget still
  //       living in the base library while every other Kerbalism surface has
  //       moved into this Uplink), plus the app's bundle-time Uplink import that
  //       every token already carries.
  kerbalism: {
    domainDebt: [
      // -- The SpaceWeather widget relocation, the one genuine outstanding
      // coupling. This widget reads `kerbalism.spaceweather` directly and lives
      // in the mod-agnostic base library, which is precisely what the Uplink
      // decoupling exists to end. Every other Kerbalism surface already moved
      // (Ship Systems, the CrewStatus survival augment and its badge, the
      // ShipMap part-meters/part-meta contributions, the space-weather panel
      // badge); this widget is what the Uplink client's own index.ts records as
      // the remaining follow-up.
      //
      // Until the relocation the coupling is at least HONEST: the widget carries
      // a type-only import of the Uplink client for its TopicPayloadMap
      // augmentation, because its payload type is no longer core's own codegen
      // output. Before the fifth relocation it got a Kerbalism type for free out
      // of @ksp-gonogo/sitrep-sdk and named no mod at all, so the coupling
      // existed and was invisible.
      //
      // Moving the widget deletes these three lines and the ratchet forces that
      // deletion in the same commit.
      "packages/components/src/SpaceWeather/index.tsx",
      "packages/components/src/SpaceWeather/index.test.tsx",
      // widgetDomSnapshot.tsx: the shared SSR-snapshot harness carries
      // Kerbalism-specific fixture reshaping (`resolveKerbalismSpaceWeatherWire`
      // and the kerbalism.lifesupport reshape) so the legacy flat `sw.*`/`ls.*`
      // fixtures still drive the modern Topics. Real code, and it goes with the
      // widget: the fixtures stay under packages/components/src because
      // `fixturesPath` resolves against that directory (the same convention Ship
      // Systems' own fixtures already follow from inside this Uplink), but the
      // reshaping belongs beside the widget that needs it.
      "packages/components/src/test/widgetDomSnapshot.tsx",
      // -- Uplink loader: the app's bundle-time import of this Uplink's client.
      // Not this Uplink's own debt so much as the loader's: every token above
      // carries the same entry for the same reason (today every Uplink client is
      // bundled at build, so the app must name them to import them), and they all
      // clear together when the runtime loader lands.
      "packages/app/src/main.tsx",
    ],
    permanent: [
      // The mod-side Uplink isolation ratchet, same case as the magnitude budget
      // below: its shrink-only debt lists are keyed by Uplink project name, so
      // an Uplink that still reaches a private assembly has to be named in one.
      // This is now the only such Uplink, and the entry goes when the debt does.
      // Nothing else in that file names a mod: the directory walk is checked
      // against the project list in Gonogo.sln rather than a hardcoded one,
      // precisely so this stays the last one.
      "mod/Sitrep.Core.Tests/UplinkIsolationTests.cs",
      // -- MAGNITUDE budget ratchet (2026-08-19): the per-file `.magnitude`
      // budget is keyed by file path, so it names every Uplink that unwraps a
      // Value. Ratchet-inventory file, the case this bucket documents.
      "packages/core/src/styleguide-magnitude-budget.test.ts",
      // -- FIRE-AND-FORGET command budget (2026-08-20): the per-file budget
      // for dispatches that discard their outcome is keyed by file path, so it
      // names every Uplink with a blind dispatch. Ratchet-inventory file, the
      // case this bucket documents.
      "packages/core/src/styleguide-fire-and-forget-commands.test.ts",
      // -- Uplink ISOLATION ratchet inventory (2026-08-18): the inward guard's
      // debt list is keyed by file path, so it necessarily names every Uplink
      // directory. Ratchet-inventory file, the case this bucket documents.
      "packages/core/src/uplink-isolation.allowlist.ts",
      // -- TYPECHECK-COVERAGE ratchet inventory (2026-08-21): the debt list
      // of packages whose `typecheck` does not yet cover their own test files
      // is keyed by package directory, so it names every Uplink client.
      // Ratchet-inventory file, the case this bucket documents.
      "packages/core/src/typecheck-coverage.allowlist.ts",
      // FleetReliability's characterisation test emits `reliability.summary`
      // payloads carrying real `source` values. A wire-value reference: the widget
      // only branches on `source === "none"`, never on the vendor.
      "packages/components/src/FleetReliability/undefined.characterise.test.tsx",
      // -- ratchet inventory --
      // The rate-integration candidate scan reads EVERY generated unit
      // descriptor, core's and each Uplink's, because a rate-bearing field
      // landing in an Uplink is exactly the case it exists to catch. It names
      // Kerbalism twice, both in prose: once because Kerbalism's science-data
      // units are the ones core's registry cannot resolve and the scan is
      // therefore blind to, and once in a verdict explaining why its
      // resource amount/rate pairing is real but cross-topic. No Kerbalism
      // type, import, topic or field is referenced, and the verdict data
      // itself lives in a sibling .json this scan never reads.
      "packages/core/src/reckoning-candidates.test.ts",
      // -- contract/SDK layer --
      // ContractVersion.cs and RtConfig.cs carry the relocation's PROVENANCE
      // prose (the Major 9 -> 10 entry, the Minor-history entry recording the
      // Domain's original landing, and the wirePayloadTypes comment recording
      // what left), which is exactly what the permanent bucket is for.
      // KerbalismPayloads.cs is NOT here: it left this bucket by leaving core
      // outright.
      "mod/Sitrep.Contract/ContractVersion.cs",
      "mod/Sitrep.Contract/RtConfig.cs",
      // The source-attributed currency events name Kerbalism in PROSE ONLY, to
      // record why the science-credit event is a core type rather than a
      // Kerbalism one: stock's lump credit on transmit-stream completion and
      // Kerbalism's continuous accrual both arrive on the same stock
      // GameEvents.OnScienceRecieved hook carrying the same ProtoVessel, so
      // neither mod needs special handling and the event belongs to core. Zero
      // code coupling: no Kerbalism type, import, topic or field is referenced.
      "mod/Gonogo.KSP/CurrencyEventUplink.cs",
      "mod/Sitrep.Contract/CurrencyEventPayloads.cs",
      // Reliability.cs: the DOMAIN-NEUTRAL reliability capability contract. It
      // names Kerbalism as one of the two backends that can serve the channel
      // (the other being TestFlight) because the whole point of the shape is
      // that it is a source-agnostic superset: several fields are documented as
      // "TestFlight fills it; null for Kerbalism" and vice versa. Naming both is
      // the contract's job.
      "mod/Sitrep.Contract/Reliability.cs",
      // contribution-slots.ts: the SDK's mirror of the host-declared
      // contribution slots. `ship-map.part-meters` / `ship-map.part-meta`
      // declare `kerbalism.profile` / `kerbalism.lifesupport` as the Topics a
      // contribution to those slots may read, because that IS the slot's
      // contract. String literal types in a slot declaration, not a payload
      // type and not a TopicId: nothing kerbalism-specific is imported.
      "mod/sitrep-sdk/src/api/contribution-slots.ts",
      // wrap-units.ts (the hand-written decoder, not a generated map): its
      // name-keyed-map branch cites kerbalism.lifesupport.rates as the case that
      // forced it, since every earlier name-keyed channel used a nested SHAPE as
      // its value and a map of bare scalars had no case. Prose in a mod-agnostic
      // file explaining a general mechanism.
      "mod/sitrep-sdk/src/unit-system/guards.ts",
      "mod/sitrep-sdk/src/wrap-units.ts",

      // -- app / core --
      // topic-cs-sync.test.ts: the C#-to-runtime-registry sync gate. It
      // statically imports every Uplink client (incl. this one) so their
      // registration calls fire, then asserts the registry matches the C#. A
      // sanctioned self-registration import, same class as the entry every other
      // token carries for this file.
      "packages/app/src/__tests__/topic-cs-sync.test.ts",
      // defineTopicManifest.ts: `kerbalism.power` in a DOC-COMMENT example of the
      // manifest helper's shape. That Topic does not exist; it is illustrative.
      "packages/core/src/hooks/defineTopicManifest.ts",
      // searchTags.ts: "Kerbalism" as the example value of an Uplink's display
      // name field, in that field's doc comment.
      "packages/core/src/searchTags.ts",
      // map-topic.ts / event-timeline.ts: a section header for the kerbalism
      // Topic block, and a design-doc citation respectively.
      "mod/sitrep-sdk/src/event-timeline.ts",
      "mod/sitrep-sdk/src/spine/map-topic.ts",

      // -- base-library widgets: SLOT DOCUMENTATION, not coupling --
      // Each of these names Kerbalism in prose while documenting a slot,
      // augment or badge surface it exposes for an Uplink to fill: "an augment
      // (e.g. a Kerbalism EC-broker breakdown) renders here", "unfilled until a
      // Kerbalism-style Uplink binds". The named mod is a hypothetical
      // contributor, and the widget reads no kerbalism Topic and imports no
      // kerbalism type. ShipMap additionally declares `kerbalism.profile`/
      // `kerbalism.lifesupport` in its two ContributionRegistry slot entries,
      // the host half of the same contract sitrep-sdk mirrors above. FleetRoster
      // and its sibling carry "kerbalism" as a registerComponent search TAG,
      // which is metadata text.
      "packages/components/src/ActionGroup/index.tsx",
      "packages/components/src/CrewStatus/badge.ts",
      "packages/components/src/CrewStatus/index.tsx",
      "packages/components/src/Experiments/index.tsx",
      "packages/components/src/FleetReliability/index.tsx",
      "packages/components/src/FleetRoster/index.tsx",
      "packages/components/src/LaunchDirector/index.tsx",
      "packages/components/src/PowerSystems/index.tsx",
      "packages/components/src/ScienceData/index.tsx",
      "packages/components/src/ShipMap/index.tsx",
      "packages/components/src/ShipMap/partMetersContribution.ts",
      "packages/components/src/ShipMap/shipTopology.ts",
      // DivergingBar.tsx: the kit primitive credits the HTML prototype its
      // design was ported from, which happens to be named after the Domain it
      // was mocked for. A provenance citation.
      "packages/ui-kit/src/DivergingBar.tsx",

      // -- sibling Uplinks + core mod: prose only --
      // ReliabilityCoreUplink.cs / ReliabilityElection.cs /
      // NoneReliabilityBackend.cs: the reliability capability's ELECTION, which
      // by design enumerates its candidate backends by name and priority. Naming
      // them is the mechanism, and the whole point is that core declares the
      // channels so neither backend has to.
      "mod/Gonogo.KSP/ReliabilityCoreUplink.cs",
      "mod/Sitrep.Host/Reliability/ReliabilityElection.cs",
      "mod/Sitrep.Host/Reliability/NoneReliabilityBackend.cs",
      // GonogoDevKerbalismDump.cs: a DEV-ONLY fixture collector, never shipped.
      // It reflects into Kerbalism at runtime with no compile-time reference and
      // exists precisely so this Uplink's shapes could be grounded in captured
      // fixtures. It is arguably this Uplink's own tooling living in the dev-tools
      // project; it stays permanent rather than debt because moving a dev-only
      // dump into a shipped Uplink would be the wrong direction.
      "mod/GonogoDevTools/GonogoDevKerbalismDump.cs",
      // Sibling Uplink clients citing a shared design doc by filename
      // (local_docs/kerbalism-RO-design-DECISIONS.md), or noting that a
      // Kerbalism-shaped filler for one of their own slots is a later phase, or
      // recording that they share this Uplink's "no runtime-loader entry, plain
      // static import" bootstrap path. Zero code or type coupling.
      "mod/GonogoBreakingGroundUplink/client/src/DeployedScience/index.tsx",
      "mod/GonogoKerbcastUplink/client/src/CameraFeed/CameraFeed.tsx",
      "mod/GonogoKerbcastUplink/client/src/KerbcastEventProducer.ts",
      "mod/GonogoMechJebUplink/client/src/index.ts",
      "mod/GonogoMechJebUplink/client/src/MechJeb/index.tsx",

      // -- TEST-only --
      // UplinkContractOwnershipTests.cs / WirePayloadCoverageTests.cs: the
      // mod-side relocation-ownership ratchet and the wire-payload coverage
      // ratchet. Both are inventories that by design enumerate the mods they
      // guard; the first registers this Uplink's own token so no Kerbalism* wire
      // type may return to Sitrep.Contract, the second records that the fifteen
      // types left.
      "mod/Sitrep.Core.Tests/UplinkContractOwnershipTests.cs",
      "mod/Sitrep.Core.Tests/WirePayloadCoverageTests.cs",
      // sitrep-sdk's own tests: both now carry a comment recording what MOVED
      // OUT of core's generated surface with this relocation (the five Topic ids,
      // and the name-keyed-map unit assertion). What matches is the explanation
      // of an absence.
      "mod/sitrep-sdk/src/generated.test.ts",
      "mod/sitrep-sdk/src/topics.test.ts",
      // Base-library and core tests using "kerbalism" as a generic EXAMPLE
      // provider/augment/component id ("kerbalism-ec", "kerbalism-power-systems",
      // requires: "kerbalism"), asserting a base widget does NOT couple to it
      // (CrewStatus asserts it never subscribes to kerbalism.crew), or naming it
      // in prose as one possible reliability source. FleetReliability emits
      // `source: "kerbalism"` on the source-AGNOSTIC reliability.summary Topic,
      // which is the field's whole point.
      "packages/core/src/contributionsRuntime.test.tsx",
      "packages/core/src/registry.replacement.test.ts",
      "packages/core/src/truenow-allowlist.test.ts",
      "packages/components/src/CrewStatus/index.test.tsx",
      // ScienceData/index.test.tsx: asserts the stock path (no Kerbalism
      // client imported anywhere in this package's test tree) renders the
      // science-data.aboard-row slot empty, same "base widget does NOT
      // couple to it" shape as CrewStatus's own entry above.
      "packages/components/src/ScienceData/index.test.tsx",
      "packages/components/src/FleetReliability/index.test.tsx",
      "packages/components/src/FleetRoster/index.test.tsx",
      "packages/components/src/ShipMap/ShipDiagram.test.tsx",
      "packages/components/src/ShipMap/contributions.test.tsx",
      // unit-symbol-collision.test.ts: the guard for a real shipped bug, named
      // after where it was seen (a death-clock badge reading "~4M" for four
      // minutes). Provenance for a general unit-symbol rule.
      "packages/ui-kit/src/unit-symbol-collision.test.ts",
    ],
  },
  // === testflight: owning dir mod/GonogoTestFlightUplink/. Had an owning
  // Uplink and no token at all until now, so nothing was checking it. Its
  // provider registers generically into the "reliability" capability, so core
  // never names it.
  testflight: {
    domainDebt: [],
    permanent: [
      // -- CI gating ratchet (2026-08-20): names the four Uplink test
      // projects that were in mod/Gonogo.sln and in no CI job, which is the
      // finding itself: "four projects drifted" without saying which is not
      // a usable comment. Text-only mention in a ratchet-inventory file, the
      // case this bucket documents.
      "packages/core/src/ci-test-project-coverage.test.ts",
      // FleetReliability's characterisation test emits `reliability.summary`
      // payloads carrying real `source` values, which is what the wire carries.
      // A wire-value reference, the case this bucket exists for: the widget only
      // branches on `source === "none"` and never on the vendor, so the strings
      // are fixture realism rather than coupling.
      "packages/components/src/FleetReliability/undefined.characterise.test.tsx",
      // Same wire-value reference in the widget's stale-branch test.
      "packages/components/src/FleetReliability/stale.test.tsx",
      // Every entry is a doc-mention naming TestFlight as the OTHER backend that
      // competes for the shared "reliability" capability, which is how the
      // election and the wire shape are explained. None imports, references or
      // derives from anything in the owning dir.
      //
      // Kerbalism's half of that shared capability: its backend, its map, its
      // uplink registration and its contract extension all name TestFlight to
      // say which fields the OTHER provider fills and which it leaves null.
      "mod/GonogoKerbalismUplink/KerbalismReliabilityBackend.cs",
      "mod/GonogoKerbalismUplink/KerbalismReliabilityMap.cs",
      "mod/GonogoKerbalismUplink/KerbalismUplink.cs",
      "mod/GonogoKerbalismUplink.Contract/KerbalismReliabilityExt.cs",
      "mod/GonogoKerbalismUplink.Tests/KerbalismCaptureTests.cs",
      "mod/GonogoKerbalismUplink.Tests/ReliabilityExtensionWireTests.cs",
      // The core uplink that declares the reliability channels names both
      // backends in the same breath, for the same reason.
      "mod/Gonogo.KSP/ReliabilityCoreUplink.cs",
      // Dev-only Kerbalism dump tool, doc-mention.
      "mod/GonogoDevTools/GonogoDevKerbalismDump.cs",
      // The reliability wire contract and its election, which name both
      // competing backends to explain the shape and the precedence. Contract
      // and election layer, doc-mention only.
      "mod/Sitrep.Contract/Reliability.cs",
      "mod/Sitrep.Contract/SitrepUnitAttribute.cs",
      "mod/Sitrep.Host/Reliability/ReliabilityElection.cs",
      "mod/Sitrep.Host/Reliability/NoneReliabilityBackend.cs",
      "mod/Sitrep.Host.IntegrationTests/FlightEndToEndTests.cs",
      // Widgets that render the reliability domain and name TestFlight in prose
      // to explain which source a field came from.
      "packages/components/src/FleetReliability/index.tsx",
      "packages/components/src/FleetReliability/index.test.tsx",
      "packages/components/src/FleetReliability/composition.test.tsx",
      "packages/components/src/FleetRoster/index.tsx",
    ],
  },

  // === principia: NO owning dir, deliberately. There is no Principia Uplink,
  // and a token without an owning directory makes ANY mention of the mod in
  // this repo a hard failure. That is the correct default for a mod we do not
  // integrate: the pattern this ratchet exists to stop is core naming a
  // specific mod, and the moment that is most likely is when someone leaves a
  // seam "ready" for a mod that has no Uplink yet. A token keyed on mods we
  // already integrate cannot see that case, which is exactly how
  // TargetApproachElection acquired a public RegisterPrincipiaProvider and
  // PrincipiaProviderId without ever being flagged.
  principia: {
    domainDebt: [],
    permanent: [
      // -- CI gating ratchet (2026-08-20): names the four Uplink test
      // projects that were in mod/Gonogo.sln and in no CI job, which is the
      // finding itself: "four projects drifted" without saying which is not
      // a usable comment. Text-only mention in a ratchet-inventory file, the
      // case this bucket documents.
      "packages/core/src/ci-test-project-coverage.test.ts",
      // -- TYPECHECK-COVERAGE ratchet inventory (2026-08-21): its debt list is
      // keyed by package directory, and `mod/GonogoPrincipiaUplink/client` is
      // one of the directories whose tests are not yet typechecked. Text-only
      // mention in a ratchet-inventory file, same case as the entry above.
      "packages/core/src/typecheck-coverage.allowlist.ts",
      // Everything below is a HISTORICAL RECORD of a decision that removed
      // Principia awareness from core, or documentation of an external format
      // that named it. You cannot record "we deliberately deleted detection of
      // this mod" without naming the mod, and rewriting a ledger to hide the
      // subject would defeat the ledger. Every FORWARD-LOOKING mention ("a
      // future Principia provider will...") has been de-named instead: those
      // were the anticipation pattern this token exists to catch, and the
      // interfaces now say "an n-body backend", which is the same point without
      // committing core to a specific mod.
      //
      // ContractVersion's Major 2 -> 3 entry records the revert that removed
      // VesselPhysicsMode.IsPrincipiaActive, and the file's own contract is that
      // a Major "cannot rewrite what it inherited".
      "mod/Sitrep.Contract/ContractVersion.cs",
      // The three client-side records of that same revert: they exist to explain
      // why a.physicsMode is neither mapped nor gapped, which is unanswerable
      // without naming what was removed.
      "mod/sitrep-sdk/src/spine/map-topic.ts",
      "packages/sitrep-client/src/map-topic.rawFieldRoots.coverage.test.ts",
      "packages/app/src/telemetry/SitrepTelemetryProvider.mappedAndCarried.test.ts",
      // Documentation of the LEGACY TELEMACHUS wire key's literal values, which
      // were "patched_conics" and "n_body" with Principia as the stated cause.
      // Describing a third party's format is not coupling to it.
      "packages/core/src/schemas/telemachus.ts",
      // truenow-allowlist.test.ts: the sibling architectural ratchet, listed here
      // for the same reason it is under the other tokens. It is a path-keyed
      // allowlist over every Uplink's .cs files, so it necessarily names them all.
      // A path string in a ratchet, not a dependency.
      "packages/core/src/truenow-allowlist.test.ts",
      // The two SANCTIONED SELF-REGISTRATION IMPORTS of this Uplink's client
      // package, the same pair every bundled Uplink has. An import of a package
      // whose name contains the mod's is the mechanism by which an Uplink
      // registers at all; the app learns nothing about the mod from it, and the
      // alternative is an app that cannot load its own bundled Uplinks. Not
      // domainDebt, because there is no coupling here to shrink: if the Uplink
      // is deleted, so is the import.
      "packages/app/src/main.tsx",
      "packages/app/src/__tests__/topic-cs-sync.test.ts",
    ],
  },
  telemachus: {
    // A RETIRED dependency rather than an Uplink: see this token's entry in
    // uplink-boundary.test.ts for why it is gated at all, and
    // local_docs/design/2026-08-17-telemachus-residue-inventory.md for the
    // full inventory. Scanned with comments stripped, so every line below is
    // real code or a real string, and every one names WHO references it: a
    // Telemachus-named file is not evidence of anything, which is the mistake
    // that put fakeTelemachus.ts in the "dead" bucket of the very inventory
    // written to catch it.
    permanent: [
      // The ratchet that counts this name, and its seed data. Naming it is
      // their whole job, and they are the instrument that retires every other
      // entry in this token.
      "packages/core/src/vendor-name.allowlist.ts",
      "packages/core/src/vendor-name.test.ts",
      // Files whose only mention RECORDS that the coupling is gone, or
      // describes a third party's bug. Naming it is the file's job.
      "packages/components/src/OrbitView/stream.test.tsx",
      "packages/core/src/hooks/useGameContext.test.tsx",
      "mod/Sitrep.Host.IntegrationTests/MilestoneReplayEndToEndTests.cs",
      "mod/Sitrep.Host.Tests/SystemViewProviderTests.cs",
    ],
    domainDebt: [
      // --- The mapTopic shim: LEGACY_KEY_HOMES, 204 entries, called by
      // context.tsx on every useTelemetry read, with 76 old-style keys still
      // declared across 23 widget files. The largest item by far, and a
      // 76-key migration rather than a rename. ---
      "packages/sitrep-client/src/map-topic.test.ts",
      "packages/core/src/hooks/mapTopic.coverage.test.ts",
      // orbit-patches renames wire fields onto the legacy OrbitPatch shape,
      // and its test says so in a test name. Retires when that shape does.
      "packages/sitrep-client/src/orbit-patches.test.ts",
      // core's barrel re-exports schemas/telemachus.ts. The schema file itself
      // is invisible to this token: its type is spelled TelemaachusSchema, with
      // a typo, so only the import path matches. Retires with the shim.
      "packages/core/src/index.ts",

      // --- The legacy data catalog: TELEMACHUS_META / legacyDataCatalog,
      // reached through BufferedDataSource and useDataSchema.
      // packages/app/src/dataSources/missionHistory.ts already records that
      // "data"/BufferedDataSource are slated for wholesale deletion. ---
      "packages/data/src/schema/telemachusMeta.ts",
      "packages/data/src/schema/legacyDataCatalog.ts",
      // BufferedDataSource(.test).ts were here. They moved to
      // `@ksp-gonogo/sitrep-sdk` on 2026-08-19 and could not carry the name onto a
      // published leaf, so `enrichKey` became an injected seam: the catalogue stays
      // here with the keys it describes, and the buffering layer no longer knows
      // whose keys it is labelling. Ratcheted off.
      "packages/data/src/FlightsManager/MissionHistorySource.ts",
      "packages/data/src/FlightsManager/MissionHistorySource.test.ts",
      "packages/data/src/index.ts",
      // imports TELEMACHUS_META for its friendly labels.
      "packages/app/src/notes/TagAutocomplete.tsx",

      // --- Test scaffolding for the legacy useTelemetry("data", key) branch.
      // fakeTelemachus stands in for the DataSource; the peer tests use
      // "telemachus" as a source id. All retire with the shim above and not
      // before: that fixture has two live importers. ---
      "packages/app/src/__tests__/fixtures/fakeTelemachus.ts",
      "packages/app/src/__tests__/action-group.test.tsx",
      "packages/app/src/__tests__/peer-roundtrip.test.ts",
      "packages/app/src/__tests__/peer-client-service.test.ts",
      "packages/app/src/__tests__/peer-client-data-source.test.ts",
      "packages/app/src/__tests__/peer-data-sources.test.ts",
      "packages/components/src/DataSourceStatus/index.test.tsx",

      // The USER-FACING COPY group that stood here is PAID OFF: seven widgets
      // named the retired source in strings an operator reads on screen, and
      // none of them does now. Each kept the fact it was stating and dropped
      // the vendor.
    ],
  },
};
