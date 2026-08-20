// @vitest-environment node
//
// This suite needs the real Node TextEncoder/Uint8Array realm, not jsdom's
// (the package default): esbuild's `transformSync`, used by the shrink-only
// check below, asserts `new TextEncoder().encode("") instanceof Uint8Array`
// and throws "JavaScript environment is broken" under jsdom, where that
// realm doesn't line up. Nothing else in this file touches the DOM.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ALLOWLIST,
  type ModAllowlist,
  type ModToken,
} from "./uplink-boundary.allowlist";

/**
 * Uplink-boundary guardrail: prevent mod names/types leaking outside the
 * package that owns their integration ("Uplink"). Ratchet-style, same
 * shape as `styleguide.test.ts`'s hex-literal gate: but per-file instead
 * of per-count, because a boundary violation is "this specific file
 * imports/references a mod it doesn't own", not a fungible occurrence.
 *
 * Full catalogue, categorisation (HARD / gray / test / comment-only), and
 * the reasoning behind every entry:
 *   docs/superpowers/specs/2026-07-13-uplink-boundary-audit.md
 *   docs/superpowers/specs/2026-07-18-ratchet-hardening-design.md
 * The allowlist data itself lives in the sibling `uplink-boundary.allowlist.ts`
 * module (permanent vs shrink-only domainDebt entries: see that file's header).
 *
 * How the ratchet works:
 *   1. Scan `packages/*\/src` and `mod/*` (.ts/.tsx/.cs) for each mod
 *      token, excluding that mod's own owning directory.
 *   2. Every file found is checked against
 *      `[...ALLOWLIST[token].permanent, ...ALLOWLIST[token].domainDebt]`.
 *   3. A file found but NOT allowlisted = a NEW violation -> fail, named.
 *   4. An allowlist entry that no longer matches any found file = STALE
 *      -> fail, named. This is what makes it a ratchet: fixing a
 *      violation (moving code into the owning Uplink, or dropping the
 *      reference) makes its allowlist line stale, and the test forces
 *      you to delete that line in the same commit.
 *
 * IMPORTANT: this is a content scan, not an import scan: `findViolations`
 * regex-tests each file's raw text, so a string LITERAL (e.g. a `layerId`
 * hardcoded as `"scansat:AltimetryHiRes"` in a shared-package fixture) is
 * caught by the exact same pattern that catches a real `import`. Don't
 * assume this ratchet is import-only, genericise example mod-name
 * strings in shared packages the same way commit `fcb770f1` did, rather
 * than expecting this gate to be blind to them.
 *
 * A second, independent test below (`domain-debt allowlist entries only
 * ever shrink`) enforces that `ALLOWLIST[token].domainDebt` never gains an
 * entry vs. a base git ref: see its own doc-comment for details. The
 * `permanent` bucket has no such gate; add/remove freely via reviewed edit.
 */

interface ModOwnership {
  // Distinctive-form patterns for this mod. Deliberately NOT bare
  // substrings like "kos": see the kos entry below for why.
  patterns: RegExp[];
  // Directories (relative to repo root) that own this mod's integration.
  // Any match inside one of these is not a boundary violation.
  // EMPTY means the mod owns nothing here any more: see `telemachus`.
  ownedDirs: string[];
  // Search code only, with comments stripped out. Off by default, because
  // for a mod that is still installed a comment naming it is a real
  // reference worth allowlisting. On for a RETIRED mod, where prose about
  // what it used to do is history rather than coupling: see `telemachus`.
  codeOnly?: boolean;
}

