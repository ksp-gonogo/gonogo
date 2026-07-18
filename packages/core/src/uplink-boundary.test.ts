// @vitest-environment node
//
// This suite needs the real Node TextEncoder/Uint8Array realm, not jsdom's
// (the package default) — esbuild's `transformSync`, used by the shrink-only
// check below, asserts `new TextEncoder().encode("") instanceof Uint8Array`
// and throws "JavaScript environment is broken" under jsdom, where that
// realm doesn't line up. Nothing else in this file touches the DOM.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import {
  ALLOWLIST,
  type ModAllowlist,
  type ModToken,
} from "./uplink-boundary.allowlist";

/**
 * Uplink-boundary guardrail: prevent mod names/types leaking outside the
 * package that owns their integration ("Uplink"). Ratchet-style, same
 * shape as `styleguide.test.ts`'s hex-literal gate — but per-file instead
 * of per-count, because a boundary violation is "this specific file
 * imports/references a mod it doesn't own", not a fungible occurrence.
 *
 * Full catalogue, categorisation (HARD / gray / test / comment-only), and
 * the reasoning behind every entry:
 *   docs/superpowers/specs/2026-07-13-uplink-boundary-audit.md
 *   docs/superpowers/specs/2026-07-18-ratchet-hardening-design.md
 * The allowlist data itself lives in the sibling `uplink-boundary.allowlist.ts`
 * module (permanent vs shrink-only domainDebt entries — see that file's header).
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
 * IMPORTANT — this is a content scan, not an import scan: `findViolations`
 * regex-tests each file's raw text, so a string LITERAL (e.g. a `layerId`
 * hardcoded as `"scansat:AltimetryHiRes"` in a shared-package fixture) is
 * caught by the exact same pattern that catches a real `import`. Don't
 * assume this ratchet is import-only — genericise example mod-name
 * strings in shared packages the same way commit `fcb770f1` did, rather
 * than expecting this gate to be blind to them.
 *
 * A second, independent test below (`domain-debt allowlist entries only
 * ever shrink`) enforces that `ALLOWLIST[token].domainDebt` never gains an
 * entry vs. a base git ref — see its own doc-comment for details. The
 * `permanent` bucket has no such gate; add/remove freely via reviewed edit.
 */

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
    patterns: [
      /scansat/i,
      // packages/core/src/schemas/scansat.ts's exported wire-shape
      // identifiers: SCANType, SCANCoverageBitmap, SCANHeightGrid,
      // SCANBiomeEntry, SCANBiomeGrid, SCANSensorEntry, SCANScanningVessel,
      // SCANAnomalyEntry. Requires an uppercase letter THEN a lowercase
      // letter immediately after "SCAN" (a real word start), not a bare
      // "SCAN" prefix — a bare prefix collides with this codebase's
      // unrelated "SCAN_ROOTS" / "COMPONENT_SCAN_ROOTS" convention (three
      // ratchet tests use "SCAN_ROOTS" to mean "directories to walk"). See
      // docs/superpowers/specs/2026-07-18-ratchet-hardening-design.md §1.3.
      /\bSCAN[A-Z][a-z]/,
      // The SCAN_TYPE const specifically — doesn't match the above pattern
      // (underscore, not an uppercase letter, follows "SCAN"). \b on both
      // ends so it doesn't match inside "FOG_SCAN_TYPES" or similar.
      /\bSCAN_TYPE\b/,
    ],
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
// their patterns/comments/allowlist entries — that's the guardrail's own
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

/** All files (relative to repo root) that reference `token` outside its owning dir. */
function findViolations(root: string, token: ModToken): string[] {
  const { patterns, ownedDirs } = MOD_OWNERSHIP[token];
  const hits: string[] = [];
  for (const scanRoot of scanRoots(root)) {
    for (const file of walk(scanRoot)) {
      const rel = relative(root, file);
      if (SELF_PATHS.has(rel)) continue;
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
            `.permanent (unconstrained); real code coupling goes in .domainDebt (shrink-only — ` +
            `see the "domain-debt allowlist entries only ever shrink" test below). ` +
            `See docs/superpowers/specs/2026-07-13-uplink-boundary-audit.md.`,
        );
      }

      if (staleEntries.length > 0) {
        throw new Error(
          `Stale "${token}" allowlist entries — these no longer contain a matching ` +
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
  // exported wire-shape identifiers (SCANType, SCAN_TYPE, etc.) — the class
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
    // COMPONENT_SCAN_ROOTS to mean "directories to walk" — nothing to do
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

/**
 * Resolves a git ref to diff the domain-debt allowlist against. Prefers an
 * explicit CI-supplied ref, falls back to origin/main or main for local
 * dev, and returns null (soft-pass) if nothing resolves — mirrors the
 * visual-gate's "no baseline yet" soft-pass posture rather than hard-
 * failing somewhere this can't meaningfully run (a fresh clone with no
 * origin, a detached HEAD, first-land before any base ref exists).
 *
 * UPLINK_ALLOWLIST_BASE_REF is not yet wired into ci.yml — see the design
 * doc §2.8. Until that lands, this check soft-passes in CI (the
 * origin/main / main fallbacks resolve there too, but against whatever
 * commit CI happened to fetch, not a meaningful "previous push" ref) and
 * only truly enforces on a local machine with a real origin/main.
 */
function resolveBaseRef(): string | null {
  const candidates = [
    process.env.UPLINK_ALLOWLIST_BASE_REF,
    process.env.GITHUB_BASE_REF && `origin/${process.env.GITHUB_BASE_REF}`,
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
    return null; // file didn't exist at ref yet — bootstrap case
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
 * in — conservative, avoids false-failing the commit that introduces the
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
  // Pure-logic unit tests — no git, no esbuild, no filesystem. Proves the
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
      // having been there before — exactly the case the shrink-only gate
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
    if (!baseRef) return; // soft-pass — no comparison ref available

    const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
    const relPath = relative(
      root,
      join(
        dirname(fileURLToPath(import.meta.url)),
        "uplink-boundary.allowlist.ts",
      ),
    );
    const previous = await loadAllowlistAt(baseRef, relPath);
    if (!previous) return; // allowlist didn't exist at base ref — bootstrap case

    const growth = findDomainDebtGrowth(previous, ALLOWLIST);
    if (growth.length > 0) {
      throw new Error(
        growth
          .map(
            ({ token, added }) =>
              `New DOMAIN-DEBT entries for "${token}" vs ${baseRef} — domain-debt ` +
              `entries may only be REMOVED (ratcheted off as code moves into the ` +
              `owning Uplink), never added:\n` +
              added.map((f) => `  ${f}`).join("\n"),
          )
          .join("\n\n") +
          `\n\nIf any of these really is a permanent wire/contract/generated-code ` +
          `or text-only doc-mention reference, move it to ALLOWLIST.<token>.permanent ` +
          `in uplink-boundary.allowlist.ts instead (reviewed edit, unconstrained) — ` +
          `don't add it to .domainDebt.`,
      );
    }
  }, 30_000);
});
