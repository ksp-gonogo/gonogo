/**
 * Data for the uplink-boundary ratchet (`uplink-boundary.test.ts`). Pure
 * data module: no test logic, no scan mechanics: so the shrink-only
 * check in that file can load this module's content at an arbitrary git
 * ref (via `git show <ref>:<path>` + an esbuild transpile) without pulling
 * in vitest or the walk/pattern machinery.
 *
 * Full catalogue, categorisation (HARD / gray / test / comment-only), and
 * the reasoning behind every entry: this file, per entry. Each comment below
 * carries its own, which is the point of writing them here rather than
 * pointing at a document that can move away from the list it describes.
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
  | "ferram"
  | "realsolarsystem";

/**
 * How much of a `packages/<pkg>` directory the scan walks. Recorded HERE, in
 * the data module, so the shrink-only checks can read it at their base ref.
 *
 * `packages/components/scripts/` holds the visual-gate probe
 * harnesses, which side-effect-import three Uplink clients so the probe can
 * photograph the augments those Uplinks contribute into built-in widgets, and
 * `packages/app/scripts/minsize-gate.ts` names nine Uplink bundles: narrowing
 * the scan back to `src` would make those invisible again, with no line for
 * them able to appear below.
 *
 * Widening a scan is the one change every shrink-only gate reads as a flood of
 * new debt. Grading it that way makes the rule impossible to widen without
 * disabling its own ratchet, which is why `uplink-isolation.test.ts` learned the
 * same trick for `FORBIDDEN_PACKAGES` first: an entry for a path the BASE could
 * not reach is a reseed, not growth, and it is graded strictly from the next
 * commit onwards, when the base carries this same value. The seam is inert the
 * moment this lands, and cannot excuse a second widening without this constant
 * changing again in a reviewed edit.
 */
export const PACKAGE_SCAN_SCOPE = "package";

/**
 * Which file extensions the scan walks. Recorded HERE, beside
 * `PACKAGE_SCAN_SCOPE` and for the identical reason: an extension the walk did
 * not visit is a path no allowlist line could ever have named, so the
 * shrink-only checks have to be able to read the set at their base ref to tell a
 * reseed from growth.
 *
 * A stylesheet is the one file kind
 * in this tree whose whole job is arguing in prose about boxes that belong to
 * specific widgets. `packages/theme/src/tokens.css` could name an Uplink
 * and pass unnoticed. That is not hypothetical: identical prose can appear
 * correctly in a `packages/core` comment, where the gate fires, and just as
 * easily land in `tokens.css`, where nothing would catch it.
 *
 * The reseed seam this opens is narrower than the scope one, because a LIST
 * needs no interpretation: `PACKAGE_SCAN_SCOPE` is an opaque marker, so a value
 * the checks do not recognise has to be read as "it saw everything", whereas a
 * base's extension list says outright what it reached. Only an ABSENT list has
 * to be guessed at, and absent means a base predating this constant, which is
 * the `ts`/`tsx`/`cs` era.
 */