const MOD_OWNERSHIP: Record<ModToken, ModOwnership> = {
  kerbcast: {
    // GonogoKerbcastUplink owns kerbcast's CONTROL plane (camera inventory,
    // capabilities, docking-port association, health, aim/zoom commands): see
    // .superpowers/sdd/kerbcast-uplink-design.md. Its §8 left open whether the
    // MEDIA half (the WebRTC/playout path, npm name @ksp-gonogo/gonogo-kerbcast-uplink)
    // folds into the Uplink's client; it now has: that package moved from
    // packages/kerbcast to this Uplink's client/ half, so ONE directory owns
    // both planes and the client is no longer a special-cased core package.
    // (mod/GonogoKerbcastUplink covers client/: isUnderOwnedDir is a prefix
    // match: so the client half needs no separate entry.)
    patterns: [/kerbcast/i, /hullcam/i],
    ownedDirs: [
      "mod/GonogoKerbcastUplink",
      "mod/GonogoKerbcastUplink.Tests",
      // GonogoKerbcastUplink's own contract slice (uplink-types-out-of-core
      // plan, third relocation, 2026-08-10): KerbcastCameraEntry/
      // KerbcastSetFieldOfViewArgs/KerbcastSetPanArgs live here now, not in
      // Sitrep.Contract.
      "mod/GonogoKerbcastUplink.Contract",
    ],
  },
  scansat: {
    patterns: [
      /scansat/i,
      // packages/core/src/schemas/scansat.ts's exported wire-shape
      // identifiers: SCANType, SCANCoverageBitmap, SCANHeightGrid,
      // SCANBiomeEntry, SCANBiomeGrid, SCANSensorEntry, SCANScanningVessel,
      // SCANAnomalyEntry. Requires an uppercase letter THEN a lowercase
      // letter immediately after "SCAN" (a real word start), not a bare
      // "SCAN" prefix: a bare prefix collides with this codebase's
      // unrelated "SCAN_ROOTS" / "COMPONENT_SCAN_ROOTS" convention (three
      // ratchet tests use "SCAN_ROOTS" to mean "directories to walk"). See
      // docs/superpowers/specs/2026-07-18-ratchet-hardening-design.md §1.3.
      /\bSCAN[A-Z][a-z]/,
      // The SCAN_TYPE const specifically: doesn't match the above pattern
      // (underscore, not an uppercase letter, follows "SCAN"). \b on both
      // ends so it doesn't match inside "FOG_SCAN_TYPES" or similar.
      /\bSCAN_TYPE\b/,
    ],
    ownedDirs: [
      "mod/GonogoScansatUplink",
      "mod/GonogoScansatUplink.Tests",
      // GonogoScansatUplink's own contract slice (uplink-types-out-of-core
      // plan, fourth relocation, 2026-08-10): ScanningVesselEntry/
      // ScanSensorEntry/ScanTrackColor/ScanScienceEntry/ScanAnomalyEntry live
      // here now, not in Sitrep.Contract.
      "mod/GonogoScansatUplink.Contract",
    ],
  },
  kos: {
    // "kos" alone false-matches inside unrelated words, so match only
    // distinctive forms: the npm package (renamed to the
    // gonogo-<mod>-uplink convention), PascalCase Kos-prefixed identifiers,
    // the kos.* topic namespaces, and the mod's own capitalisation "kOS".
    patterns: [
      /@ksp-gonogo\/gonogo-kos-uplink/,
      /Kos[A-Z]/,
      /kos\.(processors|run|compute|terminal|keystroke)/,
      /kOS/,
    ],
    ownedDirs: [
      "mod/GonogoKosUplink",
      "mod/GonogoKosUplink.Tests",
      // GonogoKosUplink's own contract slice (uplink-types-out-of-core plan,
      // sixth and last relocation, 2026-08-10): all eleven Kos* wire and
      // command-arg types live here now, not in Sitrep.Contract.
      "mod/GonogoKosUplink.Contract",
    ],
  },
  realantennas: {
    // Matches both "realantennas" and the singular "realantenna".
    patterns: [/realantenna/i],
    ownedDirs: [
      "mod/GonogoRealAntennasUplink",
      "mod/GonogoRealAntennasUplink.Tests",
      // GonogoRealAntennasUplink's own contract slice (uplink-types-out-of-core
      // plan, seventh and last relocation, 2026-08-11, and the only PARTIAL
      // one): CommsLinkQuality/CommsDataRate/CommsLinkMargin live here now, not
      // in Sitrep.Contract. The rest of the comms.* family stays core, since it
      // is the shape whichever backend wins the "comms" election fills.
      "mod/GonogoRealAntennasUplink.Contract",
    ],
  },
  agx: {
    // Deliberately NOT a bare "actionGroups" match, that field/topic name
    // is ubiquitous outside this mod (VesselControl.ActionGroups,
    // vessel.control.setActionGroup, StockActionGroupsBackend, etc.), so a
    // bare substring would false-match almost every vessel-control file.
    // These three patterns match only AGX-DISTINCTIVE forms: the "Action
    // Groups Extended" name (with or without a separator, so it also
    // catches the provider id "actionGroupsExtended" and identifiers like
    // "ActionGroupsExtendedProviderId"), the AGExt assembly/type name, and
    // AGX-prefixed API identifiers (AGXListOfAssignedGroups, AGXGroupState,
    // AGXActivateGroup, AGXInstalled, ...): none of which match plain
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
  mechjeb: {
    // "mechjeb" alone is distinctive enough (no unrelated-word collision
    // in this codebase, unlike bare "kos"/"scan"): one case-insensitive
    // pattern covers MechJeb2/MechJebAscentArgs/mechjeb.* topic prefixes/
    // gonogo-mechjeb-uplink alike.
    patterns: [/mechjeb/i],
    ownedDirs: [
      "mod/GonogoMechJebUplink",
      "mod/GonogoMechJebUplink.Tests",
      // GonogoMechJebUplink's own contract slice (uplink-types-out-of-core
      // pilot, 2026-08-10): MechJebAscentArgs/MechJebNoArgs live here now,
      // not in Sitrep.Contract.
      "mod/GonogoMechJebUplink.Contract",
    ],
  },
  avionics: {
    // "avionics" alone is distinctive enough (no unrelated-word collision:
    // the one incidental hit, "RP0Avionics" in a GonogoDevTools debug dump,
    // is a real match on a real third-party PartModule name, allowlisted as
    // permanent rather than excluded by the pattern). One case-insensitive
    // pattern covers AvionicsStatus/AvionicsUplink/avionics.status/
    // avionics.available/gonogo-avionics-uplink alike.
    patterns: [/avionics/i],
    ownedDirs: [
      "mod/GonogoAvionicsUplink",
      "mod/GonogoAvionicsUplink.Tests",
      // GonogoAvionicsUplink's own contract slice (uplink-types-out-of-core
      // plan, second relocation, 2026-08-10): AvionicsStatus lives here now,
      // not in Sitrep.Contract.
      "mod/GonogoAvionicsUplink.Contract",
    ],
  },
  kerbalism: {
    // "kerbalism" alone is distinctive enough: no unrelated word in this
    // codebase contains it, and every one of this Uplink's fifteen wire types
    // and five Topic namespaces is prefixed with it. Deliberately NOT the
    // shorter "kerbal": THAT is a colliding token in a Kerbal Space Program
    // codebase (crew members, kerbal names, KerbalX, half the domain
    // vocabulary), which is the same collision the scansat entry above solves
    // by naming its types individually. The full mod name needs no such
    // workaround.
    patterns: [/kerbalism/i],
    ownedDirs: [
      "mod/GonogoKerbalismUplink",
      "mod/GonogoKerbalismUplink.Tests",
      // GonogoKerbalismUplink's own contract slice (uplink-types-out-of-core
      // plan, fifth relocation, 2026-08-11): all fifteen kerbalism payload
      // types live here now, not in Sitrep.Contract.
      "mod/GonogoKerbalismUplink.Contract",
    ],
  },
  // Excluded on purpose (per task scope):
  //   telemachus : legacy system being deleted, not an Uplink; tracked
  //                 as separate migration debt in the audit doc, §5.
  //   commnet    : stock KSP networking, not a third-party mod.
  testflight: {
    // "testflight" is distinctive: no unrelated word in this codebase contains
    // it. The mod models per-engine reliability and registers generically into
    // the "reliability" capability, so core should never name it in code.
    patterns: [/testflight/i],
    ownedDirs: [
      "mod/GonogoTestFlightUplink",
      "mod/GonogoTestFlightUplink.Tests",
    ],
  },
  principia: {
    // The Uplink now EXISTS, so the token finally has an owning directory
    // (2026-08-20). Everything below about why the token was created still
    // stands: outside those two dirs a mention is a violation, and the
    // anticipation pattern the token was written to catch is unchanged.
    //
    // What the Uplink is allowed to know is narrow. It reads assembly presence
    // and version and binds NO member, because Principia's surviving native
    // surface aborts the KSP process on a bad call. So the name lives here and
    // the substantive fact reaches clients as a property of the ANSWER (an
    // integrated trajectory, bounded by a horizon), never as the vendor's
    // identity: see `PropagationHorizon`'s `TrajectoryKind` rather than a
    // provider name on the wire.
    //
    // This token exists because its absence was a blind spot with teeth. A
    // ratchet keyed on "mods we already integrate" cannot see coupling
    // introduced in ANTICIPATION of one we do not, and anticipating is exactly
    // when core is most tempted to name a mod: TargetApproachElection carried a
    // public RegisterPrincipiaProvider, PrincipiaProviderId and
    // PrincipiaPriority for a year without ever being flagged, because no token
    // looked for the string.
    patterns: [/principia/i],
    ownedDirs: ["mod/GonogoPrincipiaUplink", "mod/GonogoPrincipiaUplink.Tests"],
  },
  telemachus: {
    // A RETIRED dependency, not an Uplink. Telemachus stopped being the app's
    // data source in 806e7fe2 and its fork's source is deleted; it survives
    // only as an optional manual debug probe (the `tele` CLI in
    // scripts/gonogo_claude_tools.sh, which this scan never reaches). So
    // ownedDirs is empty for a different reason than principia's: not "no
    // integration directory yet" but "nothing here is its any more".
    //
    // Why this matters enough to gate: the residue is not inert. A dead
    // "No Target Selected." sentinel, which no producer has been able to emit
    // since the fork went, kept a translator alive in core, kept two fixtures
    // encoding its vocabulary, and kept a test asserting behaviour against
    // input nothing can generate. A later widget audit then read those
    // fixtures as current. See
    // local_docs/design/2026-08-17-telemachus-residue-inventory.md.
    //
    // codeOnly, and the tradeoff is deliberate: scanned with comments this
    // token flags 218 files, 159 of which only mention it in prose. A
    // 218-entry allowlist is a directory listing rather than a gate, and it
    // would be tuned into uselessness. So this governs code, and prose is a
    // one-time sweep plus a rule (a Telemachus mention in a comment is past
    // tense and names what replaced it). No regex separates "the Telemachus
    // fork used to do X" from "Telemachus provides X"; only a reader does,
    // and saying so beats pretending a tool can.
    patterns: [/telemachus/i],
    ownedDirs: [],
    codeOnly: true,
  },
};

/**
 * Source with comments removed and STRING LITERALS KEPT.
 *
 * Strings must survive: a module specifier is one, so
 * `export * from "./schemas/telemachus"` is exactly the coupling this exists to
 * catch, and so is user-facing JSX copy that names a retired mod to the
 * operator. (The sibling stripper in `styleguide-earth-day.test.ts` blanks
 * strings as well, correctly for ITS question: a number inside a string is not
 * arithmetic.)
 *
 * TS/TSX goes through esbuild, which is already a dependency of this file,
 * rather than through the hand-rolled fallback below. A character-state machine
 * cannot tell an apostrophe in JSX text (`don't`) from an opening quote, so it
 * desynchronises and then either preserves comments it should have dropped or,
 * worse, blanks the code after them: a gate that silently stops looking. That
 * was not hypothetical, it mis-scanned FuelStatus/index.tsx when this was
 * hand-rolled. A parser has no such failure mode.
 */
function stripCommentsKeepingStrings(source: string, path: string): string {
  if (/\.tsx?$/.test(path)) {
    try {
      const js = transformSync(source, {
        loader: path.endsWith(".tsx") ? "tsx" : "ts",
        format: "esm",
        // Without this, esbuild ELIDES an import whose binding is unused, and
        // an elided import is an invisible one: `import x from
        // "./schemas/telemachus"` would vanish before the pattern ever saw it.
        // Found by a self-test below that was written to check something else.
        tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
      }).code;
      // esbuild makes no promise about dropping every comment and does keep
      // some. Finish with a LINE-BASED pass rather than the character walk
      // below: esbuild turns JSX text into string literals, apostrophes and
      // all, and a state machine desynchronises on them exactly as it did on
      // the source. Dropping whole comment lines cannot desynchronise, and its
      // error direction is right: a trailing `// ...` after code survives, so
      // the worst case is a file flagged and allowlisted, never one silently
      // skipped.
      return js
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
        .join("\n");
    } catch {
      // Unparseable (a fixture, a deliberate syntax-error case): fall through
      // to the approximate stripper rather than skipping the file entirely,
      // because skipping is how a gate goes quiet.
    }
  }
  return stripCommentsApproximately(source);
}

/**
 * The fallback for C# and for anything esbuild will not parse. Same shape as
 * the earth-day stripper, minus the string blanking, and with the same caveat:
 * not a parser, and it can desynchronise on an apostrophe in a comment. Good
 * enough for the C# it actually handles, where an apostrophe only appears in a
 * char literal.
 */
function stripCommentsApproximately(source: string): string {
  let out = "";
  let i = 0;
  let state: "code" | "line" | "block" | "'" | '"' | "`" = "code";
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (state === "code") {
      if (char === "/" && next === "/") {
        state = "line";
        out += "  ";
        i += 2;
        continue;
      }
      if (char === "/" && next === "*") {
        state = "block";
        out += "  ";
        i += 2;
        continue;
      }
      if (char === "'" || char === '"' || char === "`") {
        state = char;
      }
      out += char;
      i += 1;
      continue;
    }
    if (state === "line") {
      if (char === "\n") {
        state = "code";
        out += char;
      } else {
        out += " ";
      }
      i += 1;
      continue;
    }
    if (state === "block") {
      if (char === "*" && next === "/") {
        state = "code";
        out += "  ";
        i += 2;
      } else {
        out += char === "\n" ? char : " ";
        i += 1;
      }
      continue;
    }
    // Inside a string literal: kept verbatim, closing on its own quote and
    // stepping over an escape so a \" does not end it early.
    if (char === "\\") {
      out += source.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (char === state) state = "code";
    out += char;
    i += 1;
  }
  return out;
}

const SCAN_EXTENSIONS = /\.(tsx?|cs)$/;
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "bin",
  "obj",
  "coverage",
  ".turbo",
]);
// This file and its sibling allowlist data module name every mod token in
// their patterns/comments/allowlist entries: that's the guardrail's own
// vocabulary, not a boundary violation.
const SELF_PATHS = new Set([
  "packages/core/src/uplink-boundary.test.ts",
  "packages/core/src/uplink-boundary.allowlist.ts",
]);

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

