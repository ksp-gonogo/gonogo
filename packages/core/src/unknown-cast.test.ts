// @vitest-environment node
//
// Node realm rather than the package's jsdom default, matching `typecheck-coverage.test.ts`: the scan asks `ts.sys` to resolve config files off disk, and the shrink-only half transpiles the debt list at a git ref through esbuild, which wants a real TextEncoder/Uint8Array realm.
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { ratchetBaseRef, sourceAtRatchetBase } from "./ratchetBaseRef";
import {
  DOUBLE_ASSERTION_DEBT,
  ROOT_FILE_FLOORS,
  SCAN_FLOORS,
  UNKNOWN_CAST_DEBT,
} from "./unknown-cast.debt";
import {
  type RootScan,
  SCANNED_PACKAGE_ROOTS,
  scanScratchDir,
  scanUnknownCasts,
  UNSCANNED_PACKAGE_ROOTS,
  unknownCastScanRoots,
} from "./unknown-cast.scan";

/**
 * The gate on assertions that escape `unknown`.
 *
 * The rule, the reasoning and the four categories of debt live in
 * `unknown-cast.scan.ts` and `unknown-cast.debt.ts`. What lives HERE is the
 * question of whether this gate can be trusted, which is four separate things
 * and not one:
 *
 *  1. it catches a planted assertion, in every spelling one can be written in
 *  2. it does NOT flag a legitimate narrow, and the narrow it is tried against
 *     is a real one lifted out of the tree rather than one written to pass
 *  3. it walked the roots and the files it thinks it walked, per root
 *  4. the debt list only ever shrinks
 *
 * The first three are the ones a gate normally lacks. Five ratchets in this repo
 * were found blind in one week: `uplink-isolation` required the token `from` and
 * could not see three of the four import forms; `styleguide-wall-clock` walked
 * one widget root of thirteen and stayed green for months. Both reported the
 * same clean green a working gate reports.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const DEBT_PATH = "packages/core/src/unknown-cast.debt.ts";

/** One scan for the whole file: 25 compiler programs is not a per-test cost. */
const SCANS: RootScan[] = scanUnknownCasts(REPO_ROOT);
const SITES = SCANS.flatMap((scan) => scan.sites);

