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

type ModToken = "kerbcast" | "scansat" | "kos" | "realantennas";

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
    // No GonogoKerbcastUplink exists yet. packages/kerbcast is the
    // current de-facto home (npm name @ksp-gonogo/kerbcast-feed).
    patterns: [/kerbcast/i, /hullcam/i],
    ownedDirs: ["packages/kerbcast"],
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
    ownedDirs: ["mod/Gonogo.Kos", "mod/Gonogo.Kos.Tests"],
  },
  realantennas: {
    // Matches both "realantennas" and the singular "realantenna".
    patterns: [/realantenna/i],
    ownedDirs: [
      "mod/GonogoRealAntennasUplink",
      "mod/GonogoRealAntennasUplink.Tests",
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
  // === kerbcast — no Uplink home exists yet; every reference is homeless.
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
    "packages/components/src/DistanceToTarget/index.tsx",

    // -- GRAY — sitrep-client / contract layer, comment or string-literal only --
    "mod/Gonogo.Kos/client/src/index.ts",
    "mod/Sitrep.Contract/UplinkContract.cs",
    "mod/Sitrep.Host/ChannelEngine.cs",
    "packages/sitrep-client/src/context.tsx",
    "packages/sitrep-client/src/delay-authority.ts",
    "packages/sitrep-client/src/map-command.ts",
    "packages/sitrep-client/src/map-topic.test.ts",
    "packages/sitrep-client/src/map-topic.ts",

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
    "mod/Gonogo.Kos.Tests/KosVersionGuardTests.cs",
    "mod/Gonogo.Kos/KosExtension.cs",
    "mod/Gonogo.Kos/KosVersionGuard.cs",
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
  ],

  // === kos — owning dir mod/Gonogo.Kos/
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
    // pending-uplink contract: its Command field doc-comment gives
    // `kos.run` as the example wire command name — doc-mention only.
    "mod/Sitrep.Contract/UplinkPending.cs",
    "mod/sitrep-sdk/src/__generated__/contract.ts",
    "mod/sitrep-sdk/src/__generated__/topic-map.ts",
    "mod/sitrep-sdk/src/topics.test-d.ts",
    "mod/sitrep-sdk/src/topics.test.ts",
    "mod/sitrep-sdk/src/topics.ts",
    // dispatch()'s label doc-comment cites `kos.keystroke` as the example
    // line-mode command whose composed text becomes the queue label —
    // comment-only, no kOS coupling in the client spine.
    "packages/sitrep-client/src/client.ts",
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
    "packages/kerbcast/src/index.ts",
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
    "packages/components/src/CommSignal/index.tsx",
    "packages/components/src/SystemView/index.tsx",
    // G2 TrueNow-allowlist ratchet (task 4) names RealAntennasUplink.cs in
    // a justification comment while inventorying every TrueNow
    // declaration in mod/ — doc-mention only.
    "packages/core/src/truenow-allowlist.test.ts",

    // -- GRAY — Sitrep.Contract/Comms.cs carries three RA-only payload types --
    "mod/Sitrep.Contract/Comms.cs",

    // -- TEST-only --
    "mod/Sitrep.Core.Tests/CommsWireTests.cs",
    "mod/Sitrep.Host.IntegrationTests/FoundationChannelsEndToEndTests.cs",
    "mod/Sitrep.Host.Tests/CommsElectionTests.cs",
    "packages/components/src/CommSignal/slot.test.tsx",
    "packages/sitrep-client/src/map-topic.rawFieldRoots.coverage.test.ts",
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