interface ScannedFile {
  rel: string;
  raw: string;
  /** Comment-stripped source, parsed on FIRST demand and reused after. */
  stripped?: string;
}

/**
 * Every scannable file in the repo, read once.
 *
 * Read once because there are thirteen tokens and there used to be thirteen
 * walks: each `it` re-walked every scan root and re-read every file, so the
 * suite did ~13x the necessary I/O and the whole describe block sat close to the
 * 30s timeout. It went over once the sdk gained the spine directory, and a
 * timeout here is a bad failure to have: the test's real job is to NAME
 * offending files, and a timeout names nothing while looking exactly like a
 * boundary breach in CI.
 *
 * Module-scope, not per-test: the corpus does not change during a run.
 */
let corpus: ScannedFile[] | undefined;
function scanCorpus(root: string): ScannedFile[] {
  if (corpus) return corpus;
  const files: ScannedFile[] = [];
  for (const scanRoot of scanRoots(root)) {
    for (const file of walk(scanRoot)) {
      const rel = relative(root, file);
      if (SELF_PATHS.has(rel)) continue;
      files.push({ rel, raw: readFileSync(file, "utf8") });
    }
  }
  corpus = files;
  return corpus;
}

/** All files (relative to repo root) that reference `token` outside its owning dir. */
function findViolations(root: string, token: ModToken): string[] {
  const { patterns, ownedDirs, codeOnly } = MOD_OWNERSHIP[token];
  const hits: string[] = [];
  for (const file of scanCorpus(root)) {
    if (isUnderOwnedDir(file.rel, ownedDirs)) continue;
    if (!patterns.some((re) => re.test(file.raw))) continue;
    // Only files that mention the token at all are worth parsing, which keeps
    // the esbuild pass to a couple of hundred files rather than every file in
    // the repo. The stripped form is cached on the entry because several tokens
    // are `codeOnly` and would otherwise each re-parse the same file.
    let content = file.raw;
    if (codeOnly) {
      file.stripped ??= stripCommentsKeepingStrings(file.raw, file.rel);
      content = file.stripped;
    }
    if (patterns.some((re) => re.test(content))) hits.push(file.rel);
  }
  return hits;
}