export const SCAN_EXTENSIONS = ["ts", "tsx", "cs", "css"];

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
  /*
   * The pack RP-1 is played on. `domainDebt` EMPTY and meant
   * to stay so: there is no Uplink owning this pack yet, so any CODE that names
   * it is a violation the gate states rather than a thing it offers a bucket
   * for. The single permanent entry is one comment.
   *
   * It earned a token by being missed. `packages/core/src/rss-bodies.ts` sat in
   * CORE for eleven days holding a planet pack's body table, exported from
   * core's public surface, while `packages/core/src/bodies.ts` next to it was
   * already a tombstone reading "the body registry moved to the sdk: a planet
   * pack is an Uplink's business". No gate objected, because RealSolarSystem
   * was not a token and so was not a thing the gate could express.
   */
  realsolarsystem: {
    permanent: [
      /*
       * Prose, citing PROVENANCE: the pressure-profile test measures its
       * reconstruction error against the real curve the pack ships for Earth,
       * and its doc comment names the config file that came from. A test that
       * says where its ground truth was taken from is doing the right thing,
       * and the name is text.
       */
      "mod/Sitrep.Host.Tests/AtmospherePressureProfileTests.cs",
      /*
       * The contract layer, and the generated mirror of it. `WarpState.WarpRates`
       * ships the install's own warp ladder BECAUSE a pack is free to replace
       * it, and the pack that does is named as the worked example. The pack is
       * prose in a doc comment on a first-party wire type; nothing here reaches
       * for anything the pack ships.
       */
      "mod/Sitrep.Contract/WarpState.cs",
      "mod/Sitrep.Contract/ContractVersion.cs",
      "mod/sitrep-sdk/src/__generated__/contract.ts",
      /*
       * Prose, citing PROVENANCE: the test that pins the warp ladder to the
       * install's own rates carries the table it was measured against, and names
       * the pack that install runs. A test that says where its ground truth was
       * taken from is doing the right thing, and the name is text. The
       * client code it covers names no pack at all, only "a planet pack".
       */
      "packages/app/src/alarms/warp-ladder-install-rates.test.ts",
    ],
    domainDebt: [],
  },
  // === kerbcast: owning dir mod/GonogoKerbcastUplink/ (incl. its client/).
  kerbcast: {
    domainDebt: [
      /*
       * The station's brokered-camera wiring. The `import type` went when this
       * Uplink left the repo, and the coupling did not: `StationScreen` still
       * names one id to `getUplinkHandle` and `client.sendUplinkRelay`, so one
       * Uplink can have its WebRTC handshake relayed through the host and no
       * other can ask for the same. Clears when attaching a broker becomes
       * something an Uplink DECLARES; see `noBakedUplinkIds.test.ts`, whose own
       * debt list records the same gap from the import side.
       */
      "packages/app/src/screens/StationScreen.tsx",
      /*
       * packages/components/src/Targeting/index.tsx was here: its built-in
       * HudCamera imported @ksp-gonogo/gonogo-kerbcast-uplink directly. That backdrop is
       * now the `kerbcast-docking-camera` AUGMENT filling the widget's
       * `targeting.camera` slot, and the widget names no camera mod at
       * all: so the entry went stale and ratcheted off.
       */
    ],
    permanent: [
      // prose: a timeout note quoting this very gate's failure message.
      "packages/core/vitest.config.ts",
      // prose: kerbcast is the facecam this probe STANDS IN FOR with a fake augment, named to say what the fake is imitating. No import, and deliberately so.
      "packages/components/scripts/crew-avatar-probe/crew-avatar-probe-entry.tsx",
      /*
       * -- PERMANENT-BUCKET gate: the test that freezes the
       * code-carrying subset of this file's own `permanent` lists. A gate over
       * the allowlist names Uplinks the same way the allowlist does, and its
       * worked example of a planted violation has to name a real token to be
       * a demonstration rather than a description.
       */
      "packages/core/src/uplink-permanent-code.test.ts",
      /*
       * -- CATALOGUE ABSENCE INVENTORY: the pinned list of carried
       * Topics the topic-field catalogue can describe nothing about names each
       * Uplink Topic that has none, so a Topic arriving unannotated is a test
       * failure rather than a silent absence from every picker in the app.
       * Permanent, not debt: it is a ratchet inventory of TOPIC NAMES and holds
       * no code coupling, and the whole point of pinning it is that the names
       * are written down rather than derived.
       */
      "packages/data/src/schema/topicFieldCatalog.test.ts",
      /*
       * -- Uplink ISOLATION ratchet inventory: the inward guard's
       * debt list is keyed by file path, so it necessarily names every Uplink
       * directory. Ratchet-inventory file, the case this bucket documents.
       */
      "packages/core/src/uplink-isolation.allowlist.ts",
      /*
       * flag.ts / flag.test.ts / main.tsx were here (the loader's shipped
       * first-party enabled-id list, its test, and main.tsx's prose naming the
       * three ids it booted). The list was deleted: the loader
       * derives what to attempt from the live roster, so no app source names
       * kerbcast at all now, stale, ratcheted off.
       */

      // -- sitrep-client / contract layer, comment or string-literal only --
      /*
       * UplinkContract.cs was here: `CommandDeclaration`'s doc comment pointed
       * at the design doc's kerbcast negotiate discussion for why the Delayed
       * flag existed. The flag moved onto `[SitrepCommand]`, so the paragraph
       * naming kerbcast went with it, stale, ratcheted off.
       */
      "mod/Sitrep.Host/ChannelEngine.cs",
      "mod/sitrep-sdk/src/spine/context.tsx",
      "mod/sitrep-sdk/src/spine/delay-authority.ts",
      "packages/sitrep-client/src/map-topic.test.ts",
      /*
       * view-clock.ts/view-clock-formula.ts: cross-browser kerbcast
       * video-delay design extracted ViewClock's
       * confirmedEdgeUt()/utNowEstimate() formula into pure functions
       * (view-clock-formula.ts) so the kerbcast per-frame delay WORKER can
       * mirror it exactly instead of forking it; see ViewClock.snapshot().
       * Comment/doc mentions only; neither file imports anything
       * kerbcast-specific, and sitrep-client stays mod-agnostic.
       */
      "mod/sitrep-sdk/src/view-clock-formula.ts",
      "mod/sitrep-sdk/src/spine/view-clock.ts",

      /*
       * -- the kerbcast Uplink's provenance record in core --
       * ContractVersion.cs's Minor-history doc comment records the ORIGINAL
       * add of kerbcast's control-plane types (Major-4 line, Bumped 0 -> 1):
       * prose/history only, the types themselves no longer live here.
       */
      "mod/Sitrep.Contract/ContractVersion.cs",
      /*
       * default-carried-topics.ts: the raw-topic promotion allowlist, which
       * is a literal-string set and so must name every Uplink's topics,
       * it already names scansat.*, kos.*, recovery.* and comms.* the same
       * way. String literals only; nothing kerbcast-specific is imported.
       */
      "mod/sitrep-sdk/src/default-carried-topics.ts",

      /*
       * UplinkContractOwnershipTests.cs: the mod-side relocation-ownership
       * ratchet. It necessarily names
       * every relocated Uplink's token in its own RelocatedModTokens data and
       * doc comment, kerbcast included now that its three types have moved
       * out: a ratchet naming its own subject, not a boundary violation, same
       * class as the WirePayloadCoverageTests.cs entry above.
       */
      "mod/Sitrep.Core.Tests/UplinkContractOwnershipTests.cs",

      /*
       * truenow-allowlist.test.ts: the sibling architectural ratchet. It is a
       * path-keyed allowlist over every Uplink's .cs files, so it necessarily
       * names them all (Gonogo.KSP's SpaceCenter/Career/System/Comms uplinks are
       * already listed there the same way). A path string in a ratchet, not a
       * dependency.
       */
      "packages/core/src/truenow-allowlist.test.ts",
      // -- Doc/comment-only mentions --
      "packages/app/src/dataSources/migrateGameHost.ts",
      "packages/app/src/dataSources/seedKspHost.ts",
      "mod/sitrep-sdk/src/testing/install-dom-stubs.ts",
      "packages/data/src/FlightsManager/AutoRecordController.tsx",
      "packages/relay/src/bootstrapConfig.ts",
      /*
       * slots.ts's header comment explains why kerbcast's OWN CameraFeed
       * slots ("camera-feed.overlay"/".badges") are deliberately NOT
       * centrally mirrored here (would need the sdk leaf to import from an
       * Uplink client package: the same turbo `^build` cycle the whole
       * file's mirroring approach exists to avoid). Comment-only; nothing
       * kerbcast-specific is imported or re-exported.
       */
      "mod/sitrep-sdk/src/api/slots.ts",
      /*
       * sdk-facade.conformance.test-d.ts: the drift-guard's own comment on
       * the new DelayClockLike assertion names kerbcast as the mirror's
       * consumer. Prose only: the file imports sitrep-client/sitrep-sdk
       * types, never anything kerbcast-specific.
       */
      "packages/core/src/sdk-facade.conformance.test-d.ts",
      /*
       * The comms ISitrepUplink.Health() implementation cites
       * KerbcastUplink/KerbcastHealth in doc comments as the reference
       * reporter pattern it mirrors (the KerbcastHealth pure-Evaluate split
       * was the first-party precedent). Prose only, no import, type, or code
       * coupling to the kerbcast Uplink; same class as the RA/AGX "worked
       * example" citations elsewhere in this file.
       */
      "mod/Gonogo.KSP/CommsCoreUplink.cs",
      "mod/Sitrep.Host/Comms/CommsHealth.cs",
      "mod/Sitrep.Host.Tests/CommsHealthTests.cs",
      /*
       * AlarmHostService.test.ts names the "kerbcast.events" topic id as a
       * string literal only (TEST-only, same class as loaderState.test.ts /
       * flag.test.ts above). Permanent.
       */
      "packages/app/src/alarms/AlarmHostService.test.ts",
    ],
  },

  // === scansat: owning dir mod/GonogoScansatUplink/
  scansat: {
    domainDebt: [
      // -- HARD violations --
    ],
    permanent: [
      /*
       * -- CARRIED CONTRACT PROSE: the generated contract now
       * carries the C# doc comments it is generated from, and a wire type
       * describes what an ELECTED backend puts in it. Here, Kerbalism's own
       * science payload says a SCANsat scanner is one of the two things that
       * produce data continuously, and names the module doing it. Text only,
       * in a generated file, and naming the backend IS the fact being stated
       * rather than a dependency on it, so this is the same class as the doc-
       * mention citations already here.
       */
      "mod/GonogoKerbalismUplink/client/src/__generated__/contract.ts",
      /*
       * The comment-stack ratchet's own inventory: a path-keyed debt list over
       * every hand-written JS/TS file in the repo, so it names this Uplink's paths
       * by construction and there is nowhere else for it to live. Permanent for
       * the reason the other tokens record: a gate placed inside an Uplink is one
       * a third-party author could not run.
       */
      "packages/core/src/comment-stacks.allowlist.ts",
      /*
       * The stale-reference ratchet's own inventory: debt keyed by the path of
       * the file carrying a comment, so it names this Uplink's paths by
       * construction. A gate placed inside an Uplink is one a third-party
       * author could not run.
       */
      "packages/core/src/stale-references.allowlist.ts",
      /*
       * -- DYNAMIC-NAMESPACE ROUTING: `mapTopic` identity-maps the
       * per-body scansat namespaces and the kOS compute namespace, because both
       * materialise their Topics per subject at runtime and so appear in no
       * generated list. A pattern is the only thing that can vouch for such a
       * key, and the pattern has to live where the routing does. Permanent: a
       * dynamic namespace can never be enumerated into the SDK's generated map.
       */
      "mod/sitrep-sdk/src/spine/map-topic.ts",
      /*
       * -- CATALOGUE ABSENCE INVENTORY: the pinned list of carried
       * Topics the topic-field catalogue can describe nothing about names each
       * Uplink Topic that has none, so a Topic arriving unannotated is a test
       * failure rather than a silent absence from every picker in the app.
       * Permanent, not debt: it is a ratchet inventory of TOPIC NAMES and holds
       * no code coupling, and the whole point of pinning it is that the names
       * are written down rather than derived.
       */
      "packages/data/src/schema/topicFieldCatalog.test.ts",
      /*
       * -- Uplink ISOLATION ratchet inventory: the inward guard's
       * debt list is keyed by file path, so it necessarily names every Uplink
       * directory. Ratchet-inventory file, the case this bucket documents.
       */
      "packages/core/src/uplink-isolation.allowlist.ts",
      /*
       * -- Kerbalism's own SCANsat bridge --
       * Kerbalism ships a `KerbalismScansat` PartModule and a config patch that
       * DELETES the part's `SCANexperiment` module to make room for it. So with
       * both mods installed the scanner is Kerbalism's to report, and the
       * Kerbalism provider reports it: one `science.instruments` row per module,
       * with its own half of the extension bag.
       *
       * These are not coupling to the SCANsat Uplink, and cannot shrink into it.
       * Every read goes through Kerbalism's reflection surface for a
       * Kerbalism-owned type; no SCANsat assembly, API or Topic is touched, and
       * GonogoScansatUplink is not referenced. What matches the token is the
       * module's NAME plus the prose explaining why a Kerbalism file talks about
       * SCANsat at all. Moving any of it into the SCANsat Uplink would be exactly
       * backwards: that Uplink cannot see Kerbalism's modules.
       */
      "mod/GonogoKerbalismUplink/KerbalismReflection.cs",
      "mod/GonogoKerbalismUplink/KerbalismRawTypes.cs",
      "mod/GonogoKerbalismUplink/KerbalismScienceMap.cs",
      "mod/GonogoKerbalismUplink/client/src/science.ts",
      "mod/GonogoKerbalismUplink/client/src/science.test.ts",
      "mod/GonogoKerbalismUplink.Contract/KerbalismScienceExt.cs",
      "mod/GonogoKerbalismUplink.Tests/ScienceExtensionWireTests.cs",
      // -- contract/SDK layer --
      "mod/Sitrep.Contract/ContractVersion.cs",
      "mod/Sitrep.Contract/UplinkContract.cs",
      /*
       * ScanPayloads.cs and the two sitrep-sdk generated files (topic-map.ts,
       * units.ts) were REMOVED from this bucket: the SCANsat
       * relocation (uplink-types-out-of-core plan, fourth step) moved all five
       * Scan* payload types into GonogoScansatUplink.Contract, which deleted the
       * source file outright and left both generated artifacts with no scansat
       * key at all. ContractVersion.cs stays: it carries the relocation's
       * PROVENANCE prose (the Major 8 -> 9 entry), which is exactly what
       * the permanent bucket is for.
       * topics.test-d.ts stays too, but for the opposite reason to before: it no
       * longer type-asserts any scansat Topic (that proof moved inline into
       * mod/GonogoScansatUplink/client/src/topics.ts alongside
       * `scansat.available`'s). What matches now is the comment recording WHY the
       * assertion left. (topics.ts and topics.test.ts were REMOVED from this
       * bucket: the bare-primitive fix scrubbed their scansat mentions.)
       */
      "mod/sitrep-sdk/src/topics.test-d.ts",
      /*
       * units.ts (the hand-written accessor, not the generated map): its
       * registerTypeUnits doc comment names scansat.scanningVessels as the case
       * that forced a TYPE-keyed runtime registry alongside the Topic-keyed one.
       * The three earlier relocations moved flat payloads, so a topic-scoped unit
       * map was sufficient; this one nests (sensors: ScanSensorEntry[],
       * trackColor: ScanTrackColor) and wrapTopicPayload resolves a nested shape
       * by TYPE NAME, so the registry needed the second half. Prose in a
       * mod-agnostic file explaining a general mechanism, nothing
       * scansat-specific is imported.
       */
      "mod/sitrep-sdk/src/units.ts",
      /*
       * scansat-coverage-roundtrip.test.tsx: the app-level MSW acceptance gate
       * for the dynamic-topic fix: drives the real client stack and
       * asserts the mod's canonical scansat.coverage.<body>.<typeBit> string surfaces
       * to the widget. A new acceptance test naming the canonical wire string; no
       * product-code coupling.
       */
      "packages/app/src/__tests__/scansat-coverage-roundtrip.test.tsx",
      /*
       * The host retry-recovery regression + its test uplink name scansat as the
       * concrete case (a sampler disabled by an early-tick throw must re-run). Tests.
       */
      "mod/Sitrep.Host.IntegrationTests/ChannelEngineTests.cs",
      "mod/Sitrep.Host.IntegrationTests/TestUplinks.cs",
      "mod/Sitrep.Host.Tests/SampledSourceTests.cs",
      // RevealGateTests.cs: the reseed/late-subscriber regression tests describe the
      // SCANsat coverage shape (delayed dynamic per-(body,type)) in comments. Tests.
      "mod/Sitrep.Host.IntegrationTests/RevealGateTests.cs",
      /*
       * GonogoDevStampScan.cs: the Deck-only dev tool that stamps SCANsat coverage
       * for testing (reflects into SCANsat's API). Dev tooling, never shipped.
       */
      "mod/GonogoDevTools/GonogoDevStampScan.cs",
      /*
       * slots.ts's header comment explains why scansat's OWN Scanning
       * slots ("scanning.sections"/".badges") are deliberately NOT
       * centrally mirrored here (would need the sdk leaf to import from an
       * Uplink client package: the same turbo `^build` cycle the whole
       * file's mirroring approach exists to avoid). Comment-only; nothing
       * scansat-specific is imported or re-exported.
       */
      "mod/sitrep-sdk/src/api/slots.ts",
      "mod/sitrep-sdk/src/default-carried-topics.ts",

      // -- TEST-only --

      /*
       * UplinkContractOwnershipTests.cs: the mod-side relocation-ownership
       * ratchet. Registers a "scansat"
       * token so no Scan* wire type may return to Sitrep.Contract. A ratchet
       * inventory naming the mods it guards, same class as the kerbcast/
       * mechjeb/avionics entries on the same file; nothing is imported.
       */
      "mod/Sitrep.Core.Tests/UplinkContractOwnershipTests.cs",
      "mod/Sitrep.Host.IntegrationTests/FoundationChannelsEndToEndTests.cs",
      "packages/sitrep-client/src/map-topic.test.ts",

      // -- Cross-mod / doc-comment-only mentions --
      "mod/Gonogo.KSP/CommsCoreUplink.cs",
      "mod/Gonogo.KSP/SystemUplink.cs",
      "mod/GonogoDevTools/GonogoDevAutoLoad.cs",
      "mod/Sitrep.Host/ChannelEngine.cs",
      /*
       * main.tsx was here: first for a static `@ksp-gonogo/gonogo-scansat-uplink`
       * import, then for a
       * `registerScansatAndRender` function name and doc comments naming the
       * three ids it booted. That function became
       * `bootUplinksAndRender` and the prose went with the id list it
       * described, stale, ratcheted off.
       */
      /*
       * `CoverageMaskStore.ts` was here, and is gone entirely rather than moved:
       * the store went into `@ksp-gonogo/sitrep-sdk`, and the sdk
       * is the leaf every Uplink depends on, so it cannot name one at all, not
       * even in prose. Its three remaining doc mentions (the historical motivator
       * for the migration wipe) now say "a coverage source" instead, which is
       * what the code has actually meant since scanType became an opaque
       * `layerId` at v2→v3. That also settles the ratchet-hardening design doc's
       * Part 2.3 example, which cited "FogMaskStore.ts's SCANType import" (that
       * file's name before the fog-to-coverage rename) as the textbook
       * domain-debt case: the import had already gone, and now the file has too.
       * G2 TrueNow-allowlist ratchet (task 4) names ScansatUplink.cs in a
       * justification comment while inventorying every TrueNow declaration
       * in mod/: doc-mention only, same class as CommsCoreUplink.cs above.
       */
      "packages/core/src/truenow-allowlist.test.ts",
      // styleguide.test.ts: the raw-hex ratchet, whose scan roots now cover
      // mod/*/client/src. Its ALLOWED_PATHS names the ScanSat Minimap by path,
      // for the same canvas-2D `fillStyle` reason the packages/ copy of that
      // widget is already allowed for (fillStyle takes a colour string, not a
      // var()). A path string in a ratchet inventory, same class as
      // truenow-allowlist.test.ts above; nothing is imported.
      "packages/core/src/styleguide.test.ts",
      /*
       * -- Uplink LOADER: the loader's unit test uses
       * scansat as its example Uplink (TEST-only). The loader module itself
       * (loader.ts) is generic and names no mod. flag.ts and flag.test.ts were
       * here for the shipped enabled-id list and the test asserting its
       * contents; the list was deleted, stale, ratcheted off.
       */
      "packages/app/src/uplinks/loader.test.ts",
      /*
       * useLateTelemetrySubscribe: scansat's coverage sync is the
       * motivating call site for the new hook (a runtime-templated topic,
       * `scansat.mask.<body>.<scanType>`, that has no fixed `TopicId` member),
       * so its doc comments name scansat as the example: same "illustrative,
       * zero coupling" shape as augments.test.tsx above. Neither file imports
       * anything from the scansat Uplink.
       */
      "packages/sitrep-client/src/use-late-telemetry-subscribe.test.tsx",
      "mod/sitrep-sdk/src/spine/use-late-telemetry-subscribe.ts",
      /*
       * Breaking Ground uplink extraction: the new bundled
       * uplink's doc comments and its client package's scaffolding name
       * GonogoScansatUplink/client as the structural template they were
       * built from ("mirroring GonogoScansatUplink/client's structure").
       * Doc mentions + boilerplate config only, nothing imports from the
       * scansat Uplink.
       */
      "mod/Gonogo.KSP/BreakingGroundUplink.cs",
      "mod/GonogoBreakingGroundUplink/client/scripts/widgets.ts",
    ],
  },

  // === kos: no owning dir. Every entry below names the mod without coupling to it.
  kos: {
    domainDebt: [],
    permanent: [
      // prose: a note about kOS's xterm.css being the stylesheet case that forced style folding.
      "packages/app/uplink-bundle.ts",
      // data: `command: "kos.run"`, a wire command id in a recorded scene.
      "packages/components/scripts/render-systemview-traffic-video.ts",
      // prose: two notes using the kOS terminal as the worked example of a blank render and of a stylesheet that must reach the page.
      "packages/components/scripts/widgetRenderHarness.ts",
      // The declaration-reachability ratchet's debt list: an inventory of
      // declared Topics/commands with no client consumer, so it names the wire
      // ids of every Uplink that has one. Inventory, not coupling: nothing here
      // imports or renders anything of the Uplink's, and the list shrinks to
      // zero as each consumer is written.
      "packages/core/src/declaration-reachability.allowlist.ts",
      /*
       * -- CARRIED CONTRACT PROSE: the generated contract now
       * carries the C# doc comments it is generated from, and a wire type
       * describes what an ELECTED backend puts in it. Here, `vessel.control`'s
       * throttle note says a kOS-driven throttle can genuinely read above 1,
       * which is why the field is not clamped upstream. Text only, in a
       * generated file, and naming the backend IS the fact being stated rather
       * than a dependency on it, so this is the same class as the doc-mention
       * citations already here.
       */
      "mod/sitrep-sdk/src/__generated__/contract.ts",
      /*
       * -- DYNAMIC-NAMESPACE ROUTING: `mapTopic` identity-maps the
       * per-body scansat namespaces and the kOS compute namespace, because both
       * materialise their Topics per subject at runtime and so appear in no
       * generated list. A pattern is the only thing that can vouch for such a
       * key, and the pattern has to live where the routing does. Permanent: a
       * dynamic namespace can never be enumerated into the SDK's generated map.
       */
      "mod/sitrep-sdk/src/spine/map-topic.ts",
      /*
       * -- CATALOGUE ABSENCE INVENTORY: the pinned list of carried
       * Topics the topic-field catalogue can describe nothing about names each
       * Uplink Topic that has none, so a Topic arriving unannotated is a test
       * failure rather than a silent absence from every picker in the app.
       * Permanent, not debt: it is a ratchet inventory of TOPIC NAMES and holds
       * no code coupling, and the whole point of pinning it is that the names
       * are written down rather than derived.
       */
      "packages/data/src/schema/topicFieldCatalog.test.ts",
      // -- new test (Plan 3): a kOS-terminal-SHAPED keyframe diff-stream fixture
      // (the shared-vantage multi-client catch-up test). A text-only mention of
      // "kos" in a fixture comment/shape name, no code coupling to the kOS Uplink.
      "mod/Sitrep.Host.IntegrationTests/SharedVantageCatchUpTests.cs",
      /*
       * -- contract/SDK layer. All eleven Kos* types live in
       * GonogoKosUplink.Contract, not Sitrep.Contract. ContractVersion.cs is
       * prose only: its Major/Minor history records what moved and when, for
       * a token core names in history and nowhere else.
       */
      "mod/Sitrep.Contract/ContractVersion.cs",
      "mod/Sitrep.Contract/UplinkContract.cs",
      /*
       * Engine sticky-reveal integration test: the diff-channel keyframe-retention
       * feature is generic engine behaviour, but its canonical test case is the kOS
       * terminal, so the test names KosTerminalFrame as the concrete diff-channel
       * example. Engine test, not engine shipping code, the boundary holds.
       */
      "mod/Sitrep.Host.IntegrationTests/ChannelEngineTests.cs",
      // pending-uplink contract: its Command field doc-comment gives
      // `kos.run` as the example wire command name, doc-mention only.
      "mod/Sitrep.Contract/UplinkPending.cs",
      /*
       * The three generated SDK files (contract.ts / topic-map.ts / units.ts)
       * used to sit here too, because core's codegen reflected the Kos* types
       * out of Sitrep.Contract and emitted them. It does not any more: the
       * relocation moved them to this Uplink's own
       * client/src/__generated__/, so core's generated output names no kOS
       * type at all and the ratchet demanded these three lines go. Nothing was
       * fixed in those files; the input to the codegen changed.
       * topics.test-d.ts / topics.test.ts / topics.ts stay in the kos bucket: each
       * still names a kos.* dynamic namespace or a Kos-prefixed contract type
       * (`kos.compute.*`, `kos.processors`, `KosProcessorInfo`) as a generic
       * example. Their scansat/kerbcast mentions were scrubbed by the
       * bare-primitive fix, so they left those two buckets, but the
       * kos references are legitimate and remain.
       */
      "mod/sitrep-sdk/src/topics.test-d.ts",
      "mod/sitrep-sdk/src/topics.test.ts",
      "mod/sitrep-sdk/src/topics.ts",
      /*
       * topic-cs-sync.test.ts: the C#↔runtime-registry sync gate imports the
       * Uplink clients so registration fires, then asserts the registry union
       * matches the C#-declared Topics. A test importing the clients; no
       * product-code coupling.
       */
      "packages/app/src/__tests__/topic-cs-sync.test.ts",
      /*
       * mod/sitrep-sdk/src/api/api-shape.gate.test.ts stays: it uses "kos" as
       * an example dataSourceId in a generic `useTelemetry("kos", "k")`
       * assertion, unrelated to the (since-removed) registerKosScript/SPI
       * mirrors this file used to also guard.
       */
      "mod/sitrep-sdk/src/api/api-shape.gate.test.ts",
      /*
       * dispatch()'s label doc-comment cites `kos.keystroke` as the example
       * line-mode command whose composed text becomes the queue label,
       * comment-only, no kOS coupling in the client spine.
       */
      "mod/sitrep-sdk/src/spine/client.ts",
      /*
       * command-delay.ts's doc-comment cites the kOS terminal's original
       * isPastReach judder fix as the precedent latchForward generalizes;
       * its test fixture uses "kos.run"/"kos/7" as sample command/topic
       * strings (same class as PeerTransport.test.ts's sample strings
       * below): the delayed-command primitives themselves are mod-
       * agnostic and import nothing kOS-specific.
       */
      "mod/sitrep-sdk/src/command-delay.ts",
      "mod/sitrep-sdk/src/command-delay.test.ts",
      /*
       * use-route-commands.ts's doc-comment cites the kOS terminal's
       * original hand-rolled strip as the precedent it generalizes; its
       * test fixture uses "kos/7"/"kos.run" as sample topic/command
       * strings. Same class as command-delay.ts above: mod-agnostic,
       * imports nothing kOS-specific.
       */
      "mod/sitrep-sdk/src/spine/use-route-commands.ts",
      "packages/sitrep-client/src/use-route-commands.test.tsx",
      /*
       * connectivity-history.ts's doc-comment cites the kOS terminal's own
       * noPath gate convention ("undefined/unknown = connected") as the
       * precedent its own unknown-history default follows: doc-mention
       * only, no kOS import or coupling.
       */
      "mod/sitrep-sdk/src/spine/connectivity-history.ts",
      /*
       * -- comment/doc + pending-topic mentions (no kOS coupling) --
       * CameraFeed's doc-comment references `KosTerminal`'s command-response
       * pattern; Comms.cs's CommsLink doc mentions the kOS terminal reading
       * comms.link. The FleetComms and SystemView entries that used to sit
       * here carried "kos.run" as a sample pending-command string in a
       * fixture; those fixtures now use a vanilla vessel command, since what
       * they exercise is the generic `system.uplink.pending` -> route pulse
       * wiring and never anything kOS-shaped. Ratcheted off.
       */
      "mod/Sitrep.Contract/Comms.cs",
      "mod/sitrep-sdk/src/default-carried-topics.ts",
      "packages/sitrep-client/src/map-topic.test.ts",

      /*
       * -- TEST-only --
       * pending-uplink wire tests use "kos.run" as the sample command name;
       * CommsGateCommandTests's doc-comment cites a kOS keystroke as the
       * canonical delayed command gated during a blackout, test/doc only.
       */
      "mod/Sitrep.Core.Tests/CommandRequestLabelWireTests.cs",
      "mod/Sitrep.Core.Tests/CourierReliableOrderedDeliveryTests.cs",
      "mod/Sitrep.Core.Tests/PendingUplinkQueueWireTests.cs",
      "mod/Sitrep.Host.IntegrationTests/CommsGateCommandTests.cs",
      // KosProcessorsWireTests.cs exercises the kos.processors wire SHAPE:
      // a contract-level wire test, same class as CommandRequestLabelWireTests.
      "mod/Sitrep.Host.IntegrationTests/KosProcessorsWireTests.cs",
      "mod/Sitrep.Host.Tests/UplinkDiscoveryTests.cs",
      "mod/sitrep-sdk/src/generated.test.ts",
      /*
       * kos-execute-tunnel.test.ts has zero real kos coupling, it only uses
       * "kos" as a generic Uplink-handle id while exercising app-owned PeerJS
       * relay machinery (kos migration Task 8: moved into the kos
       * package and back out once that became clear). Stays in
       * packages/app/src/__tests__ where this entry already covers it.
       */
      "packages/app/src/__tests__/kos-execute-tunnel.test.ts",
      /*
       * peer label/topic tunnel tests use "kos.run" as the sample command and
       * cite a kOS command in a doc-comment, test/doc-only, no coupling.
       */
      "packages/app/src/__tests__/sitrep-command-label-topic-tunnel.test.ts",
      /*
       * SettingsModal.test.tsx uses "kos" purely as a generic fixture
       * data-source id ("kOS" display label) exercising the generic Data
       * Sources panel: no real kOS import.
       */
      "packages/app/src/settings/SettingsModal.test.tsx",
      /*
       * PeerTransport.test.ts uses "kos.run" / "kos/cpu-1" as sample
       * command/topic strings exercising generic PeerJS transport framing,
       * no real kOS import.
       */
      "packages/app/src/telemetry/PeerTransport.test.ts",
      /*
       * uplink-health-render-gating feature: uplink-health.test.ts
       * and useUplinkHealthFor.test.tsx use "kos.terminal."/"kos.processors" as
       * sample owned-prefix/channel strings exercising the generic
       * longest-prefix-match resolver, same "topic string, no real kOS import"
       * category as PeerTransport.test.ts above. RequiresGuard.test.tsx was
       * here too and now drives the same render-gate off an invented Uplink id,
       * which is the honest fixture for a gate that special-cases nobody.
       */
      "packages/core/src/hooks/useUplinkHealthFor.test.tsx",
      "packages/sitrep-client/src/uplink-health.test.ts",
      /*
       * BufferedDataSource.test.ts was here alongside the file it tests; it moved
       * to the sdk with it and its `kos.compute.*` fixture keys became
       * `compute.*`, since what they assert is per-feeder namespacing rather than
       * any one Uplink. Ratcheted off.
       * useDataSchema.test.tsx tests the doc-comment-only file of the same name
       * below, same subject.
       */
      "packages/data/src/hooks/useDataSchema.test.tsx",

      /*
       * `registry.ts` was here for `clearRegistry`'s doc, which explained itself
       * by naming what it does NOT clear: the kOS script registry. The registry
       * moved into `@ksp-gonogo/sitrep-sdk` and the sdk is the leaf
       * every Uplink depends on, so it cannot name one at all, not even in prose.
       * The doc now states the general rule instead (it never reaches a registry
       * an Uplink owns), which is what it always meant.
       */

      /*
       * -- Doc/comment-only mentions elsewhere (kOS is a documented Key
       * Design Constraint: "optional, not a hard dependency": so it is
       * named in prose across many otherwise-unrelated files) --
       * dev-only comms override: its doc-comment cites `kos.keystroke` as an
       * example command to gate during a blackout, comment-only.
       */
      "mod/Gonogo.KSP/DevCommsOverride.cs",
      "mod/Gonogo.KSP/VesselUplink.cs",
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
      /*
       * main.tsx was here (`import "@ksp-gonogo/gonogo-kos-uplink"`, a sanctioned self-
       * registration import). That static
       * import was removed: kos now always loads through the runtime loader, and not
       * even a shipped id list names it (no
       * "kOS"/"Kos*"/"kos.*" distinctive-form text left in main.tsx itself):
       * stale, ratcheted off.
       * CrewStatus/index.tsx was here (a doc-comment aside claiming gonogo
       * "doesn't support Kerbalism because of the known kOS sensor
       * incompatibility"). Kerbalism-fixture-truth's crew-rules verification
       * pass found that claim stale: the widget already reads real Kerbalism
       * survival data off `kerbalism.crew`/`kerbalism.lifesupport`: and
       * rewrote the comment to describe the actual Kerbalism integration
       * instead, dropping the only "kOS" text in the file, stale, ratcheted off.
       * ManeuverPlanner/index.tsx and its test were here: both cited kOS's
       * Node.cs as corroboration for KSP's node-local (radialOut, normal,
       * prograde) axis order. That fact is KSP's own and this repo already
       * establishes it by decompile where the assignment happens
       * (`KspVesselActuator.AddManeuverNode`), so the citation was rebased onto
       * the primary source and both entries ratcheted off.
       */
      /*
       * BufferedDataSource.ts / flightDetector.ts were here (prose asides about a
       * kOS-sourced `vesselUid` and the kOS compute fanout as an example feeder).
       * Both moved into `@ksp-gonogo/sitrep-sdk`, and the sdk is the
       * leaf every Uplink depends on, so it cannot name one even in prose. They now
       * describe the general shape they always meant ("another feeder", "an
       * authoritative vesselUid from the vessel"), so both ratcheted off.
       * useDataSchema.ts was here for a forward-looking aside naming the kOS
       * datastream as the thing that would add keys after connect. The caveat
       * now describes any source that grows keys dynamically, naming no Uplink,
       * so this ratcheted off.
       */
      "mod/sitrep-sdk/src/spine/replay-session.tsx",
      /*
       * types.ts was here for `FlightRecord.vesselUid`'s "arrives from kOS" aside.
       * The flight types moved to the sdk leaf with `BufferedDataSource` and the
       * aside now names the vessel rather than the Uplink that reads it, so this
       * ratcheted off; what stayed behind is the `declare module` block, which
       * names nothing.
       * packages/kerbcast/src/index.ts was here (an "alongside the legacy source /
       * kOS / etc." aside in its header). That package is now
       * mod/GonogoKerbcastUplink/client, and its rewritten header no longer names
       * another Uplink at all: stale twice over, so it ratcheted off.
       */
      "packages/relay/src/bootstrapConfig.ts",
      "packages/sitrep-client/src/use-stream-status.ts",
      "packages/ui/src/VersionMismatchBanner.tsx",
    ],
  },

  /*
   * === realantennas: owning dir mod/GonogoRealAntennasUplink/. The
   * cleanest of the four: zero HARD violations per the audit, so zero
   * domainDebt entries.
   */
  realantennas: {
    domainDebt: [],
    permanent: [
      /*
       * -- PROSE, both of them. The visibility factory names RA to
       * say WHY its occluder walk cannot assume a stock `CommNetHome`:
       * `RACommNetHome` derives from it, so the scene search finds both. The
       * dispatch test names RA because it models RA's routing SHAPE: stock's
       * `FindPath` is un-overridden while `FindClosestWhere` is, which is the
       * exact asymmetry the test exists to pin after it produced a live
       * wrong-numbers bug in centre-to-centre delay.
       *
       * Neither reaches the Uplink: no import, no type, no topic. A test that
       * could not name the backend it models would be describing nothing, and
       * the comment is the whole point of the other.
       */
      "mod/Gonogo.KSP/SilenceTracking/KspVisibilityGeometryFactory.cs",
      "mod/Gonogo.KSP.Tests/Comms/RouteBackendDispatchTests.cs",
      /*
       * -- CITED EVIDENCE: the command-centre reachability rule
       * asks two questions, the node's stock antenna budget and whether any
       * part carries an `ICommAntenna`, and the second only earns its place
       * because a network that replaces stock's range model zeroes the first
       * for every vessel in the game. This mod is the one that does it, so
       * naming it is what makes the claim checkable against a shipped
       * assembly; left generic, the part walk reads as belt-and-braces and
       * invites deletion. Text only, in a doc comment: the rule references no
       * type of the Uplink's, compiles without it, and behaves identically
       * whether it is installed or not.
       */
      "mod/Gonogo.KSP/CommandCentres/CommandCentreReach.cs",
      /*
       * -- CARRIED CONTRACT PROSE: the generated contract now
       * carries the C# doc comments it is generated from, and a wire type
       * describes what an ELECTED backend puts in it. Here, `CommsHop` says
       * the per-hop band rate rides the RealAntennas Uplink's own channel
       * rather than this shared shape. Text only, in a generated file, and
       * naming the backend IS the fact being stated rather than a dependency
       * on it, so this is the same class as the doc-mention citations already
       * here.
       */
      "mod/sitrep-sdk/src/__generated__/contract.ts",
      /*
       * -- the client-side read of comms.degrade. One prose
       * sentence names the two shipped backends, and it is the sentence that
       * tells an author why to use this helper instead of
       * `1 - comms.signal.strength`: that field is a range fraction on one
       * install and rate-ladder headroom on the other, so the obvious
       * arithmetic is a different quality curve per save with nothing on the
       * wire saying so. Written generically it reads as caution rather than as
       * the concrete trap it is. Text only: the helper treats `modelId` as an
       * opaque string and has no RA type, import or branch, and its own test
       * deliberately uses made-up ids so nothing here names a shipped backend's.
       */
      "mod/sitrep-sdk/src/comms-degrade.ts",
      /*
       * The install-profile harness names RealAntennas as a roster entry, because
       * an Uplink that is installed while the mod it wraps is not is what gives
       * `RequiresGuard` a named empty state to show. A wire value off
       * `system.uplinks`; see the matching entries under `testflight`.
       */
      "packages/components/src/FleetReliability/install-profiles.test.tsx",
      /*
       * -- Uplink ISOLATION ratchet inventory: the inward guard's
       * debt list is keyed by file path, so it necessarily names every Uplink
       * directory. Ratchet-inventory file, the case this bucket documents.
       */
      "packages/core/src/uplink-isolation.allowlist.ts",
      // -- Judgment calls, all resolved clean --
      "mod/Gonogo.KSP/CommNetBackend.cs",
      /*
       * -- stock's own link GRADING, carved out of CommNetBackend.cs
       * the same way CommNetOcclusion.cs and CommNetReach.cs already are. The
       * judgement is on the seam: ICommsBackend.DegradeModel, each backend
       * declaring its own rule, exactly as reach and occlusion do, so core
       * computes nothing here for anybody. What names RA is one paragraph
       * explaining why the identical EXPRESSION is not shared with the other
       * backend's rule: the two read the same field, which holds a range
       * fraction here and rate-ladder headroom there, so one shared helper would
       * publish two quantities under one name and re-create the exact ambiguity
       * comms.degrade exists to remove. That is a warning against a future
       * deduplication, and it only works if it says which two rules. Comment
       * only, no RA type or reference.
       */
      "mod/Gonogo.KSP/CommNetDegrade.cs",
      "mod/Gonogo.KSP/CommsCoreUplink.cs",
      /*
       * dev-only comms override + its DevTools driver both name the stock
       * comms backends ("CommNet / RealAntennas") in doc-comments explaining
       * what they force: comment-only, no RA coupling.
       */
      "mod/Gonogo.KSP/DevCommsOverride.cs",
      /*
       * the node-to-node path walk names RealAntennas in a doc comment to record
       * WHY stock's pathfinder can be trusted over RA's links: RA overrides link
       * construction only, never the solver. Comment-only, no RA coupling.
       */
      "mod/Gonogo.KSP/FleetCommsReader.cs",
      "mod/Gonogo.KSP/GonogoAddon.cs",
      "mod/GonogoDevTools/GonogoDevForceComms.cs",
      /*
       * GonogoDevAntenna.cs upgrades a test craft's antenna at runtime so that
       * CommNet genuinely solves a route home, which is the only way to observe
       * the currency-delay REVEAL: an early-career probe's 1 W UHF antenna
       * closes no link, and the currency arm reads vessel.connection.ControlPath
       * directly, so a faked route would measure nothing. It is DEV-ONLY, never
       * shipped, and reaches RealAntennas purely by reflection with no
       * compile-time reference or Uplink dependency, exactly as
       * GonogoDevKerbalismScience.cs does for Kerbalism. Permanent rather than
       * debt for the same reason as that one: a dev-only rig tool does not
       * belong inside a shipped Uplink.
       */
      "mod/GonogoDevTools/GonogoDevAntenna.cs",
      /*
       * GonogoDevAntennaTarget.cs is the same shape and is here for the same
       * reason. It points one antenna at a named place and then reads the
       * BURST-JOB MIRROR the link solver actually consumes, because RealAntennas
       * refreshes an antenna's pointing direction on every rebuild but its
       * `isTracking` flag only when the precompute is re-initialised: a dish
       * with no target counts as perfectly aimed, so a target that does not
       * reach the mirror leaves the property, the part menu and the map cone all
       * saying "aimed" while the solver goes on charging no pointing loss.
       * Measured live, that window stays open indefinitely without
       * an explicit invalidate. Nothing but a running game can show it, and
       * nothing inside the Uplink could read the mirror without shipping the
       * reflection in a released assembly. DEV-ONLY, never shipped, reflection
       * only, no compile-time reference.
       */
      "mod/GonogoDevTools/GonogoDevAntennaTarget.cs",
      /*
       * AntennaProbeVerdictsTests.cs covers that same dev tool's report of
       * whether its boost is still standing: the boost is a set of KSPField
       * writes on a live module, so a vessel reload silently reverts it, and a
       * lapsed boost is indistinguishable from one that never worked. The
       * assertions are over plain strings and the tool's own shipped source
       * text; RealAntennas is named only in comments explaining WHY the check
       * compares the recalculated object and not just the module fields, since
       * that library's Precompute reads the former. Comment-only, no coupling,
       * and permanent for the same reason as the tool it covers.
       */
      "mod/Gonogo.KSP.Tests/DevTools/AntennaProbeVerdictsTests.cs",
      "mod/Sitrep.Contract/UplinkContract.cs",
      "mod/Sitrep.Host/ChannelEngine.cs",
      "mod/Sitrep.Host/Comms/CommsElection.cs",
      "mod/Sitrep.Host/Comms/SignalDelay.cs",
      /*
       * -- the no-comms-model rule: it wraps whichever backend the
       * election picked rather than checking inside the stock one, and the
       * reason is that KSP's CommNet difficulty option kills a replacement
       * network as surely as it kills stock's. Named, because left generic that
       * reads as speculative future-proofing: this mod is the one shipped
       * backend it is true of, and its own backend carries the same
       * "no connection to a command source" line the wrapper exists to stop
       * emitting. Prose only, no RA type or reference, same category as
       * CommsElection.cs beside it.
       */
      "mod/Sitrep.Host/Comms/CommsModelPolicy.cs",
      /*
       * The action-groups election is a deliberate copy of the comms precedent
       * above, and its doc-comment says so: it cites GonogoRealAntennasUplink as
       * the worked example of a provider elected over the stock backend that
       * ships no client code of its own. Prose only: no RA type, reference or
       * coupling; same category as Comms/CommsElection.cs itself.
       */
      "mod/Sitrep.Host/ActionGroups/ActionGroupsElection.cs",
      /*
       * Kernel provider-election tests, both halves of the golden-fixture pair.
       * They use "realantennas" as the id of a losing/failing provider because
       * the exclusive "comms" election is the real-world shape the kernel
       * exists to arbitrate, and a test that elects "provider-a" over
       * "provider-b" documents nothing. Fixture strings only: no RA type,
       * reference or dependency.
       */
      "mod/Sitrep.Core.Tests/KernelFactoryFailureTests.cs",
      "mod/sitrep-kernel/src/registry.test.ts",
      /*
       * CommSignal's `comm-signal.hop-rates` slot declaration, which names the
       * contributor's SOURCE Topic in its `topics` member exactly as ShipMap's
       * `ship-map.part-meters` names `kerbalism.profile`. Declaration only: the
       * widget's code knows the slot id and nothing else, and a path with no
       * contribution simply renders no bitrate.
       */
      /*
       * G2 TrueNow-allowlist ratchet (task 4) names RealAntennasUplink.cs in
       * a justification comment while inventorying every TrueNow
       * declaration in mod/: doc-mention only.
       */
      "packages/core/src/truenow-allowlist.test.ts",
      /*
       * -- the occlusion-model seam: three prose mentions --
       * All three name RealAntennas because the seam exists to record that the
       * two comms backends occlude at DIFFERENT radii (stock scales the body
       * down, RA takes it bare), and a comment that omitted the disagreement
       * would be describing the wrong problem. The contract declares the shape
       * both backends fill, stock's own rule file cites RA as the contrast, and
       * the builder records why no backend walks the body list itself: prose
       * only, no RA type or reference, same category as CommsElection.cs.
       */
      "mod/Sitrep.Contract/CommsOcclusion.cs",
      "mod/Gonogo.KSP/CommNetOcclusion.cs",
      "mod/Sitrep.Host/Comms/CommsOcclusionBuilder.cs",
      /*
       * -- the visibility geometry and the capture analyser built on the seam --
       * Every one of these names RealAntennas for the same reason the occlusion
       * contract above does: the two backends occlude at different radii, and
       * that disagreement is the whole reason the code exists. The geometry's
       * doc-comments cite it to explain why the occluding radius is a parameter
       * rather than a constant, and why a station standing exactly on a
       * bare-radius occluder forced the sign convention it has. The analyser's
       * tests use "RealAntennas bare radius" as a candidate LABEL, which is a
       * string a report prints so the reader can see which assumption produced a
       * number. Prose and display strings only: no RA type, reference or
       * coupling, same category as CommsElection.cs.
       */
      "mod/Sitrep.Propagation/Visibility/ChordOcclusion.cs",
      "mod/Sitrep.Propagation/Visibility/OrbitToGroundStationGeometry.cs",
      "mod/Sitrep.Propagation.Tests/Visibility/OrbitVisibilityTests.cs",
      "mod/Sitrep.CaptureAnalysis.Tests/CommandLineTests.cs",
      "mod/Sitrep.CaptureAnalysis.Tests/RealCaptureTests.cs",
      "mod/Sitrep.CaptureAnalysis.Tests/SyntheticCapture.cs",
      "mod/Sitrep.CaptureAnalysis.Tests/VerdictTests.cs",

      /*
       * -- contract/serializer/ratchet layer: PROVENANCE, no coupling --
       * The four files the relocation itself added a mention to, each the same
       * category the earlier relocations put ContractVersion.cs/RtConfig.cs in:
       * a record of what moved and when, on a comment line, with no reference
       * to a relocated type left behind.
       *   • ContractVersion.cs: the Major-bump history entry for the move.
       *   • RtConfig.cs: the note standing where the three typeof() entries were.
       *   • JsonWriter.cs: says where the three deleted serializer cases went
       *     and why core no longer needs them, which is the one thing a reader
       *     hitting the gap will want to know.
       *   • UplinkContractOwnershipTests.cs: the mod-side ownership ratchet has
       *     to NAME the token it registers, so it names this one too. Ratchet
       *     inventory, same as truenow-allowlist.test.ts below.
       */
      "mod/Sitrep.Contract/ContractVersion.cs",
      "mod/Sitrep.Contract/RtConfig.cs",
      "mod/Sitrep.Contract/Serialization/JsonWriter.cs",
      "mod/Sitrep.Core.Tests/UplinkContractOwnershipTests.cs",

      /*
       * -- Sitrep.Contract/Comms.cs, prose only --
       * The three RA-only payload types it carried moved into this Uplink's
       * own contract slice. The entry stays, and it is the clearest example in this file of
       * why a mod name in core is not automatically a boundary problem: the
       * comms family is a two-provider channel set, so the file legitimately
       * explains which backend sources what, and names one of them to do it. It
       * also documents the one field it kept for that reason
       * (CommsHop.BandRateBitsPerSec, present only under that backend but a
       * field on a SHARED type). What it no longer holds is a declaration.
       */
      "mod/Sitrep.Contract/Comms.cs",

      /*
       * -- THE SEAM'S OWN PROSE, eight files, all text-only --
       * Two comms questions came off core and onto ICommsBackend: REACH (how
       * far a link carries) and the CONTROL-PATH TERMINUS behind
       * comms.commandCentre. In both cases the reason the question cannot be
       * answered by core is a fact about ONE shipped assembly, and naming it is
       * what makes the claim checkable rather than a matter of taste. That is
       * the same argument CommandCentreReach.cs above already carries, and it
       * is load-bearing in exactly the same way: left generic, "core must not
       * apply stock's range rule here" reads as caution and invites deletion,
       * when in fact this mod zeroes both antenna power fields on every vessel
       * (RACommNetVessel.UpdateComm) so stock's rule reports zero reach for the
       * whole fleet on an install that has it.
       *
       * The contract files sit beside Comms.cs and CommsOcclusion.cs for the
       * reason Comms.cs's own entry gives at length: comms is a two-provider
       * channel set, so a contract file legitimately explains which backend
       * sources what and names one to do it. CommsBackendBase.cs additionally
       * records WHY it exists, which is that the two backends' duplicated
       * copies had drifted into two different error contracts; that history is
       * unstatable without naming both.
       *
       * The three test files are the RouteBackendDispatchTests.cs case, already
       * above: a test that models a two-backend divergence and cannot name the
       * backends is describing nothing.
       *
       * Text only, every one of them: no import, no type, no topic, and the
       * Propagation layer was deliberately left mod-agnostic rather than
       * added here (its two mentions were rewritten generic, since "a modded
       * ground network runs many stations" is the fact it actually needed).
       */
      "mod/Sitrep.Contract/CommsReach.cs",
      /*
       * -- CommsDegrade.cs is the third file of that same set, and
       * the one whose naming is most load-bearing of any of them. Its whole
       * reason to exist is that comms.signal is 0..1 and looks like the
       * quality number a consumer wants, and is not: it holds a range fraction
       * under the stock backend and rate-ladder headroom under this one, with
       * nothing on the wire to tell them apart. Written generically that reads
       * as a hypothetical, and the next author derives a quality from the raw
       * strength again, which is what the shipped camera feed does today.
       * Naming both quantities IS the argument for the channel. Text only: the
       * judgement lives on ICommsBackend.DegradeModel and each backend declares
       * its own rule, so this file computes nothing for either of them.
       */
      "mod/Sitrep.Contract/CommsDegrade.cs",
      "mod/Sitrep.Contract/CommsBackendBase.cs",
      "mod/Sitrep.Contract/CommsBackendViews.cs",
      "mod/Gonogo.KSP/CommNetReach.cs",
      "mod/Gonogo.KSP/CommandCentres/CommandCentreResolution.cs",
      "mod/Gonogo.KSP.Tests/Comms/CommNetBackendSharedShapeTests.cs",
      "mod/Gonogo.KSP.Tests/Comms/CommandCentreOffTheSeamTests.cs",
      "mod/Sitrep.Host.Tests/CommsReachSeamTests.cs",

      /*
       * sitrep-sdk contribution-slots.ts: the SDK-layer mirror of the
       * `comm-signal.hop-rates` slot names its Topic (`realantennas.hopRates`)
       * and the built-in RA contributor in prose. Contract/SDK layer, no
       * coupling: a slot's declared `topics` is a plain string literal.
       */
      "mod/sitrep-sdk/src/api/contribution-slots.ts",
      /*
       * CommsHopContractShapeTests.cs: the CommsHop ratchet's doc-comment now
       * cites `realantennas.hopRates` as where the removed per-hop rate went.
       * Ratchet-inventory doc mention only.
       */
      "mod/Sitrep.Host.Tests/CommsHopContractShapeTests.cs",

      // -- TEST-only --
      "mod/Sitrep.Core.Tests/CommsWireTests.cs",
      "mod/Sitrep.Host.IntegrationTests/FoundationChannelsEndToEndTests.cs",
      "mod/Sitrep.Host.Tests/CommsElectionTests.cs",
      /*
       * CommSignal's two slot/stream tests were here: each named RealAntennas in
       * prose as the hypothetical filler of `comm-signal.sections` /
       * `comm-signal.hop-rates`. The widget only ever knew the slot id, so the
       * prose now names the comms capability instead and both ratcheted off.
       */
    ],
  },

  /*
   * === agx: owning dir mod/GonogoActionGroupsExtendedUplink/. Every entry
   * below PRE-DATES the AGX uplink, which named action groups and left the
   * seam ready: doc-comment mentions of "Action Groups Extended (AGX)" or the
   * provider-id identifiers explaining WHY the seam is shaped the way it is,
   * not AGX coupling. No file below imports, references, or derives from
   * anything in the new owning dir. Zero domainDebt entries.
   */
  agx: {
    domainDebt: [],
    permanent: [
      /*
       * -- CARRIED CONTRACT PROSE: the generated contract now
       * carries the C# doc comments it is generated from, and a wire type
       * describes what an ELECTED backend puts in it. Here, `ActionGroupState`
       * says Action Groups Extended raises the custom-group count from ten to
       * 250, which is what makes that count a wire value. Text only, in a
       * generated file, and naming the backend IS the fact being stated rather
       * than a dependency on it, so this is the same class as the doc-mention
       * citations already here.
       */
      "mod/sitrep-sdk/src/__generated__/contract.ts",
      /*
       * -- PERMANENT-BUCKET gate: the test that freezes the
       * code-carrying subset of this file's own `permanent` lists. A gate over
       * the allowlist names Uplinks the same way the allowlist does, and its
       * worked example of a planted violation has to name a real token to be
       * a demonstration rather than a description.
       */
      "packages/core/src/uplink-permanent-code.test.ts",
      /*
       * -- Judgment calls, all doc-mention only --
       * NOTE: mod/Sitrep.Host/ActionGroups/ActionGroupsElection.cs used to sit
       * here, justified as "constant/method names ... and prose". Naming the API
       * symbols in the justification should have been the tell: a public
       * RegisterActionGroupsExtendedProvider plus two constants is code coupling,
       * which is domainDebt, not the permanent bucket this file put it in. The
       * triple has been deleted and the provider id and priority now live on the
       * uplink that owns them, so the entry is gone rather than reclassified.
       * Doc-comment explaining why the capability's Groups() list is
       * named/arbitrary-length rather than a positional bool[]: cites
       * "Action Groups Extended (AGX)" as the reason, no AGX coupling. Moved
       * out of mod/Sitrep.Host/ActionGroups/ into the contract, which is where
       * a seam an Uplink implements has to live for the Uplink to be able to
       * build against it at all.
       */
      "mod/Sitrep.Contract/ActionGroupsBackend.cs",
      /*
       * ContractVersion's migration-history doc-comment for the
       * bool[]->ActionGroupState[] change names AGX as the reason the
       * contract had to stop being positional.
       */
      "mod/Sitrep.Contract/ContractVersion.cs",
      /*
       * VesselControl.ActionGroupState's doc-comment: same "AGX needs named,
       * arbitrary-length groups" rationale for the wire type's shape.
       */
      "mod/Sitrep.Contract/VesselControl.cs",
      /*
       * VesselCommandProvider's SetActionGroup handler doc-comment: explains
       * it can no longer assume a 1..10 bound "because Action Groups Extended
       * legitimately goes to 250": prose only, no AGX type/reference.
       */
      "mod/Sitrep.Host/VesselCommandProvider.cs",
      /*
       * ActionGroupStatePayload's doc-comment, the SDK's mirror of
       * VesselControl.ActionGroupState: names AGX's player-named groups as
       * what a name can hold, prose only.
       */
      "mod/sitrep-sdk/src/spine/wire-payloads.ts",
      /*
       * f.ag<N>-beyond-10 toggle fix: actionGroupHome's
       * doc-comment explains why the write bridge is now a generic
       * `/^f\.ag(\d+)$/` rule instead of a 10-row static table, AGX assigns
       * indices up to 250, same rationale as VesselCommandProvider.cs's own
       * comment above. Prose only; no AGX type or import.
       */

      // -- TEST-only --
      // Regression-comment mirrors the VesselCommandProvider rationale above.
      "mod/Sitrep.Host.Tests/VesselCommandProviderTests.cs",
      /*
       * map-command.test.ts's new AGX-index test cites "AGX" in a doc-comment
       * (same rationale as map-command.ts above): no AGX import, just
       * exercising the generic mapCommand rule with high indices.
       */
    ],
  },
  /*
   * === mechjeb: owning dirs mod/GonogoMechJebUplink/ (incl. its client/),
   * mod/GonogoMechJebUplink.Tests, and mod/GonogoMechJebUplink.Contract (the
   * uplink-types-out-of-core pilot's own contract slice). Every
   * hit below is a comment/doc-mention or the sanctioned loader import; there
   * is no real code coupling outside the owning dirs, so domainDebt is empty.
   */
  mechjeb: {
    domainDebt: [],
    permanent: [
      /*
       * -- CARRIED CONTRACT PROSE: the generated contract now
       * carries the C# doc comments it is generated from, and a wire type
       * describes what an ELECTED backend puts in it. Here, a centre-of-mass
       * note attributes the `Vessel.CoM` construction it describes to MechJeb.
       * Text only, in a generated file, and naming the backend IS the fact
       * being stated rather than a dependency on it, so this is the same class
       * as the doc-mention citations already here.
       */
      "mod/sitrep-sdk/src/__generated__/contract.ts",
      /**
       * The panel-body ratchet's own inventory: a path-keyed debt list over every
       * widget-side `.tsx` in the repo, so it names this Uplink's widgets by
       * construction and there is nowhere else for it to live. Permanent for the
       * same reason as the lists beside it: a gate placed inside an Uplink is one
       * a third-party author could not run.
       */
      /*
       * -- CI gating ratchet: names the four Uplink test
       * projects that were in mod/Gonogo.sln and in no CI job, which is the
       * finding itself: "four projects drifted" without saying which is not
       * a usable comment. Text-only mention in a ratchet-inventory file, the
       * case this bucket documents.
       */
      "packages/core/src/ci-test-project-coverage.test.ts",
      /*
       * -- Uplink ISOLATION ratchet inventory: the inward guard's
       * debt list is keyed by file path, so it necessarily names every Uplink
       * directory. Ratchet-inventory file, the case this bucket documents.
       */
      "packages/core/src/uplink-isolation.allowlist.ts",

      /*
       * -- The mod-side ownership ratchet itself --
       * UplinkContractOwnershipTests.cs is a new xUnit test asserting
       * Sitrep.Contract carries zero non-comment "MechJeb" references: it
       * necessarily names the token it is testing FOR, in its own doc
       * comment and its RelocatedModTokens data. A ratchet naming its own
       * subject, not a boundary violation, same class as the C#
       * WirePayloadCoverageTests.cs entry a few lines below.
       */
      "mod/Sitrep.Core.Tests/UplinkContractOwnershipTests.cs",

      /*
       * -- ACTIVE-VESSEL scan inventory: core reports the craft an
       * EVA kerbal stepped out of, and this scan holds every Uplink to resolving
       * that through the activeVessel capability rather than off FlightGlobals.
       * Its shrink-only debt has one entry and a debt list has to name its
       * subject. Everything else in the file is discovery-driven: the walk is
       * checked against the Uplinks UplinkProjects finds rather than against
       * filenames, precisely so this stays the only mention. The entry goes when
       * those three writes are routed, which needs a live flight rather than a
       * code change, and the reasoning for the hold lives in that Uplink's own
       * doc comment rather than here.
       */
      "mod/Sitrep.Core.Tests/UplinkActiveVesselScopeTests.cs",

      /*
       * -- Widget-name mentions in doc comments, zero code coupling --
       * "ManeuverPlanner, TargetPicker, RoboticsConsole, MechJeb, Navball,"
       * lists sibling command widgets this shared list-item helper serves.
       */
      "packages/ui-kit/src/CommandDelay/toInFlightListItems.ts",
      /*
       * Porkchop heatmap doc-comment: "(MechJeb/alexmoon style)" cites the
       * familiar visual convention it mirrors, not a dependency.
       */
      /*
       * ActionGroup/stream.test.tsx was here: its doc-comment listed three
       * sibling vessel command widgets sharing its dispatch pattern, MechJeb
       * among them, and all three had since moved into Uplinks. It now states
       * the pattern without naming them, stale, ratcheted off.
       */
      /*
       * RoboticsConsole/RotorTachometer doc-comments cite MechJeb as a
       * precedent for this widget's shape; no MechJeb import or coupling.
       */
      "mod/GonogoBreakingGroundUplink/client/src/RoboticsConsole/index.tsx",
      "mod/GonogoBreakingGroundUplink/client/src/RotorTachometer/index.tsx",

      /*
       * -- Core-mod doc-comments citing MechJeb2 as prior art or a use case,
       * zero coupling --
       */
      "mod/Gonogo.KSP/KspHost.cs",
      "mod/Sitrep.Contract/VesselAttitude.cs",

      /*
       * Two GonogoAvionicsUplink files sat here, AvionicsRtConfig.cs and its
       * client's generated-value-import.test.ts, each naming the pilot as prior
       * art. Both left with that Uplink when it moved to the gonogo-uplinks
       * repo. The Kerbcast entry below is the same shape and stays.
       */

      /*
       * -- The relocation's own provenance record --
       * ContractVersion.cs's Minor-history doc-comment records the original
       * add AND the later relocation of MechJebAscentArgs/MechJebNoArgs out
       * of this assembly: see ContractVersion.Minor's doc comment. Prose
       * only, the types themselves no longer live here.
       */
      "mod/Sitrep.Contract/ContractVersion.cs",
      /*
       * RtConfig.cs's wirePayloadTypes comment records where the two types
       * went (GonogoMechJebUplink.Contract) and EmitTopicMap/EmitUnitMap's
       * doc comments name MechJebRtConfig as the first caller of the
       * assembly-generic overloads: provenance/seam documentation, no type
       * reference.
       */
      "mod/Sitrep.Contract/RtConfig.cs",
      /*
       * SitrepUnitAttribute.cs's Kilometres doc-comment explains why that
       * token exists by citing MechJebAscentArgs.TargetAltitudeKm as the
       * originating field: prose only.
       */
      "mod/Sitrep.Contract/SitrepUnitAttribute.cs",
    ],
  },
  /*
   * === avionics: owning dirs mod/GonogoRp1Uplink/ (incl. its client/),
   * mod/GonogoRp1Uplink.Tests and mod/GonogoRp1Uplink.Contract.
   *
   * RP-1's,. Avionics was never a separate mod, only a
   * separate Uplink reading the same RP-1 assembly, and the standalone
   * GonogoAvionicsUplink was deleted with its capture folded into
   * GonogoRp1Uplink as `rp1.avionics`. Five entries went with it: they were
   * RP-1 files carrying doc prose about the OTHER Uplink, and prose about
   * a sibling becomes prose about yourself once the two are one.
   *
   * Every hit below is a comment/doc-mention, a sanctioned loader import, or a
   * fixture topic-id string; there is no real code coupling outside the owning
   * dirs, so domainDebt is empty.
   */
  avionics: {
    domainDebt: [],
    permanent: [
      /*
       * The isolation ratchet's forbidden-package list, which keeps this
       * Uplink's package name after its departure for the gonogo-uplinks repo
       *. That rule may widen and never narrow, so the name
       * outlives the code and the next Uplink to import it is still caught.
       * The name as DATA in a ratchet inventory, not a reference to any file
       * of the departed Uplink's.
       */
      "packages/core/src/uplink-isolation.allowlist.ts",
      // prose: the debt list's header names which Uplink owns the two worst bundles.
      "packages/app/scripts/minsize-debt.ts",
      /**
       * The panel-body ratchet's own inventory: a path-keyed debt list over every
       * widget-side `.tsx` in the repo, so it names this Uplink's widgets by
       * construction and there is nowhere else for it to live. Permanent for the
       * same reason as the lists beside it: a gate placed inside an Uplink is one
       * a third-party author could not run.
       */
      /*
       * -- CI gating ratchet: names the four Uplink test
       * projects that were in mod/Gonogo.sln and in no CI job, which is the
       * finding itself: "four projects drifted" without saying which is not
       * a usable comment. Text-only mention in a ratchet-inventory file, the
       * case this bucket documents.
       */
      "packages/core/src/ci-test-project-coverage.test.ts",
      /*
       * -- The mod-side ownership ratchet itself --
       * UplinkContractOwnershipTests.cs necessarily names the token it is
       * testing FOR, in its own doc comment and its RelocatedModTokens data.
       * A ratchet naming its own subject, not a boundary violation, same
       * class as the C# WirePayloadCoverageTests.cs entry a few lines below.
       */
      "mod/Sitrep.Core.Tests/UplinkContractOwnershipTests.cs",

      /*
       * -- The relocation's own provenance record --
       * ContractVersion.cs's Major/Minor-history doc comments record the
       * original add of the avionics.status Topic AND its later relocation
       * out of this assembly: prose only, the type itself no longer lives
       * here.
       */
      "mod/Sitrep.Contract/ContractVersion.cs",

      /*
       * -- The test that records avionics.status coming from the Uplink's own
       * contract slice rather than the SDK's codegen. topics.ts itself no
       * longer names the Uplink: its doc comment describes the registration
       * mechanism without citing a caller --
       */
      "mod/sitrep-sdk/src/topics.test.ts",

      /*
       * -- Unrelated RP-1/RP-0 module-name collision --
       * GonogoDevKerbalismDump.cs is a GonogoDevTools debug dump unrelated to
       * this Uplink; it lists "RP0Avionics" as one of many third-party
       * PartModule class names it reflects, and separately explains in prose
       * why RP-1's avionics controllable-mass isn't dumped there. No
       * GonogoAvionicsUplink code or type reference.
       */
      "mod/GonogoDevTools/GonogoDevKerbalismDump.cs",
    ],
  },

  /*
   * === kerbalism: owning dirs mod/GonogoKerbalismUplink/ (incl. its client/),
   *     mod/GonogoKerbalismUplink.Tests/, mod/GonogoKerbalismUplink.Contract/.
   *
   * SEEDED LATE, by the types-out-of-core relocation (fifth step) rather than by
   * the original boundary audit, so it does not carry that audit's HARD/gray
   * categorisation history. Two things follow from the late seed and are worth
   * stating rather than leaving to be inferred:
   *
   *   (1) The seed is LARGE (fifty-odd files) and overwhelmingly PROSE. Kerbalism
   *       is this repository's canonical worked example of the augment/slot
   *       architecture, so a dozen base widgets' doc comments name it while
   *       describing the slot they expose ("an augment, e.g. a Kerbalism
   *       Habitat/Radiation badge, binds here"). Those are words about a
   *       hypothetical contributor, not coupling. Filing them as debt would make
   *       the shrink-only gate demand that the ARCHITECTURE stop being explained.
   *   (2) The debt bucket is EMPTY. The SpaceWeather widget, the last Kerbalism
   *       surface still living in the base library, moved into this Uplink's
   *       client and took the harness's Kerbalism fixture reshaping with it.
   *       What remained afterwards was the bundle-time Uplink import, which is
   *       permanent here for the reason this file's header now states once for
   *       all six tokens that carry it. It was the only one of the six filed as
   *       debt, and the justification it carried claimed the opposite of the
   *       one the other five carried.
   */
  kerbalism: {
    domainDebt: [
      // The render harness imports this Uplink to photograph its augments (the
      // Greenhouse section, the crew meters). Moving Ship Systems' and
      // CrewSurvival's fixtures to the Uplink moves those pictures and leaves this
      // import standing, because an augment renders only inside the widget it
      // augments and that widget is core's.
      "packages/components/scripts/probe/probe-entry.tsx",
    ],
    permanent: [
      /*
       * -- UNIT-EXCLUSIVE ratchet inventory: `styleguide-unit-exclusive` holds
       * a per-file debt map of everything still reaching a kit string formatter
       * or declaring a `format*` helper, so it names this Uplink's client among
       * the rest. Text-only, a path in a data literal, and the entry goes when
       * that Uplink's last line does.
       */
      "packages/core/src/styleguide-unit-exclusive.test.ts",
      /*
       * -- PRIMITIVE-READING-FEED ratchet inventory: `DERIVED_FEED_DEBT` holds
       * a per-file count of every primitive still fed a figure a reading's
       * currency was dropped from, so it names this Uplink's client among the
       * rest. Text-only, a key in a data literal, and the entry goes when that
       * Uplink's last derived feed does.
       */
      "packages/core/src/primitive-reading-feed.test.ts",
      /*
       * -- UNKNOWN-CAST ratchet inventory: `unknown-cast.debt.ts` is a per-file
       * ceiling map, so it names every file still asserting out of `unknown`,
       * this Uplink's client among them. Text-only, generated by
       * `scripts/unknown-cast-debt.mjs`, and the entry goes when that Uplink's
       * last escape does.
       */
      "packages/core/src/unknown-cast.debt.ts",
      // data: an entry in the bundle registry.
      "packages/app/uplink-bundle-targets.ts",
      // data: an inline FAKE Uplink client id, `defineUplinkClient({ id: "kerbalism" })`, standing in for a real one to exercise the contribution registry. Imports nothing.
      "packages/components/scripts/provenance-card-probe/provenance-card-probe-entry.tsx",
      // data: the render-set config for the crew-survival augment, keyed by its fixtures path.
      "packages/components/scripts/widgets.ts",
      // The declaration-reachability ratchet's debt list: an inventory of
      // declared Topics/commands with no client consumer, so it names the wire
      // ids of every Uplink that has one. Inventory, not coupling: nothing here
      // imports or renders anything of the Uplink's, and the list shrinks to
      // zero as each consumer is written.
      "packages/core/src/declaration-reachability.allowlist.ts",
      /*
       * -- BANNER-COMMENT debt list: a ratchet inventory, so it is
       * a list of PATHS that carry a banner comment, two of which are this
       * Uplink's. It names the token the way every debt list names one, by
       * quoting a file it is holding a count against, and it carries no code at
       * all. Shrinks to nothing when those two banners are cleaned.
       */
      "packages/core/src/banner-comments.allowlist.ts",
      /*
       * -- CARRIED CONTRACT PROSE: the generated contract now
       * carries the C# doc comments it is generated from, and a wire type
       * describes what an ELECTED backend puts in it. Here,
       * `ReliabilityReading`'s backend field is literally the string
       * "kerbalism" | "testflight" | "none". Text only, in a generated file,
       * and naming the backend IS the fact being stated rather than a
       * dependency on it, so this is the same class as the doc-mention
       * citations already here.
       */
      "mod/sitrep-sdk/src/__generated__/contract.ts",
      /*
       * -- PERMANENT-BUCKET gate: the test that freezes the
       * code-carrying subset of this file's own `permanent` lists. A gate over
       * the allowlist names Uplinks the same way the allowlist does, and its
       * worked example of a planted violation has to name a real token to be
       * a demonstration rather than a description.
       */
      "packages/core/src/uplink-permanent-code.test.ts",
      /*
       * -- WIDGET-FIXTURE CONFORMANCE gate: text-only. Its
       * planted-failure demonstration replants the defect that shipped in this
       * Uplink's CrewSurvival fixture, `deathClockSec` for the wire's
       * `deathClockUt`, and quotes the fixture path and the message the gate
       * printed. The demonstration is the evidence that the gate can fail at
       * all, so naming what it caught is what makes it checkable. The check
       * itself resolves Uplinks by walking `mod/*` and holds no mod name.
       */
      "packages/core/src/widget-fixture-conformance.test.ts",
      /*
       * -- CANONICAL-UNWRAP ratchet: text-only, no code coupling.
       * It holds the magnitude unwrap at one implementation, and its doc
       * comment names the Uplink whose diverged copy answered 0 for absence,
       * because the concrete case is the whole value of that comment. No
       * import, no path, no payload type, and the check itself is repo-wide
       * and mod-blind.
       */
      "packages/core/src/styleguide-magnitude-canonical.test.ts",
      /*
       * The comment-stack ratchet's own inventory: a path-keyed debt list over
       * every hand-written JS/TS file in the repo names Uplink paths by
       * construction, and there is nowhere else for it to live. A gate placed
       * inside an Uplink is one a third-party author could not run.
       */
      "packages/core/src/comment-stacks.allowlist.ts",
      /*
       * -- KSP's OWN enums. KspEnums.cs mirrors seven stock KSP
       * enums so their ordinals can cross the wire, and one of them,
       * ResourceFlowMode, is read by this Uplink and by nothing else. The enum
       * is STOCK KSP's, not Kerbalism's, so declaring it in the Uplink's slice
       * would mean a second Uplink reading the same stock enum got a second copy
       * of the same transcription, which is the drift this whole mechanism
       * exists to remove. What names the mod is the doc comment saying which
       * channel the ordinal rides (`kerbalism.resourceDefs[].flowModeOrdinal`)
       * and why the type is here rather than there. A channel path in a contract
       * doc comment is the text-only wire mention this bucket documents; the
       * SDK's two files carry the same sentence for the same reason.
       */
      "mod/Sitrep.Contract/KspEnums.cs",
      "mod/sitrep-sdk/src/index.ts",
      "mod/sitrep-sdk/src/ksp-enum-names.ts",
      /*
       * -- MAGNITUDE budget ratchet: the per-file `.magnitude`
       * budget is keyed by file path, so it names every Uplink that unwraps a
       * Value. Ratchet-inventory file, the case this bucket documents.
       */
      "packages/core/src/styleguide-magnitude-budget.test.ts",
      /*
       * -- FIRE-AND-FORGET command budget: the per-file budget
       * for dispatches that discard their outcome is keyed by file path, so it
       * names every Uplink with a blind dispatch. Ratchet-inventory file, the
       * case this bucket documents.
       */
      /*
       * -- Uplink ISOLATION ratchet inventory: the inward guard's
       * debt list is keyed by file path, so it necessarily names every Uplink
       * directory. Ratchet-inventory file, the case this bucket documents.
       */
      "packages/core/src/uplink-isolation.allowlist.ts",
      /*
       * FleetReliability's characterisation test emits `reliability.summary`
       * payloads carrying real `source` values. A wire-value reference: the widget
       * only branches on `source === "none"`, never on the vendor.
       */
      "packages/components/src/FleetReliability/undefined.characterise.test.tsx",
      /*
       * The install-profile harness names Kerbalism as a roster entry and as the
       * `reliability.summary.source` its backend produces, both wire values. See
       * the matching entries under `testflight` for the whole rationale.
       */
      "packages/components/src/test/installProfile.test.ts",
      "packages/components/src/FleetReliability/install-profiles.test.tsx",
      /*
       * The profile REGISTRY, for the same reason as the harness above: it
       * imports each declared install by file name, and one of the installs is
       * "Kerbalism modelling reliability". A profile id and a roster entry are
       * wire values, and this file knows nothing else about the mod.
       */
      "packages/components/src/test/installProfile.ts",
      /*
       * The wire-side distinctness instrument, which names every reliability
       * situation the mod can produce, both backends included, because the whole
       * assertion is that no two of them serialise to the same bytes. Wire values
       * in a ratchet; it imports only the contract and the vanilla backend.
       */
      "mod/Sitrep.Host.Tests/ReliabilityStateWireTests.cs",
      /*
       * The coverage-state distinctness matrix hands the augment a
       * `reliability.summary.source` per case, and the vendor strings are the
       * point: two installs whose backends differ must not render alike. A wire
       * value, and the widget branches on `coverage`, never on who is speaking.
       */
      "packages/components/src/FleetReliability/coverage-matrix.test.tsx",
      /*
       * -- ratchet inventory --
       * The rate-integration candidate scan reads EVERY generated unit
       * descriptor, core's and each Uplink's, because a rate-bearing field
       * landing in an Uplink is exactly the case it exists to catch. It names
       * Kerbalism twice, both in prose: once because Kerbalism's science-data
       * units are the ones core's registry cannot resolve and the scan is
       * therefore blind to, and once in a verdict explaining why its
       * resource amount/rate pairing is real but cross-topic. No Kerbalism
       * type, import, topic or field is referenced, and the verdict data
       * itself lives in a sibling .json this scan never reads.
       */
      "packages/core/src/reckoning-candidates.test.ts",
      /*
       * -- contract/SDK layer --
       * ContractVersion.cs and RtConfig.cs carry the relocation's PROVENANCE
       * prose (the Major 9 -> 10 entry, the Minor-history entry recording the
       * Domain's original landing, and the wirePayloadTypes comment recording
       * what left), which is exactly what the permanent bucket is for.
       * KerbalismPayloads.cs is NOT here: it left this bucket by leaving core
       * outright.
       */
      "mod/Sitrep.Contract/ContractVersion.cs",
      "mod/Sitrep.Contract/RtConfig.cs",
      /*
       * The source-attributed currency events name Kerbalism in PROSE ONLY, to
       * record why the science-credit event is a core type rather than a
       * Kerbalism one: stock's lump credit on transmit-stream completion and
       * Kerbalism's continuous accrual both arrive on the same stock
       * GameEvents.OnScienceRecieved hook carrying the same ProtoVessel, so
       * neither mod needs special handling and the event belongs to core. Zero
       * code coupling: no Kerbalism type, import, topic or field is referenced.
       */
      "mod/Gonogo.KSP/CurrencyEventUplink.cs",
      "mod/Sitrep.Contract/CurrencyEventPayloads.cs",
      /*
       * Reliability.cs: the DOMAIN-NEUTRAL reliability capability contract. It
       * names Kerbalism as one of the two backends that can serve the channel
       * (the other being TestFlight) because the whole point of the shape is
       * that it is a source-agnostic superset: several fields are documented as
       * "TestFlight fills it; null for Kerbalism" and vice versa. Naming both is
       * the contract's job.
       */
      "mod/Sitrep.Contract/Reliability.cs",
      /*
       * contribution-slots.ts: the SDK's mirror of the host-declared
       * contribution slots. `ship-map.part-meters` / `ship-map.part-meta`
       * declare `kerbalism.profile` / `kerbalism.lifesupport` as the Topics a
       * contribution to those slots may read, because that IS the slot's
       * contract. String literal types in a slot declaration, not a payload
       * type and not a TopicId: nothing kerbalism-specific is imported.
       */
      "mod/sitrep-sdk/src/api/contribution-slots.ts",
      /*
       * wrap-units.ts (the hand-written decoder, not a generated map): its
       * name-keyed-map branch cites kerbalism.lifesupport.rates as the case that
       * forced it, since every earlier name-keyed channel used a nested SHAPE as
       * its value and a map of bare scalars had no case. Prose in a mod-agnostic
       * file explaining a general mechanism.
       */
      "mod/sitrep-sdk/src/unit-system/guards.ts",
      "mod/sitrep-sdk/src/wrap-units.ts",

      // -- app / core --
      /*
       * defineTopicManifest.ts: `kerbalism.power` in a DOC-COMMENT example of the
       * manifest helper's shape. That Topic does not exist; it is illustrative.
       */
      /*
       * searchTags.ts: "Kerbalism" as the example value of an Uplink's display
       * name field, in that field's doc comment.
       */
      // map-topic.ts: a section header for the kerbalism Topic block.

      /*
       * -- base-library widgets: SLOT DOCUMENTATION, not coupling --
       * FleetReliability names the backend in prose while describing behaviour,
       * which is text and not coupling: it reads no kerbalism Topic and imports
       * no kerbalism type.
       *
       * The widgets that used to sit here alongside it named the mod in SLOT
       * PROSE ("an augment (e.g. a Kerbalism EC-broker breakdown) renders
       * here"), and that wording has since been rewritten to name the
       * CAPABILITY rather than one backend, so their entries ratcheted off.
       * FleetRoster's went the same way by a different route: it carried the
       * mod as a registerComponent search TAG until it declared its augment
       * slot, after which the tag is computed from whoever binds.
       */
      "packages/components/src/FleetReliability/index.tsx",
      /*
       * systemEntities.ts: the `travelling-pulse` shape's doc comment names
       * Kerbalism's own storm-arrival UT/duration as the realistic EXAMPLE of
       * where a contribution's `arriveUt`/`clearUt` come from, while
       * documenting a mod-agnostic contract every contribution (not just
       * Kerbalism's CME entry) implements. No kerbalism Topic, type or import
       * is referenced.
       */
      /*
       * DivergingBar.tsx: the kit primitive credits the HTML prototype its
       * design was ported from, which happens to be named after the Domain it
       * was mocked for. A provenance citation.
       */
      "packages/ui-kit/src/DivergingBar.tsx",

      /*
       * -- sibling Uplinks + core mod: prose only --
       * ReliabilityCoreUplink.cs / ReliabilityElection.cs /
       * NoneReliabilityBackend.cs: the reliability capability's ELECTION, which
       * by design enumerates its candidate backends by name and priority. Naming
       * them is the mechanism, and the whole point is that core declares the
       * channels so neither backend has to.
       */
      "mod/Gonogo.KSP/ReliabilityCoreUplink.cs",
      "mod/Sitrep.Host/Reliability/ReliabilityElection.cs",
      "mod/Sitrep.Host/Reliability/NoneReliabilityBackend.cs",
      /*
       * GonogoDevKerbalismDump.cs: a DEV-ONLY fixture collector, never shipped.
       * It reflects into Kerbalism at runtime with no compile-time reference and
       * exists precisely so this Uplink's shapes could be grounded in captured
       * fixtures. It is arguably this Uplink's own tooling living in the dev-tools
       * project; it stays permanent rather than debt because moving a dev-only
       * dump into a shipped Uplink would be the wrong direction.
       */
      "mod/GonogoDevTools/GonogoDevKerbalismDump.cs",
      /*
       * GonogoDevKerbalismScience.cs: the same case as the dump above, one step
       * further. It is DEV-ONLY, never shipped, and reaches Kerbalism purely by
       * reflection with no compile-time reference. It drives
       * SubjectData.RetrieveScience, which is the choke point this Uplink's own
       * Harmony postfix patches, because with preventScienceCrediting set that
       * is the ONLY path science can be credited through, so there is no way to
       * observe currency delay on a Kerbalism install without naming it.
       * Permanent rather than debt for the dump's reason: a dev-only probe does
       * not belong inside a shipped Uplink.
       *
       * GonogoDevCurrency.cs names Kerbalism in prose only, to say why its own
       * AddScience path cannot answer the science question here and to point at
       * the tool above.
       */
      "mod/GonogoDevTools/GonogoDevKerbalismScience.cs",
      "mod/GonogoDevTools/GonogoDevCurrency.cs",
      /*
       * Sibling Uplink clients noting that a Kerbalism-shaped filler for one of
       * their own slots is expected later, or recording that they share this
       * Uplink's "no runtime-loader entry, plain static import" bootstrap path.
       * Zero code or type coupling.
       */
      "mod/GonogoBreakingGroundUplink/client/src/DeployedScience/index.tsx",

      /*
       * -- TEST-only --
       * UplinkContractOwnershipTests.cs / WirePayloadCoverageTests.cs: the
       * mod-side relocation-ownership ratchet and the wire-payload coverage
       * ratchet. Both are inventories that by design enumerate the mods they
       * guard; the first registers this Uplink's own token so no Kerbalism* wire
       * type may return to Sitrep.Contract, the second records that the fifteen
       * types left.
       */
      "mod/Sitrep.Core.Tests/UplinkContractOwnershipTests.cs",

      /*
       * sitrep-sdk's own tests: both now carry a comment recording what MOVED
       * OUT of core's generated surface with this relocation (the five Topic ids,
       * and the name-keyed-map unit assertion). What matches is the explanation
       * of an absence.
       */
      "mod/sitrep-sdk/src/generated.test.ts",
      "mod/sitrep-sdk/src/topics.test.ts",
      /*
       * Base-library and core tests using "kerbalism" as a generic EXAMPLE
       * provider/augment/component id ("kerbalism-ec", "kerbalism-power-systems",
       * requires: "kerbalism"), asserting a base widget does NOT couple to it
       * (CrewStatus asserts it never subscribes to kerbalism.crew), or naming it
       * in prose as one possible reliability source. FleetReliability emits
       * `source: "kerbalism"` on the source-AGNOSTIC reliability.summary Topic,
       * which is the field's whole point.
       */
      "packages/core/src/contributionsRuntime.test.tsx",
      "packages/core/src/registry.replacement.test.ts",
      "packages/core/src/truenow-allowlist.test.ts",
      "packages/components/src/CrewStatus/index.test.tsx",
      "packages/components/src/FleetReliability/index.test.tsx",
      "packages/components/src/FleetRoster/index.test.tsx",
      /*
       * unit-symbol-collision.test.ts: the guard for a real shipped bug, named
       * after where it was seen (a death-clock badge reading "~4M" for four
       * minutes). Provenance for a general unit-symbol rule.
       */
      "packages/ui-kit/src/unit-symbol-collision.test.ts",
    ],
  },
  /*
   * === testflight: owning dir mod/GonogoTestFlightUplink/. Had an owning
   * Uplink and no token at all until now, so nothing was checking it. Its
   * provider registers generically into the "reliability" capability, so core
   * never names it.
   *
   * The Uplink moved to the gonogo-uplinks repo, so those
   * owning dirs no longer exist and every mention below is held by this
   * list alone. They stay named for the same reason kerbcast's and
   * scansat's do: the pair says where the code went, rather than
   * pretending it is still here.
   */
  testflight: {
    domainDebt: [],
    permanent: [
      /*
       * -- CARRIED CONTRACT PROSE: the generated contract now
       * carries the C# doc comments it is generated from, and a wire type
       * describes what an ELECTED backend puts in it. Here,
       * `ReliabilityReading`'s backend field is literally the string
       * "kerbalism" | "testflight" | "none", and the rated-seconds field says
       * whose seconds they are. Text only, in a generated file, and naming the
       * backend IS the fact being stated rather than a dependency on it, so
       * this is the same class as the doc-mention citations already here.
       */
      "mod/sitrep-sdk/src/__generated__/contract.ts",
      /*
       * -- CI gating ratchet: names the four Uplink test
       * projects that were in mod/Gonogo.sln and in no CI job, which is the
       * finding itself: "four projects drifted" without saying which is not
       * a usable comment. Text-only mention in a ratchet-inventory file, the
       * case this bucket documents.
       */
      "packages/core/src/ci-test-project-coverage.test.ts",
      /*
       * FleetReliability's characterisation test emits `reliability.summary`
       * payloads carrying real `source` values, which is what the wire carries.
       * A wire-value reference, the case this bucket exists for: the widget only
       * branches on `source === "none"` and never on the vendor, so the strings
       * are fixture realism rather than coupling.
       */
      "packages/components/src/FleetReliability/undefined.characterise.test.tsx",
      // Same wire-value reference in the widget's stale-branch test.
      "packages/components/src/FleetReliability/stale.test.tsx",
      /*
       * The install-profile harness: a checked-in declaration of which Uplinks a
       * machine has, so a widget can be rendered under an install other than the
       * one every fixture in this repo was captured on. The names it carries are
       * Uplink ids off the `system.uplinks` roster and `source` values off
       * `reliability.summary`, both already on the wire, and it is where the
       * TestFlight-versus-Kerbalism election is stated as data. It imports and
       * derives from nothing in the owning dir; the reference is a wire value and
       * a file name, which is the case this bucket exists for.
       */
      "packages/components/src/test/installProfile.ts",
      "packages/components/src/test/installProfile.test.ts",
      "packages/components/src/FleetReliability/install-profiles.test.tsx",
      "packages/components/src/LaunchDirector/install-profiles.test.tsx",
      /*
       * The coverage-state distinctness matrix hands the augment a
       * `reliability.summary.source` per case, and the vendor strings are the
       * point: two installs whose backends differ must not render alike. A wire
       * value, and the widget branches on `coverage`, never on who is speaking.
       */
      "packages/components/src/FleetReliability/coverage-matrix.test.tsx",
      /*
       * Every entry is a doc-mention naming TestFlight as the OTHER backend that
       * competes for the shared "reliability" capability, which is how the
       * election and the wire shape are explained. None imports, references or
       * derives from anything in the owning dir.
       *
       * Kerbalism's half of that shared capability: its map and its uplink
       * registration name TestFlight to say who outranks whom in the election.
       * The list was four files until the reliability reshape: the payloads no
       * longer carry a per-provider field, so a doc comment saying "TestFlight
       * fills this one, Kerbalism leaves it null" no longer has anything to
       * describe, and three entries left with the sentences.
       */
      "mod/GonogoKerbalismUplink/KerbalismReliabilityMap.cs",
      "mod/GonogoKerbalismUplink/KerbalismUplink.cs",
      /*
       * The core uplink that declares the reliability channels names both
       * backends in the same breath, for the same reason.
       */
      "mod/Gonogo.KSP/ReliabilityCoreUplink.cs",
      // Dev-only Kerbalism dump tool, doc-mention.
      "mod/GonogoDevTools/GonogoDevKerbalismDump.cs",
      /*
       * The reliability wire contract and its election, which name both
       * competing backends to explain the shape and the precedence. Contract
       * and election layer, doc-mention only.
       */
      "mod/Sitrep.Contract/Reliability.cs",
      "mod/Sitrep.Contract/SitrepUnitAttribute.cs",
      "mod/Sitrep.Host/Reliability/ReliabilityElection.cs",
      "mod/Sitrep.Host/Reliability/NoneReliabilityBackend.cs",
      "mod/Sitrep.Host.IntegrationTests/FlightEndToEndTests.cs",
      /*
       * The wire-side distinctness instrument. It names every reliability
       * situation the mod can produce, both backends included, because the
       * whole assertion is that no two of them serialise to the same bytes: a
       * sweep that could not name them could not report which pair collapsed.
       * Wire values in a ratchet, and it imports only the contract and the
       * vanilla backend.
       */
      "mod/Sitrep.Host.Tests/ReliabilityStateWireTests.cs",
      /*
       * Widgets that render the reliability domain and name TestFlight in prose
       * to explain which source a field came from.
       */
      "packages/components/src/FleetReliability/index.tsx",
      "packages/components/src/FleetReliability/index.test.tsx",
      "packages/components/src/FleetReliability/composition.test.tsx",
    ],
  },

  /*
   * === principia: the pattern this ratchet exists to stop is core naming a
   * specific mod, and the moment that is most likely is when someone leaves a
   * seam "ready" for a mod that has no Uplink yet. The token now has three
   * owning dirs (see MOD_OWNERSHIP in uplink-boundary.test.ts). A token keyed
   * on mods we already integrate cannot see that case, which is exactly how
   * TargetApproachElection acquired a public RegisterPrincipiaProvider and
   * PrincipiaProviderId without ever being flagged.
   */
  principia: {
    domainDebt: [],
    permanent: [
      /*
       * -- UNKNOWN-CAST ratchet inventory: `unknown-cast.debt.ts` is a per-file
       * ceiling map, so it names every file still asserting out of `unknown`,
       * this Uplink's client among them. Text-only, generated by
       * `scripts/unknown-cast-debt.mjs`, and the entry goes when that Uplink's
       * last escape does.
       */
      "packages/core/src/unknown-cast.debt.ts",
      /*
       * -- UNKNOWN-CAST ratchet: the gate and its scanner both cite
       * `mod/GonogoPrincipiaUplink/client/src/planWrite.ts` as the worked
       * example of the remedy, because the seven envelope-for-payload
       * assertions it repaired are the defect the whole rule exists for. Naming
       * the fix is the point of the citation, so this is a doc mention rather
       * than coupling. `unknown-cast.test.ts` also compiles a copy of
       * `planWriteReceipt` as its false-positive control.
       */
      "packages/core/src/unknown-cast.test.ts",
      /*
       * -- PRODUCER FIELD PARITY gate: names Principia in its own worked
       * example. The five burn-profile fields that reached the wire as null on
       * every Principia plan are WHY this gate exists, so the doc comment cites
       * the incident and `PrincipiaManeuverPlanSource` as the producer that was
       * filling them correctly all along. Prose citing a fix to read, the same
       * shape as the unknown-cast entry above. No import, no topic read.
       */
      "mod/Sitrep.Core.Tests/ProducerFieldParityTests.cs",
      // The declaration-reachability ratchet's debt list: an inventory of
      // declared Topics/commands with no client consumer, so it names the wire
      // ids of every Uplink that has one. Inventory, not coupling: nothing here
      // imports or renders anything of the Uplink's, and the list shrinks to
      // zero as each consumer is written.
      "packages/core/src/declaration-reachability.allowlist.ts",
      /*
       * -- RENDER-FIXTURE COVERAGE ratchet: names this Uplink in
       * PROSE now rather than as data. The test cites commit a718dd36a and
       * quotes the six field names its planted-failure demonstration reports,
       * which holds no coupling either: the demonstration is the evidence
       * that the gate can fail at all, and naming what it printed is what
       * makes that checkable.
       */
      "packages/core/src/render-fixture-coverage.test.ts",
      /*
       * -- CI gating ratchet: names the four Uplink test
       * projects that were in mod/Gonogo.sln and in no CI job, which is the
       * finding itself: "four projects drifted" without saying which is not
       * a usable comment. Text-only mention in a ratchet-inventory file, the
       * case this bucket documents.
       */
      "packages/core/src/ci-test-project-coverage.test.ts",
      /*
       * HISTORICAL RECORD of a decision that removed Principia awareness from
       * core. You cannot record "we deliberately deleted detection of this
       * mod" without naming the mod, and rewriting a ledger to hide the
       * subject would defeat the ledger. Every FORWARD-LOOKING mention ("a
       * future Principia provider will...") has been de-named instead: those
       * were the anticipation pattern this token exists to catch, and the
       * interfaces now say "an n-body backend", which is the same point without
       * committing core to a specific mod.
       *
       * ContractVersion's Major 2 -> 3 entry records the revert that removed
       * VesselPhysicsMode.IsPrincipiaActive, and the file's own contract is that
       * a Major "cannot rewrite what it inherited".
       */
      "mod/Sitrep.Contract/ContractVersion.cs",
    ],
  },

  // === ferram: owning dirs mod/GonogoFerramAerospaceResearchUplink/ (incl. its
  // client/), mod/GonogoFerramAerospaceResearchUplink.Tests, and
  // mod/GonogoFerramAerospaceResearchUplink.Contract.
  //
  // The token is the MOD's name and nothing on the wire carries it: this
  // Uplink's id is "aero" and its Topics are aero.available / aero.state,
  // deliberately, because what an operator reads is the aerodynamic state and
  // which model computed it is the Uplink's business. So there is no
  // topic-prefix pattern here to go with the type-name one, and there should not
  // be: "far." would match prose in half the tree and would be matching a string
  // no production file contains.
  ferram: { domainDebt: [], permanent: [] },
};