/** Run the scanner over hand-written files, through the real walk. */
function scanPlanted(files: Record<string, string>): RootScan {
  const dir = mkdtempSync(join(tmpdir(), "unknown-cast-"));
  try {
    const names = Object.entries(files).map(([name, source]) => {
      const abs = join(dir, name);
      writeFileSync(abs, source);
      return abs;
    });
    return scanScratchDir(dir, names);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the gate can see a planted assertion", () => {
  /**
   * Every spelling, because a detector that knows one is a detector that
   * reports clean on the other three. `uplink-isolation` matched imports on the
   * token `from` and was blind to `import("x")`, `require("x")` and a bare
   * `import "x"`, with the gap written down twenty lines below the check.
   *
   * `<T>x` needs its own file: the angle-bracket form is a JSX element in
   * `.tsx`, which is why it is the spelling most likely to be missed.
   *
   * Each nested plant asserts to its OWN named type, so the text the scan
   * reports identifies which plant it came from. Reusing one name made four
   * plants indistinguishable in the report, and the first draft of this test
   * then asked for a needle no site could ever carry.
   */
  const PLANTED = `
    interface Receipt { outcome: number }
    interface InCall { outcome: number }
    interface InGeneric { outcome: number }
    interface Chained { outcome: number }
    declare function take(r: InCall): void;
    declare function id<T>(value: T): T;
    declare const wire: unknown;
    declare const loose: any;

    export const plainAs = wire as Receipt;
    export const outOfAny = loose as Receipt;
    export const doubled = wire as unknown as Receipt;
    export const throughAny = wire as any as Receipt;
    export const parenthesised = (wire as unknown) as Receipt;
    export const inCallArgument = take(wire as InCall);
    export const inGeneric = id<InGeneric>(wire as InGeneric);
    export const chained = (wire as Chained).outcome;
  `;

  const planted = scanPlanted({
    "planted.ts": PLANTED,
    "angle.ts": `
      interface Receipt { outcome: number }
      declare const wire: unknown;
      export const angleBracket = <Receipt>wire;
      export const angleDoubled = <Receipt>(<unknown>wire);
    `,
  });

  const lineOf = (needle: string) =>
    planted.sites.filter((site) => site.text.includes(needle));

  it("caught every spelling", () => {
    // Named individually rather than counted. A total of ten passes when one
    // spelling is missed and another double-counted, and that is precisely the
    // failure this is here to exclude.
    const spellings = {
      "x as T": "wire as Receipt",
      "out of any": "loose as Receipt",
      "x as unknown as T": "wire as unknown as Receipt",
      "x as any as T": "wire as any as Receipt",
      "(x as unknown) as T": "(wire as unknown) as Receipt",
      "<T>x": "<Receipt>wire",
      "<T>(<unknown>x)": "<Receipt>(<unknown>wire)",
    };
    const unseen = Object.entries(spellings)
      .filter(([, needle]) => lineOf(needle).length === 0)
      .map(([name]) => name);
    expect(
      unseen,
      [
        "BLIND: the gate did not see these planted assertions, so it cannot",
        "detect them in the tree either and its clean report on them means",
        "nothing.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("caught the ones nested inside another expression", () => {
    // A walk that stops at statement level finds the top-level plants above and
    // none of these, and the count it reports is a plausible number.
    const nested = {
      "a call argument": "wire as InCall",
      "an explicit generic call": "wire as InGeneric",
      "the object of a property access": "wire as Chained",
    };
    const unseen = Object.entries(nested)
      .filter(([, needle]) => lineOf(needle).length === 0)
      .map(([name]) => name);
    expect(
      unseen,
      "BLIND: the walk did not descend into these positions, so an assertion written in one of them is invisible to it.",
    ).toEqual([]);
  });

  it("tells `as unknown as` apart from a plain assertion", () => {
    const doubles = planted.sites
      .filter((site) => site.double)
      .map((s) => s.text);
    expect(doubles).toContain("wire as unknown as Receipt");
    expect(doubles).toContain("wire as any as Receipt");
    expect(doubles).toContain("(wire as unknown) as Receipt");
    expect(doubles).toContain("<Receipt>(<unknown>wire)");
    // And the plain ones are NOT in it: a classifier that answers "double" to
    // everything would satisfy the three assertions above.
    expect(doubles).not.toContain("wire as Receipt");
  });

  it("tells `any` apart from `unknown`", () => {
    expect(lineOf("loose as Receipt")[0]?.kind).toBe("any");
    expect(lineOf("wire as Receipt")[0]?.kind).toBe("unknown");
  });
});

describe("the gate does not flag a legitimate narrow", () => {
  /**
   * The false-positive half, and the one that decides whether this rule is
   * usable at all.
   *
   * `unknown` is the RIGHT return for a boundary, so a gate that reports every
   * assertion out of one is a gate that punishes the correct design. The
   * subject here is lifted from `mod/GonogoPrincipiaUplink/client/src/planWrite.ts`,
   * the repo's worked example of the remedy: it narrows off `reply.payload`
   * with a `typeof` guard, checks the two fields the contract makes required,
   * and returns null rather than defaulting. Every assertion in it is out of a
   * type the compiler already knows, so there is nothing here to report.
   *
   * This is also the measurement that rules out biome's `noUnsafeTypeAssertion`
   * (nursery, 2.5.9+) as a replacement for this gate. That rule is syntactic and
   * bans every assertion but `as const`: run over this tree it reports 2381
   * sites, and two of them are both halves of the function below.
   */
  const narrowed = scanPlanted({
    "narrow.ts": `
      interface Receipt { outcome: number; refusal: number; replayed?: boolean }

      export function planWriteReceipt(reply: { payload: unknown }): Receipt | null {
        const payload: unknown = reply.payload;
        if (typeof payload !== "object" || payload === null) return null;
        const candidate = payload as Partial<Receipt>;
        if (typeof candidate.outcome !== "number" || typeof candidate.refusal !== "number") {
          return null;
        }
        return candidate as Receipt;
      }

      export function viaPredicate(value: unknown): number | null {
        return isReceipt(value) ? value.outcome : null;
      }
      function isReceipt(value: unknown): value is Receipt {
        return typeof value === "object" && value !== null && "outcome" in value;
      }

      export const tuple = ["value", 1] as const;
      export const widened = (1 as unknown);
      export const inField = { n: 1 } as { n: number };
    `,
  });

  it("reports nothing", () => {
    expect(
      narrowed.sites.map((site) => `${site.line}: ${site.text}`),
      [
        "The gate flagged a checked narrow, an `as const`, a widening, or an",
        "assertion out of a type the compiler already knew.",
        "",
        "Any of those makes the rule unusable: `unknown` is the correct return",
        "for a boundary, and a gate that reports the correct handling of one is",
        "a gate that gets switched off.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("saw the file at all, so the clean result above is not an empty walk", () => {
    // Without this, a scratch directory that failed to compile reports zero
    // sites and passes the assertion above for the wrong reason.
    expect(narrowed.files).toBe(1);
    expect(narrowed.assertions).toBeGreaterThanOrEqual(4);
    expect(narrowed.errorTyped).toBe(0);
  });
});

describe("the walk covered what it claims to have covered", () => {
  it("walked every root, and none of them empty", () => {
    expect(
      SCANS.length,
      `Only ${SCANS.length} roots were walked; the floor is ${SCAN_FLOORS.roots}. The walk lost its input.`,
    ).toBeGreaterThanOrEqual(SCAN_FLOORS.roots);

    const empty = SCANS.filter((scan) => scan.files === 0).map((s) => s.root);
    expect(
      empty,
      "These roots walked no files at all. A root the scan cannot see reports clean for the same reason a clean root does.",
    ).toEqual([]);

    const thin = SCANS.filter(
      (scan) => scan.files < (ROOT_FILE_FLOORS[scan.root] ?? 1),
    ).map(
      (s) => `${s.root}: ${s.files} files, floor ${ROOT_FILE_FLOORS[s.root]}`,
    );
    expect(
      thin,
      [
        "These roots walked fewer files than their floor. A whole-tree total",
        "cannot see this: with packages/components at 652 files, an Uplink",
        "client collapsing to zero moves the total by 2%.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("walked the files and saw the assertions it expects to", () => {
    const files = SCANS.reduce((n, scan) => n + scan.files, 0);
    expect(files).toBeGreaterThanOrEqual(SCAN_FLOORS.files);
    // Every non-`const` assertion, offending or not. It holds steady as the
    // debt falls, so it stays a live instrument after the list reaches zero,
    // which a floor under the debt itself could not.
    const assertions = SCANS.reduce((n, scan) => n + scan.assertions, 0);
    expect(assertions).toBeGreaterThanOrEqual(SCAN_FLOORS.assertions);
  });

  it("resolved every program it built", () => {
    // The types are the whole instrument. An unresolved import makes everything
    // reached through it the ERROR type, which the scan skips, so a half-built
    // tree quietly reports a smaller census.
    const broken = SCANS.filter(
      (scan) => scan.errorTyped > 0 || scan.unresolvedImports.length > 0,
    ).map(
      (scan) =>
        `${scan.root}: ${scan.errorTyped} error-typed, ${scan.unresolvedImports.length} unresolved (${scan.unresolvedImports.slice(0, 3).join(", ")})`,
    );
    expect(
      broken,
      [
        "These roots did not fully resolve, so their census is a census of the",
        "build rather than of the code. Run `pnpm build` first; in CI this task",
        "depends on `^build`, so a failure here means a real resolution bug.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("leaves no packages/* outside the rule by accident", () => {
    const onDisk = readdirSync(join(REPO_ROOT, "packages"))
      .map((name) => `packages/${name}`)
      .filter((rel) => existsSync(join(REPO_ROOT, rel, "tsconfig.json")))
      .sort();
    const accounted = new Set<string>([
      ...SCANNED_PACKAGE_ROOTS,
      ...UNSCANNED_PACKAGE_ROOTS.map((entry) => entry.path),
    ]);
    expect(
      onDisk.filter((rel) => !accounted.has(rel)),
      [
        "A package carries a tsconfig.json and is neither scanned nor named in",
        "UNSCANNED_PACKAGE_ROOTS. Add it to one of them: a package outside the",
        "scan is a package outside the rule, and nothing else would say so.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("covers every Uplink client and the sdk", () => {
    // The mod roots are DISCOVERED, which is right and is not self-checking:
    // a discovery that stops matching returns a shorter list, never an error.
    const roots = unknownCastScanRoots(REPO_ROOT);
    expect(roots).toContain("mod/sitrep-sdk");
    const clients = readdirSync(join(REPO_ROOT, "mod"))
      .filter((name) =>
        existsSync(join(REPO_ROOT, "mod", name, "client", "tsconfig.json")),
      )
      .map((name) => `mod/${name}/client`);
    expect(clients.length).toBeGreaterThanOrEqual(10);
    expect(
      clients.filter((rel) => !roots.includes(rel)),
      "An Uplink client has a tsconfig.json and is not in the scan.",
    ).toEqual([]);
  });
});

describe("no new assertion escapes unknown", () => {
  /** Offending sites per file, the same shape the debt list is written in. */
  const perFile = (predicate: (site: (typeof SITES)[number]) => boolean) => {
    const out = new Map<string, number>();
    for (const site of SITES)
      if (predicate(site)) out.set(site.file, (out.get(site.file) ?? 0) + 1);
    return out;
  };

  const REMEDY = [
    "",
    "NARROW IT, do not silence it. `unknown` is the right type for a boundary;",
    "what is wrong is leaving it by assertion. Three ways out, in order of",
    "preference:",
    "",
    "  - check the fields you are about to read and return `null` when they are",
    "    absent, rather than defaulting. `planWriteReceipt` in",
    "    mod/GonogoPrincipiaUplink/client/src/planWrite.ts is the worked example",
    "  - a type predicate (`value is Receipt`) when more than one caller needs",
    "    the same narrow",
    "  - the generated contract map, when the shape is one the contract already",
    "    describes",
    "",
    "If you are certain the assertion is right, it still needs an entry in",
    "unknown-cast.debt.ts, and that list is shrink-only and seeded with what",
    "already existed: adding to it fails against the base ref.",
  ].join("\n");

  it("no file carries more than its ceiling", () => {
    const over: string[] = [];
    for (const [file, count] of perFile(() => true)) {
      const ceiling = UNKNOWN_CAST_DEBT[file] ?? 0;
      if (count <= ceiling) continue;
      const examples = SITES.filter((site) => site.file === file)
        .slice(0, 4)
        .map((site) => `      ${file}:${site.line}  ${site.text}`);
      over.push(
        `  ${file}: ${count} assertions out of unknown/any, ceiling ${ceiling}\n${examples.join("\n")}`,
      );
    }
    expect(over.join("\n"), REMEDY).toBe("");
  });

  it("no file carries more `as unknown as` than its own ceiling", () => {
    // A second, tighter list on purpose. A file with headroom under the count
    // above must still not gain a double: the double exists only because the
    // compiler already refused the conversion once, and refusing it was the
    // compiler being right.
    const over: string[] = [];
    for (const [file, count] of perFile((site) => site.double)) {
      const ceiling = DOUBLE_ASSERTION_DEBT[file] ?? 0;
      if (count <= ceiling) continue;
      const examples = SITES.filter((site) => site.file === file && site.double)
        .slice(0, 4)
        .map((site) => `      ${file}:${site.line}  ${site.text}`);
      over.push(
        `  ${file}: ${count} \`as unknown as\`, ceiling ${ceiling}\n${examples.join("\n")}`,
      );
    }
    expect(over.join("\n"), REMEDY).toBe("");
  });

  it("has no stale debt entry", () => {
    const live = perFile(() => true);
    const stale = Object.entries(UNKNOWN_CAST_DEBT)
      .filter(([file, ceiling]) => (live.get(file) ?? 0) < ceiling)
      .map(
        ([file, ceiling]) =>
          `  ${file}: ${live.get(file) ?? 0} left, listed at ${ceiling}`,
      );
    expect(
      stale.join("\n"),
      [
        "These entries are higher than what is left, so they are carrying",
        "headroom nobody asked for: a file listed at 7 with 3 left can regain 4",
        "without the gate saying anything.",
        "",
        "Regenerate in the same commit as the fix:",
        "  node scripts/unknown-cast-debt.mjs --update",
      ].join("\n"),
    ).toBe("");
  });

  it("has no debt entry for a file that is gone", () => {
    const known = new Set(
      SCANS.flatMap((scan) => scan.sites).map((s) => s.file),
    );
    const vanished = Object.keys(UNKNOWN_CAST_DEBT).filter(
      (file) => !known.has(file) && !existsSync(join(REPO_ROOT, file)),
    );
    expect(
      vanished,
      "These debt entries name a file that no longer exists. Delete them; a list nobody has to prune becomes archaeology.",
    ).toEqual([]);
  });

  it("keeps the two lists consistent", () => {
    // A double is also an assertion out of unknown, so its file must appear in
    // both, with the double count no higher. Two lists that can disagree are
    // two lists where the looser one silently wins.
    const inconsistent = Object.entries(DOUBLE_ASSERTION_DEBT)
      .filter(([file, doubles]) => (UNKNOWN_CAST_DEBT[file] ?? 0) < doubles)
      .map(([file]) => file);
    expect(
      inconsistent,
      "A file's `as unknown as` ceiling is higher than its total ceiling, which cannot be true of any real tree.",
    ).toEqual([]);
  });
});

describe("the debt list only ever shrinks", () => {
  /**
   * The lists as they stood at the ratchet base.
   *
   * `ratchetBaseRef` THROWS when no base can be reached, and that throw failing
   * this test is the intended behaviour: every one of the five original
   * shrink-only gates caught it, returned early, and reported green without
   * comparing anything. `undefined` here means only that the checkout IS the
   * base or that the list did not exist there, and `ratchet-base-ref.test.ts`
   * grades the second case separately.
   */
  function baseLists():
    | {
        ref: string;
        total: Record<string, number>;
        doubles: Record<string, number>;
      }
    | undefined {
    const at = ratchetBaseRef();
    if (!at) return undefined;
    const source = sourceAtRatchetBase(at, DEBT_PATH);
    if (source === null) return undefined;
    const js = transformSync(source, { loader: "ts", format: "cjs" }).code;
    const module_ = { exports: {} as Record<string, unknown> };
    new Function("module", "exports", js)(module_, module_.exports);
    const total = asCounts(module_.exports.UNKNOWN_CAST_DEBT);
    const doubles = asCounts(module_.exports.DOUBLE_ASSERTION_DEBT);
    return total && doubles ? { ref: at.ref, total, doubles } : undefined;
  }

  /**
   * A debt list read out of a git blob, narrowed rather than asserted.
   *
   * This gate found its own first draft, which reached for the shape every
   * other shrink-only ratchet here reaches for: `module_.exports.X as
   * Record<string, number>`. That is the exact defect the gate is about. It is
   * also not pedantry: the value comes from evaluating a file at an arbitrary
   * revision, so "the export is there and holds numbers" is a claim about
   * history, and the assertion made it silently. A base whose list had a
   * different shape would have graded as unchanged.
   */
  function asCounts(value: unknown): Record<string, number> | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const out: Record<string, number> = {};
    for (const [file, count] of Object.entries(value)) {
      if (typeof count !== "number") return undefined;
      out[file] = count;
    }
    return out;
  }

  function grade(
    now: Record<string, number>,
    before: Record<string, number>,
    ref: string,
    what: string,
  ): void {
    const grown = Object.entries(now)
      .filter(([file, count]) => count > (before[file] ?? 0))
      .map(([file, count]) => `  ${file}: ${before[file] ?? 0} -> ${count}`);
    expect(
      grown.join("\n"),
      [
        `The ${what} debt grew against ${ref}. Entries may be lowered or`,
        "deleted, never added or raised; a file that newly asserts out of",
        "`unknown` is the regression this gate exists to stop.",
        "",
        "Narrow the value instead. See the failure message on the ceiling check",
        "for the three ways out.",
      ].join("\n"),
    ).toBe("");
  }

  it("gains no entry and raises none, vs the base ref", () => {
    const at = baseLists();
    if (!at) {
      // Absent at the base: this is the seeding commit, or a branch cut before
      // the list landed. Every entry is the seed and there is nothing to grade.
      expect(true).toBe(true);
      return;
    }
    grade(UNKNOWN_CAST_DEBT, at.total, at.ref, "unknown-cast");
    grade(DOUBLE_ASSERTION_DEBT, at.doubles, at.ref, "`as unknown as`");
  });
});