describe("uplink boundary: mod references stay inside their owning Uplink", () => {
  // Read the corpus here, not inside whichever `it` happens to run first.
  //
  // The scan reads every scannable file in the repo, and that cost has to live
  // somewhere. While it lived in the first test, that ONE test paid ~2000 file
  // reads and blew the 30s limit under a parallel full-suite run, reported as
  // "kerbcast: matches the seeded allowlist exactly" timing out: a message that
  // points at a token and an allowlist, neither of which had anything to do with
  // it. A `beforeAll` with its own generous budget names the expensive step, and
  // leaves each token's assertion as the fast comparison it actually is.
  beforeAll(() => {
    scanCorpus(findRepoRoot(dirname(fileURLToPath(import.meta.url))));
  }, 120_000);

  for (const token of Object.keys(MOD_OWNERSHIP) as ModToken[]) {
    it(`${token}: matches the seeded allowlist exactly`, () => {
      const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
      const found = new Set(findViolations(root, token));
      const allowed = new Set([
        ...ALLOWLIST[token].permanent,
        ...ALLOWLIST[token].domainDebt,
      ]);

      const newViolations = [...found].filter((f) => !allowed.has(f));
      const staleEntries = [...allowed].filter((f) => !found.has(f));

      if (newViolations.length > 0) {
        throw new Error(
          `New "${token}" reference(s) found outside ${MOD_OWNERSHIP[token].ownedDirs.join(", ")}:\n` +
            newViolations.map((f) => `  ${f}`).join("\n") +
            `\n\nEither move this code into the owning Uplink dir, or if it's an ` +
            `intentional, reviewed exception (contract/SDK layer, a new test, a ` +
            `sanctioned self-registration import), add it to ALLOWLIST.${token} in ` +
            `packages/core/src/uplink-boundary.allowlist.ts with a comment explaining why. ` +
            `Wire/contract/generated/ratchet-inventory files and text-only doc mentions go in ` +
            `.permanent (unconstrained); real code coupling goes in .domainDebt (shrink-only, ` +
            `see the "domain-debt allowlist entries only ever shrink" test below). ` +
            `See docs/superpowers/specs/2026-07-13-uplink-boundary-audit.md.`,
        );
      }

      if (staleEntries.length > 0) {
        throw new Error(
          `Stale "${token}" allowlist entries: these no longer contain a matching ` +
            `reference (the violation was fixed, or the file moved/was deleted). ` +
            `Delete the line(s) from ALLOWLIST.${token}.permanent or .domainDebt in ` +
            `packages/core/src/uplink-boundary.allowlist.ts to ratchet the gate down:\n` +
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

describe("scansat token: pattern coverage for the schema-identifier blind spot", () => {
  // Representative content shapes for packages/core/src/schemas/scansat.ts's
  // exported wire-shape identifiers (SCANType, SCAN_TYPE, etc.): the class
  // of leak the bare `/scansat/i` pattern was blind to (design doc §1.1-1.2):
  // a file can be scansat-schema-coupled (import/use SCANType, key a cache
  // by SCANType, etc.) without ever spelling the word "scansat".
  const SCHEMA_IDENTIFIER_SAMPLES = [
    "export function useBodyFogMask(bodyId: string, scanType: SCANType) { /* ... */ }",
    "const SCAN_TYPE = { AltimetryLoRes: 1, AltimetryHiRes: 2 } as const;",
    "interface BodyMask { readonly scanType: SCANCoverageBitmap; }",
  ];

  it("catches SCAN-prefixed schema identifiers even with zero 'scansat' text", () => {
    for (const sample of SCHEMA_IDENTIFIER_SAMPLES) {
      // Proves the leak: the old, sole `/scansat/i` pattern would have
      // missed every one of these.
      expect(/scansat/i.test(sample)).toBe(false);
      // Proves the fix: the token's full pattern set (including the two
      // new patterns) catches all of them.
      expect(MOD_OWNERSHIP.scansat.patterns.some((re) => re.test(sample))).toBe(
        true,
      );
    }
  });

  it("does not false-positive on this codebase's unrelated SCAN_ROOTS convention", () => {
    // packages/core/src/styleguide-cleanup.test.ts, styleguide.test.ts, and
    // styleguide-styled-components.test.ts all use SCAN_ROOTS/
    // COMPONENT_SCAN_ROOTS to mean "directories to walk", nothing to do
    // with SCANsat. A bare `/SCAN[A-Z_]/` prefix would have false-matched
    // this; the `[A-Z][a-z]` refinement and the `\bSCAN_TYPE\b` exact-match
    // must not.
    const samples = [
      'const SCAN_ROOTS = ["packages", "mod"];',
      'const COMPONENT_SCAN_ROOTS = ["packages/components/src"];',
    ];
    for (const sample of samples) {
      expect(MOD_OWNERSHIP.scansat.patterns.some((re) => re.test(sample))).toBe(
        false,
      );
    }
  });
});

describe("telemachus token: the code-only scan can still see", () => {
  // An allowlist-shaped assertion is SATISFIED BY FINDING NOTHING, so a
  // scanner that has quietly stopped looking passes it perfectly. That is not
  // hypothetical: the earth-day ratchet's grep used `\b`, which POSIX ERE does
  // not have, so on macOS it matched nothing and reported success for however
  // long nobody checked. These assertions are the difference between "no
  // violations" and "no vision".

  const codeOnly = (source: string, path = "probe.ts") =>
    stripCommentsKeepingStrings(source, path);

  it("drops a mention in a comment", () => {
    expect(
      codeOnly("// the Telemachus fork used to serve this\nconst a = 1;\n"),
    ).not.toMatch(/telemachus/i);
    expect(
      codeOnly("/** Telemachus, historically. */\nconst a = 1;\n"),
    ).not.toMatch(/telemachus/i);
  });

  it("KEEPS a mention in a string, because a module specifier is one", () => {
    // The single most important thing this token catches: core's barrel
    // re-exports the legacy schema, and the only occurrence is inside quotes.
    expect(codeOnly('export * from "./schemas/telemachus";\n')).toMatch(
      /telemachus/i,
    );
    // And user-facing copy, which an operator actually reads on screen.
    expect(
      codeOnly(
        "const hint = <FieldHint>Any Telemachus key that returns a number</FieldHint>;\n",
        "probe.tsx",
      ),
    ).toMatch(/telemachus/i);
  });

  it("survives an apostrophe in JSX text, and keeps an unused import", () => {
    // Two failures in one line, both of which this test found rather than
    // confirmed. A hand-rolled character walk reads the ' in "won't" as an
    // opening quote, desynchronises, and blanks the code after it: the gate
    // stops looking mid-file and says nothing. And esbuild ELIDES an import
    // whose binding is unused unless verbatimModuleSyntax is set, which would
    // have made the one reference shape this token most needs to catch
    // invisible.
    const source =
      'const a = <p>KSP won\'t save here</p>;\nimport x from "./schemas/telemachus";\n';
    expect(codeOnly(source, "probe.tsx")).toMatch(/telemachus/i);
  });

  it("still finds real references in the repo, so a blind scan cannot pass", () => {
    const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
    // Not a specific file: naming one would fail the day its debt is paid,
    // which would punish the migration this gate exists to encourage.
    expect(findViolations(root, "telemachus").length).toBeGreaterThan(0);
  });
});

/**
 * Resolves a git ref to diff the domain-debt allowlist against. Prefers an
 * explicit CI-supplied ref, falls back to origin/main or main for local
 * dev, and returns null (soft-pass) if nothing resolves, mirrors the
 * visual-gate's "no baseline yet" soft-pass posture rather than hard-
 * failing somewhere this can't meaningfully run (a fresh clone with no
 * origin, a detached HEAD, first-land before any base ref exists).
 *
 * UPLINK_ALLOWLIST_BASE_REF is not yet wired into ci.yml; see the design
 * doc §2.8. Until that lands, this check soft-passes in CI (the
 * origin/staging / origin/main / main fallbacks resolve there too, but
 * against whatever commit CI happened to fetch, not a meaningful "previous
 * push" ref) and only truly enforces on a local machine with a real remote.
 *
 * `origin/staging` comes before `origin/main` because branches are cut from
 * staging and land there first, so main trails it by however long a release
 * takes. Resolving to main meant every branch diffed its allowlist against a
 * ref where a recently-added allowlist FILE does not exist yet, which
 * `loadAllowlistAt` reports as the bootstrap case and the caller soft-passes
 * on. A ratchet is at its most load-bearing in the weeks after it lands, and
 * that was exactly the window in which it could not run.
 */
function resolveBaseRef(): string | null {
  const candidates = [
    process.env.UPLINK_ALLOWLIST_BASE_REF,
    process.env.GITHUB_BASE_REF && `origin/${process.env.GITHUB_BASE_REF}`,
    "origin/staging",
    "origin/main",
    "main",
  ].filter((v): v is string => Boolean(v));
  for (const ref of candidates) {
    try {
      execFileSync("git", ["rev-parse", "--verify", ref], { stdio: "ignore" });
      return ref;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * Dynamically loads the allowlist module's exports as they existed at
 * `ref`, without touching the working tree. Transpiles the git blob with
 * esbuild and imports it as a `data:` URL so no temp-file cleanup is
 * needed.
 */
async function loadAllowlistAt(
  ref: string,
  relPath: string,
): Promise<Partial<Record<ModToken, ModAllowlist | string[]>> | null> {
  let source: string;
  try {
    source = execFileSync("git", ["show", `${ref}:${relPath}`], {
      encoding: "utf8",
    });
  } catch {
    return null; // file didn't exist at ref yet, bootstrap case
  }
  const { code } = transformSync(source, { loader: "ts", format: "esm" });
  const mod = await import(`data:text/javascript,${encodeURIComponent(code)}`);
  return mod.ALLOWLIST;
}

/**
 * Pure comparison: which tokens gained a `domainDebt` entry in `current`
 * that wasn't present in `previous`. Shared by the synthetic unit test
 * below (no git/esbuild involved) and the real git-backed check further
 * down, so both exercise the exact same growth rule.
 *
 * `previous` accepts either the current `{ permanent, domainDebt }` shape
 * or the pre-split flat `string[]` shape (bootstrap fallback: the base ref
 * may predate the split entirely). Every entry in a flat `string[]` is
 * treated as "already known" regardless of which new category it landed
 * in: conservative, avoids false-failing the commit that introduces the
 * split itself.
 */
function findDomainDebtGrowth(
  previous: Partial<Record<ModToken, ModAllowlist | string[]>>,
  current: Record<ModToken, ModAllowlist>,
): Array<{ token: ModToken; added: string[] }> {
  const growth: Array<{ token: ModToken; added: string[] }> = [];
  for (const token of Object.keys(current) as ModToken[]) {
    const prevEntry = previous[token];
    const oldDomainDebt = new Set(
      Array.isArray(prevEntry) ? prevEntry : (prevEntry?.domainDebt ?? []),
    );
    const added = current[token].domainDebt.filter(
      (f) => !oldDomainDebt.has(f),
    );
    if (added.length > 0) growth.push({ token, added });
  }
  return growth;
}

describe("findDomainDebtGrowth: shrink-only comparison logic (synthetic fixtures)", () => {
  // Pure-logic unit tests: no git, no esbuild, no filesystem. Proves the
  // growth rule itself is correct in isolation before trusting the
  // git-backed integration test further down to wire it up correctly.
  const base: ModAllowlist = {
    permanent: ["p.ts"],
    domainDebt: ["a.ts", "b.ts"],
  };

  it("flags a token whose domainDebt set gained an entry", () => {
    const previous: Record<ModToken, ModAllowlist> = {
      kerbcast: base,
      scansat: base,
      kos: base,
      realantennas: base,
      agx: base,
    };
    const current: Record<ModToken, ModAllowlist> = {
      ...previous,
      // Synthetic leak: a new file lands in scansat's domainDebt without
      // having been there before: exactly the case the shrink-only gate
      // exists to reject.
      scansat: {
        permanent: ["p.ts"],
        domainDebt: ["a.ts", "b.ts", "new-leak.ts"],
      },
    };

    const growth = findDomainDebtGrowth(previous, current);

    expect(growth).toEqual([{ token: "scansat", added: ["new-leak.ts"] }]);
  });

  it("does not flag a shrink (entry removed) or an unchanged set", () => {
    const previous: Record<ModToken, ModAllowlist> = {
      kerbcast: base,
      scansat: base,
      kos: base,
      realantennas: base,
      agx: base,
    };
    const current: Record<ModToken, ModAllowlist> = {
      ...previous,
      // Ratcheted off: "a.ts" removed, nothing added.
      kerbcast: { permanent: ["p.ts"], domainDebt: ["b.ts"] },
    };

    expect(findDomainDebtGrowth(previous, current)).toEqual([]);
  });

  it("treats every entry in a pre-split flat string[] as already known (bootstrap fallback)", () => {
    const empty: ModAllowlist = { permanent: [], domainDebt: [] };
    const previous: Partial<Record<ModToken, string[]>> = {
      scansat: ["a.ts", "b.ts"],
    };
    const current: Record<ModToken, ModAllowlist> = {
      kerbcast: empty,
      scansat: { permanent: [], domainDebt: ["a.ts", "b.ts"] },
      kos: empty,
      realantennas: empty,
      agx: empty,
    };

    expect(findDomainDebtGrowth(previous, current)).toEqual([]);
  });
});

describe("uplink boundary: domain-debt allowlist entries only ever shrink", () => {
  it("no token's domainDebt set gained an entry vs the base ref", async () => {
    const baseRef = resolveBaseRef();
    if (!baseRef) return; // soft-pass: no comparison ref available

    const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
    const relPath = relative(
      root,
      join(
        dirname(fileURLToPath(import.meta.url)),
        "uplink-boundary.allowlist.ts",
      ),
    );
    const previous = await loadAllowlistAt(baseRef, relPath);
    if (!previous) {
      // Two different situations reach here and only one of them is benign,
      // so say which. "No ref at all" (fresh clone, detached HEAD) is handled
      // above by `resolveBaseRef` returning null. This branch means a ref DID
      // resolve and the allowlist is simply absent at it, which is genuine on
      // a first land and suspicious afterwards: the check is not running, and
      // it looked identical to passing until this line existed.
      console.warn(
        `[uplink-boundary] shrink-only check SKIPPED: ${relPath} does not ` +
          `exist at ${baseRef}, so there is nothing to diff against. Expected ` +
          `on the commit that first adds the allowlist; otherwise the base ref ` +
          `is wrong and no growth is being detected. Set ` +
          `UPLINK_ALLOWLIST_BASE_REF to a ref that has the file.`,
      );
      return;
    }

    const growth = findDomainDebtGrowth(previous, ALLOWLIST);
    if (growth.length > 0) {
      throw new Error(
        growth
          .map(
            ({ token, added }) =>
              `New DOMAIN-DEBT entries for "${token}" vs ${baseRef}, domain-debt ` +
              `entries may only be REMOVED (ratcheted off as code moves into the ` +
              `owning Uplink), never added:\n` +
              added.map((f) => `  ${f}`).join("\n"),
          )
          .join("\n\n") +
          `\n\nIf any of these really is a permanent wire/contract/generated-code ` +
          `or text-only doc-mention reference, move it to ALLOWLIST.<token>.permanent ` +
          `in uplink-boundary.allowlist.ts instead (reviewed edit, unconstrained): ` +
          `don't add it to .domainDebt.`,
      );
    }
  }, 30_000);
});