/**
 * Allowlisted files whose mod reference SURVIVES having comments stripped.
 *
 * <p>An allowlist entry excuses the FILE, not the line that earned it, and
 * almost every entry was earned by a comment. So real coupling added to such a
 * file later would be covered silently, because the boundary gate sees a file
 * it has already excused. This list is the second look: the entries here are
 * known to match without their prose, and anything JOINING it has to be
 * explained rather than absorbed.</p>
 *
 * <p><b>Surviving the strip is not the same as being code.</b> These are almost
 * entirely the mod name as DATA, install-profile ids, fixture keys, and
 * assertions about the name itself, where a string is the honest way to say it.
 * Measured when this was seeded: nothing under `packages/` imports an Uplink
 * package or reads a mod topic in code. Shrink-only, like the debt list.</p>
 */
export const SURVIVES_COMMENT_STRIP: Partial<Record<ModToken, string[]>> = {
  // The EVA scope ratchet's debt list. What survives the strip is the mod name
  // as DATA: one inventory key per file that read `FlightGlobals.ActiveVessel`
  // directly, and two `path.EndsWith(...)` floors asserting the walk actually
  // reached those files. The floors are the point: a scan whose pattern stops
  // matching reports a clean repo, so without them the ratchet would go quiet
  // instead of red. No import, no topic read, no assembly reference.
  mechjeb: [
    "mod/Sitrep.Core.Tests/UplinkContractOwnershipTests.cs",
    "packages/core/src/uplink-isolation.allowlist.ts",
  ],
  realantennas: [
    "mod/Gonogo.KSP.Tests/Comms/RouteBackendDispatchTests.cs",
    "mod/Gonogo.KSP.Tests/DevTools/AntennaProbeVerdictsTests.cs",
    "mod/GonogoDevTools/GonogoDevAntenna.cs",
    "mod/Sitrep.CaptureAnalysis.Tests/CommandLineTests.cs",
    "mod/Sitrep.CaptureAnalysis.Tests/RealCaptureTests.cs",
    "mod/Sitrep.CaptureAnalysis.Tests/SyntheticCapture.cs",
    "mod/Sitrep.CaptureAnalysis.Tests/VerdictTests.cs",
    "mod/Sitrep.Core.Tests/KernelFactoryFailureTests.cs",
    "mod/Sitrep.Core.Tests/UplinkContractOwnershipTests.cs",
    "mod/Sitrep.Host.Tests/CommsElectionTests.cs",
    "mod/sitrep-kernel/src/registry.test.ts",
    "packages/components/src/FleetReliability/install-profiles.test.tsx",
    "packages/core/src/uplink-isolation.allowlist.ts",
  ],
  agx: [],
  avionics: [
    // The isolation ratchet's forbidden-package list, which keeps this
    // Uplink's package name after its departure: that rule may
    // widen and never narrow, so the next Uplink to import it is still
    // caught. The name as DATA in a ratchet inventory, not a reference to any
    // code of its.
    "packages/core/src/uplink-isolation.allowlist.ts",
    // -- SCAN WIDENED TO THE WHOLE PACKAGE. Each of these is
    // either the mod name as DATA (a bundle id, a wire topic, a fixture path,
    // a vitest alias) or, where noted in the entry's own line above, a real
    // import that is recorded in domainDebt and shrinks from there. The
    // ratchet-inventory entries that sat beside them (unknown-cast, comment
    // stacks, isolation, TrueNow and the two app-side gates) went when this
    // Uplink left for the gonogo-uplinks repo and those inventories stopped
    // naming any file of its.
    "mod/GonogoDevTools/GonogoDevKerbalismDump.cs",
    "mod/Sitrep.Core.Tests/UplinkContractOwnershipTests.cs",
  ],
  kerbalism: [
    // -- PRIMITIVE-READING-FEED ratchet inventory: the mod name as DATA, one
    // per-file count key per file still feeding a primitive a figure a
    // reading's currency was dropped from. The key goes when that file's last
    // derived feed does.
    "packages/core/src/primitive-reading-feed.test.ts",
    // -- UNIT-EXCLUSIVE ratchet inventory: the mod name as DATA, one per-file
    // debt key per file still reaching a kit string formatter or declaring a
    // `format*` helper. A path in a data literal, not an import and not a
    // topic read; the key goes when that file's last line does.
    "packages/core/src/styleguide-unit-exclusive.test.ts",
    // -- UNKNOWN-CAST ratchet inventory: the mod name as DATA, one
    // per-file ceiling key per file still asserting out of `unknown`. Generated
    // by `scripts/unknown-cast-debt.mjs`; the key goes when that file's last
    // escape does.
    "packages/core/src/unknown-cast.debt.ts",
    "packages/app/uplink-bundle-targets.ts",
    "packages/components/scripts/provenance-card-probe/provenance-card-probe-entry.tsx",
    "packages/components/scripts/widgets.ts",
    // The reachability ratchet's debt list: wire ids as DATA, one line per
    // declared Topic/command with no consumer. Survives the strip because the
    // ids are the inventory, not prose about it. Shrinks to zero as consumers
    // are written.
    "packages/core/src/declaration-reachability.allowlist.ts",
    "packages/core/src/uplink-permanent-code.test.ts",
    "mod/GonogoDevTools/GonogoDevKerbalismDump.cs",
    "mod/GonogoDevTools/GonogoDevKerbalismScience.cs",
    "mod/Sitrep.Core.Tests/UplinkContractOwnershipTests.cs",
    "mod/Sitrep.Host.Tests/ReliabilityStateWireTests.cs",
    "packages/components/src/CrewStatus/index.test.tsx",
    "packages/components/src/FleetReliability/coverage-matrix.test.tsx",
    "packages/components/src/FleetReliability/index.test.tsx",
    "packages/components/src/FleetReliability/install-profiles.test.tsx",
    "packages/components/src/FleetReliability/undefined.characterise.test.tsx",
    "packages/components/src/test/installProfile.test.ts",
    "packages/components/src/test/installProfile.ts",
    // Two debt-list KEYS naming this Uplink's files. Paths, not code.
    "packages/core/src/banner-comments.allowlist.ts",
    "packages/core/src/comment-stacks.allowlist.ts",
    "packages/core/src/contributionsRuntime.test.tsx",
    "packages/core/src/registry.replacement.test.ts",
    "packages/core/src/styleguide-magnitude-budget.test.ts",
    "packages/core/src/truenow-allowlist.test.ts",
    "packages/core/src/uplink-isolation.allowlist.ts",
  ],
  kerbcast: [
    "mod/Sitrep.Core.Tests/UplinkContractOwnershipTests.cs",
    "mod/sitrep-sdk/src/default-carried-topics.ts",
    "packages/app/src/alarms/AlarmHostService.test.ts",
    "packages/app/src/screens/StationScreen.tsx",
    "packages/core/src/uplink-isolation.allowlist.ts",
    "packages/data/src/schema/topicFieldCatalog.test.ts",
    "packages/sitrep-client/src/map-topic.test.ts",
  ],
  kos: [
    "packages/components/scripts/render-systemview-traffic-video.ts",
    "mod/Sitrep.Core.Tests/CommandRequestLabelWireTests.cs",
    "mod/Sitrep.Core.Tests/CourierReliableOrderedDeliveryTests.cs",
    "mod/Sitrep.Core.Tests/PendingUplinkQueueWireTests.cs",
    "mod/Sitrep.Host.IntegrationTests/KosProcessorsWireTests.cs",
    "mod/sitrep-sdk/src/api/api-shape.gate.test.ts",
    "mod/sitrep-sdk/src/command-delay.test.ts",
    "mod/sitrep-sdk/src/default-carried-topics.ts",
    "mod/sitrep-sdk/src/spine/map-topic.ts",
    "mod/sitrep-sdk/src/topics.test.ts",
    "packages/app/src/__tests__/kos-execute-tunnel.test.ts",
    "packages/app/src/__tests__/sitrep-command-label-topic-tunnel.test.ts",
    "packages/app/src/logs/LogsManager.tsx",
    "packages/app/src/settings/SettingsModal.test.tsx",
    "packages/app/src/telemetry/PeerTransport.test.ts",
    "packages/core/src/hooks/useUplinkHealthFor.test.tsx",
    "packages/data/src/hooks/useDataSchema.test.tsx",
    "packages/data/src/schema/topicFieldCatalog.test.ts",
    "packages/sitrep-client/src/map-topic.test.ts",
    "packages/sitrep-client/src/uplink-health.test.ts",
    "packages/sitrep-client/src/use-route-commands.test.tsx",
  ],
  principia: [],
  scansat: [
    "mod/GonogoDevTools/GonogoDevStampScan.cs",
    "mod/GonogoKerbalismUplink.Tests/ScienceExtensionWireTests.cs",
    "mod/GonogoKerbalismUplink/KerbalismReflection.cs",
    "mod/GonogoKerbalismUplink/client/src/science.test.ts",
    "mod/Sitrep.Core.Tests/UplinkContractOwnershipTests.cs",
    "mod/sitrep-sdk/src/default-carried-topics.ts",
    "mod/sitrep-sdk/src/spine/map-topic.ts",
    "packages/app/src/__tests__/scansat-coverage-roundtrip.test.tsx",
    "packages/app/src/uplinks/loader.test.ts",
    "packages/core/src/comment-stacks.allowlist.ts",
    // A debt-list KEY: the path of a file whose comment cites a path the tree
    // does not have. A path in an inventory, not code.
    "packages/core/src/stale-references.allowlist.ts",
    "packages/core/src/uplink-isolation.allowlist.ts",
    "packages/data/src/schema/topicFieldCatalog.test.ts",
    "packages/sitrep-client/src/map-topic.test.ts",
    "packages/sitrep-client/src/use-late-telemetry-subscribe.test.tsx",
  ],
  testflight: [
    "mod/GonogoDevTools/GonogoDevKerbalismDump.cs",
    "mod/Sitrep.Host.IntegrationTests/FlightEndToEndTests.cs",
    "mod/Sitrep.Host.Tests/ReliabilityStateWireTests.cs",
    "packages/components/src/FleetReliability/composition.test.tsx",
    "packages/components/src/FleetReliability/coverage-matrix.test.tsx",
    "packages/components/src/FleetReliability/index.test.tsx",
    "packages/components/src/FleetReliability/install-profiles.test.tsx",
    "packages/components/src/FleetReliability/stale.test.tsx",
    "packages/components/src/FleetReliability/undefined.characterise.test.tsx",
    "packages/components/src/LaunchDirector/install-profiles.test.tsx",
    "packages/components/src/test/installProfile.test.ts",
    "packages/components/src/test/installProfile.ts",
  ],
};
