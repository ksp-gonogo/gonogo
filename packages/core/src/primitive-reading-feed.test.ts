import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  debtUnitOf,
  splitFindingsAgainstBase,
  splitLaunderingFindings,
} from "./debt-split-guard";
import { DERIVED_FEED_DEBT } from "./primitive-reading-feed.debt";
import {
  type FeedScan,
  primitiveFeedScanRoots,
  scanPrimitiveReadingFeed,
  scanProgram,
  scanScratchDir,
} from "./primitive-reading-feed.scan";
import { ratchetBaseRef } from "./ratchetBaseRef";
import { rootsInScope, scanScope } from "./scanScope";

/**
 * The gate on a primitive being handed a reading's value instead of the
 * reading.
 *
 * The rule and its reasoning live in `primitive-reading-feed.scan.ts`. What
 * lives HERE is whether this gate can be trusted, which is five things:
 *
 *  1. it catches a planted unwrap, in each spelling one can be written in
 *  2. it catches one written against the REAL `Reading` and the REAL `Unit`,
 *     not only against a hand-written lookalike that satisfies the rule by
 *     construction
 *  3. it does NOT flag the two shapes that are correct, and those are lifted
 *     from what the tree really does rather than written to pass
 *  4. it walked the roots AND the individual files it thinks it walked
 *  5. the tree is at zero, and stays there
 *
 * The tree being at zero TODAY is exactly why 1 and 2 matter more than 5 here. A
 * gate with nothing to find reports the same green whether it works or not,
 * and this one was written against a tree that gives it nothing: the text
 * scan it replaces also reported zero, and would have gone on reporting zero
 * through the `const` spelling.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

const SCOPE = scanScope();
/** Every root the gate knows, whether or not this run builds its program. */
const ALL_ROOTS = primitiveFeedScanRoots(REPO_ROOT);
/** Every root in the full run; the roots holding a changed file otherwise. */
const ROOTS = rootsInScope(ALL_ROOTS);
const inBuiltRoot = (file: string): boolean =>
  ROOTS.some((root) => file.startsWith(`${root}/`));

/** One scan for the whole file: 25 compiler programs is not a per-test cost. */
const SCANS: FeedScan[] = scanPrimitiveReadingFeed(REPO_ROOT, ROOTS);
const SITES = SCANS.flatMap((scan) => scan.sites);

/**
 * Files that use a primitive and are in NO package's tsconfig, each with why.
 *
 * Not a tolerance: a written-down hole. These files are unreachable by this
 * gate AND by `pnpm typecheck`, and that costs something measurable rather
 * than in theory. Wiring `ui-kit/scripts` into a project by hand, against the
 * in-progress ticket 257 part 2 tree that narrows `Unit`'s prop to the per-value
 * `Reading`, surfaced four errors in `render-unit-currency.entry.tsx` (lines
 * 197, 397, 406, 416) where that fixture still minted a `TopicReading`. On
 * THIS tree the file is consistent and those errors do not exist yet; they
 * arrive with part 2, and nothing part 2's author runs would show them.
 *
 * The entries stay because the render entry points need a `tsconfig` of their
 * own to be checked at all. They are Node scripts, so it needs `types:
 * ["node"]` and `allowImportingTsExtensions`, and ui-kit's own config cannot
 * take them: its `rootDir` is `./src` and it emits a dist. That is its own
 * piece of work, filed rather than smuggled in here.
 */
const OUTSIDE_EVERY_PROJECT: Record<string, string> = {
  "packages/components/fixtures/primitive-reading-feed-plant.tsx":
    "this gate's own planted violation, deliberately outside the walk so the tree's zero is not its own. Compiled on purpose by the real-types check above.",
  "packages/components/scripts/render-altitude-band.entry.tsx":
    "a render harness entry: `components/tsconfig.json` includes `src` and `scripts/**/*.test.ts` only.",
  "packages/ui-kit/scripts/render-meter-bands.entry.tsx":
    "a render harness entry: `ui-kit/tsconfig.json` includes `src` only, and its `rootDir`/`outDir` cannot take `scripts`.",
  "packages/ui-kit/scripts/render-go-mark.entry.tsx":
    "a render harness entry, the same as render-meter-bands.",
  "packages/ui-kit/scripts/render-unit-currency.entry.tsx":
    "the same. This is the file whose four errors the coverage check found against the in-progress part 2 tree; they are part 2's to fix, the hole is this list's.",
};

/**
 * A self-contained world: a reading, a value, and a primitive that takes
 * either.
 *
 * It declares its own JSX namespace and is compiled with `jsx: preserve` so
 * the plant needs no `react` on disk to resolve. What it must share with the
 * real tree is the SHAPE the rule keys on (the two currency members), not the
 * import graph.
 */
const WORLD = `
  declare global {
    namespace JSX {
      interface Element {}
      interface IntrinsicElements { [name: string]: unknown }
    }
  }

  export interface Value<U extends string> { magnitude: number; unit: U }
  export interface Reading<V> {
    state: "observed" | "held" | "absent";
    value?: V;
    reckoning: { status: "none" };
  }

  /** Widened exactly as \`Unit\` and \`Meter\` are. */
  export declare function Unit<U extends string>(
    props: { value: Value<U> | Reading<Value<U>> | null },
  ): JSX.Element;

  /** A prop that never offered to carry the currency. */
  export declare function Plain<U extends string>(
    props: { value: Value<U> | null },
  ): JSX.Element;

  export declare const altitude: Reading<Value<"m">>;
  export declare const definite: Value<"m">;

  /** A reading carrying an ARRAY, for the laundered-through-a-callback shape. */
  export interface Upkeep { sources: { amount: Value<"f"> }[] }
  export declare const upkeep: Reading<Upkeep>;
`;

/** Run the scanner over hand-written files, through the real walk. */
function scanPlanted(files: Record<string, string>): FeedScan {
  const dir = mkdtempSync(join(tmpdir(), "primitive-reading-feed-"));
  try {
    const names = Object.entries({ "world.ts": WORLD, ...files }).map(
      ([name, source]) => {
        const abs = join(dir, name);
        writeFileSync(abs, source);
        return abs;
      },
    );
    return scanScratchDir(dir, names, { jsx: ts.JsxEmit.Preserve });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the gate can see a planted unwrap", () => {
  /**
   * Both spellings, because a detector that knows only the inline one is a
   * detector that reports clean the moment somebody names the value. That is
   * not a contrived worry: pulling the value out to a `const` is what a call
   * site does the first time the reading's optional `value` needs a default.
   */
  const PLANTED = `
    import { altitude, Unit } from "./world";

    const named = altitude.value;

    export const inline = <Unit value={altitude.value} />;
    export const throughConst = <Unit value={named} />;
  `;

  const scan = scanPlanted({ "planted.tsx": PLANTED });

  it("reports both spellings", () => {
    expect(scan.sites.map((s) => s.via).sort()).toEqual(["const", "direct"]);
  });

  it("names the element and the prop, so the report is actionable", () => {
    expect(scan.sites.every((s) => s.element === "Unit")).toBe(true);
    expect(scan.sites.every((s) => s.prop === "value")).toBe(true);
  });

  it("read types that resolved, so the verdict is not a build artefact", () => {
    expect(scan.errorTyped).toBe(0);
  });
});

describe("the gate can see a plant written against the REAL types", () => {
  /**
   * The check the synthetic plant above cannot make.
   *
   * A hand-written `interface Reading` is reading-shaped by construction, so
   * the plants above prove the predicate agrees with itself. This one compiles
   * the sdk's own `Reading`, reached the way a widget reaches it (through the
   * field property on a `TopicReading`), into `Unit`'s own widened prop.
   *
   * It caught a real blindness on its first run and is here because of it: a
   * plant plausibly placed in `packages/components/scripts/` was not seen at
   * all, because that directory is outside the package's tsconfig `include`
   * and so outside every program the walk builds. The gate reported eleven
   * green tests over a tree with a live violation in it. See the coverage
   * test below, which now states that limit rather than leaving it to be
   * rediscovered.
   */
  const FIXTURE = join(
    REPO_ROOT,
    "packages/components/fixtures/primitive-reading-feed-plant.tsx",
  );

  const scan = ((): FeedScan => {
    const configPath = join(REPO_ROOT, "packages/components/tsconfig.json");
    const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: () => {},
    } as ts.ParseConfigFileHost);
    if (!parsed) throw new Error("components/tsconfig.json would not parse");
    const program = ts.createProgram({
      rootNames: [FIXTURE],
      options: { ...parsed.options, noEmit: true },
    });
    return scanProgram(
      program,
      REPO_ROOT,
      "fixture",
      join(REPO_ROOT, "packages/components/fixtures/"),
    );
  })();

  it("reports every spelling against the sdk's own Reading", () => {
    expect(scan.sites.map((s) => s.via).sort()).toEqual([
      "const",
      "derived",
      "derived",
      "derived",
      "derived",
      "direct",
    ]);
  });

  it("leaves the reading passed whole alone", () => {
    expect(scan.sites).toHaveLength(6);
    expect(scan.readingProps).toBe(10);
  });

  /**
   * The exemptions, asserted by WHICH plant is reported rather than by how
   * many. A count alone passes an exemption that swallows the fault beside it,
   * which is the failure mode the whole fixture is arranged to expose: each
   * exempt shape sits one hop from a real unwrap of the same reading.
   */
  it("exempts the currency and the model, and still catches the value", () => {
    const reported = scan.sites.map((s) => s.text).join("\n");

    // The age through the accessor, the instant as a member, the model's figure.
    expect(reported).not.toContain("ageSec");
    expect(reported).not.toContain("stampSec");
    expect(reported).not.toContain("modelled");

    /*
     * The value derived through a METHOD CALL on it, and a local helper that
     * merely borrows the accessor's NAME. Both sit on the same reading as the
     * exemptions above, so an exemption that over-reached would swallow them.
     */
    expect(reported).toContain("doubled");
    expect(reported).toContain("observedAt(altitude)");
  });

  it("resolved ui-kit and the sdk, so the verdict is about the types", () => {
    expect(scan.errorTyped).toBe(0);
  });
});

describe("the gate does not flag what is correct", () => {
  /**
   * The two false-positive controls, both real shapes.
   *
   * The reading passed whole is the thing the rule is FOR. The definite
   * `Value` case: where a definite `Value` is what is needed, taking a
   * `Value` is right, and a gate that failed it would be a gate that had to
   * be turned off within a day.
   */
  const CONTROL = `
    import { altitude, definite, Plain, Unit } from "./world";

    export const whole = <Unit value={altitude} />;
    export const ruling7 = <Unit value={definite} />;
    export const notAReadingProp = <Plain value={definite} />;
  `;

  const scan = scanPlanted({ "control.tsx": CONTROL });

  it("reports nothing", () => {
    expect(scan.sites).toEqual([]);
  });

  it("still saw the reading-accepting props it declined to flag", () => {
    expect(scan.readingProps).toBe(2);
  });
});

describe("the walk covered what it claims", () => {
  it("built a program for every root", () => {
    console.info(
      `[primitive-reading-feed] ${SCOPE.label}, built ${ROOTS.length} of ${ALL_ROOTS.length} roots: ${ROOTS.join(", ")}`,
    );
    expect(SCANS.map((s) => s.root)).toEqual(ROOTS);
    if (SCOPE.mode === "full") expect(ROOTS).toEqual(ALL_ROOTS);
  });

  it("found source files in every root", () => {
    const empty = SCANS.filter((s) => s.files === 0).map((s) => s.root);
    expect(empty).toEqual([]);
  });

  /**
   * The roots as git tracks them, read from a source that shares nothing with
   * the directory walk that produced them.
   */
  it("walked every mod root git knows about", () => {
    const tracked = new Set(
      execFileSync(
        "git",
        ["ls-files", "mod/*/tsconfig.json", "mod/*/client/tsconfig.json"],
        { cwd: REPO_ROOT, encoding: "utf8" },
      )
        .split("\n")
        .filter(Boolean)
        .map((p) => dirname(p)),
    );
    // Against the enumeration, which is whole-tree on every run; the full run asserts above that the walk is exactly the enumeration.
    const walked = new Set(ALL_ROOTS);
    const missed = [...tracked].filter(
      (root) => !walked.has(root) && !walked.has(`${root}/client`),
    );
    expect(missed).toEqual([]);
  });

  it("saw reading-accepting props somewhere, or it is looking at nothing", () => {
    // A census of the tree, which a run over a few roots is not.
    if (SCOPE.mode === "changed") return;
    const total = SCANS.reduce((n, s) => n + s.readingProps, 0);
    expect(total).toBeGreaterThan(0);
  });

  /**
   * Every tracked file that names a primitive is in a program.
   *
   * This is the check the gate was missing, and it was missing it while
   * reporting green: a violation planted in
   * `packages/components/scripts/render-altitude-band.entry.tsx` was not seen,
   * because that package's tsconfig includes `src` and `scripts/**\/*.test.ts`
   * and nothing else, so the render entry points are in NO package's project
   * graph. That is the same shape as the defect that broke staging on ticket 257
   * part 1: the authoring guide's examples compile under their own CI step and
   * are likewise in no project, so every suite and a full uncached typecheck
   * were green while the guide was broken.
   *
   * Grading the walk against `git ls-files` rather than against the walk means
   * a file that falls out of a tsconfig fails HERE, naming itself, instead of
   * quietly leaving the rule.
   */
  it("walked every tracked file that names a primitive", () => {
    const walked = new Set(SCANS.flatMap((s) => s.fileNames));
    const tracked = execFileSync("git", ["ls-files", "*.tsx"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);

    const inScope = tracked.filter(inBuiltRoot);
    const namesAPrimitive = inScope.filter((f) =>
      /<(Unit|Meter)\b/.test(readFileSync(join(REPO_ROOT, f), "utf8")),
    );
    const unwalked = namesAPrimitive.filter((f) => !walked.has(f));

    expect(
      unwalked.filter((f) => !(f in OUTSIDE_EVERY_PROJECT)),
      "these files use a primitive and are in no package's tsconfig, so the " +
        "gate cannot see them. Add them to that package's `include`, or name " +
        "them in OUTSIDE_EVERY_PROJECT with the reason.",
    ).toEqual([]);
  });

  /**
   * The list only shrinks: an entry whose file has rejoined a project is an
   * entry that must go, or the next file to fall out inherits its excuse.
   */
  it("keeps no excuse for a file that is now walked", () => {
    const walked = new Set(SCANS.flatMap((s) => s.fileNames));
    const stale = Object.keys(OUTSIDE_EVERY_PROJECT).filter((f) =>
      walked.has(f),
    );
    expect(stale).toEqual([]);
  });

  /**
   * An unresolved program types everything as ERROR, and a scan reading those
   * reports whatever it likes. Failing here names the build step that fixes it
   * rather than absorbing the condition.
   */
  it("resolved the types it read", () => {
    const unresolved = SCANS.filter((s) => s.errorTyped > 0).map(
      (s) => `${s.root}: ${s.errorTyped}`,
    );
    expect(
      unresolved,
      "run `pnpm build` first: the scan read unresolved types",
    ).toEqual([]);
  });
});

describe("no primitive is fed a reading's value instead of the reading", () => {
  /**
   * Held to zero with no debt list. The tree has never had one of these, so
   * there is nothing to excuse, and a list seeded empty is a list that invites
   * the first entry.
   *
   * This is the UNWRAP, and only the unwrap: `<Unit value={reading.value} />`
   * in the two spellings it can be written in. The weaker relative, a figure
   * whose provenance is a reading but which arrived through arithmetic or a
   * helper, is a different fault with a different fix and is held separately
   * below. Folding the two together would have left this assertion at 56 on
   * the day it was written, which is another way of saying it would have been
   * deleted.
   */
  it("has no unwrapped feed anywhere", () => {
    expect(
      SITES.filter((s) => s.via !== "derived").map(
        (s) => `${s.file}:${s.line} <${s.element} ${s.text}`,
      ),
    ).toEqual([]);
  });
});

describe("no primitive is fed a figure a reading's currency was dropped from", () => {
  const derived = SITES.filter((s) => s.via === "derived");
  const expected = Object.fromEntries(
    Object.entries(DERIVED_FEED_DEBT).filter(([file]) => inBuiltRoot(file)),
  );
  const counted = derived.reduce<Record<string, number>>((by, s) => {
    by[s.file] = (by[s.file] ?? 0) + 1;
    return by;
  }, {});

  it("matches the seeded survey exactly, file by file", () => {
    expect(
      counted,
      "a file above its entry has added a site: pass the reading, or combine. " +
        "A file below its entry has fixed one: lower the number here in the " +
        "same commit, or the next site to appear inherits the allowance.",
    ).toEqual(expected);
  });
});

describe("the gate can see an unwrap laundered through a callback", () => {
  /**
   * The shape that hid seven sites in a file this gate had already reported on.
   *
   * The walk follows one `const` hop per identifier by resolving the
   * identifier's variable declaration. A callback's PARAMETER is not a variable
   * declaration, so `s` in `rows.flatMap((s) => ...)` reaches nothing and every
   * figure taken off it reads as having no provenance, however plainly the array
   * it came from is a reading's payload.
   *
   * The control is planted on the SAME reading and must be reported, so a zero
   * here cannot be a broken harness reporting clean. Two laundered spellings
   * rather than one, because a fix that special-cases `flatMap` and forgets
   * `map` would pass a single-shape assertion.
   */
  const PLANTED = `
    import { upkeep, Unit } from "./world";

    const rows = upkeep.value?.sources ?? [];

    export const control = <Unit value={upkeep.value!.sources[0].amount} />;
    export const viaFlatMap = rows.flatMap((s) => <Unit value={s.amount} />);
    export const viaMap = rows.map((s) => <Unit value={s.amount} />);
  `;

  const scan = scanPlanted({ "planted.tsx": PLANTED });

  it("read types that resolved, so the verdict is not a build artefact", () => {
    expect(scan.errorTyped).toBe(0);
  });

  it("sees the direct control on the same reading", () => {
    expect(scan.sites.length).toBeGreaterThan(0);
  });

  it("sees the figure taken off a callback parameter, in map and flatMap", () => {
    expect(scan.sites.length).toBe(3);
  });
});

describe("the gate follows a provenance chain deeper than a dozen hops", () => {
  /**
   * The cap that hid `RotorTachometer`'s torque figure, asserted so it cannot
   * be tightened back without a failure.
   *
   * Fifteen named hops, each one legal and none of them contrived: a real chain
   * gets this long by passing through a `??`, a `find`, a conditional and two
   * or three helpers, which is exactly how the site this guards was reached.
   *
   * The control is the SAME chain one hop shorter than the plant is long, so a
   * cap set anywhere between them would fail this test rather than silently
   * shortening the gate's reach.
   */
  const CHAIN = Array.from(
    { length: 15 },
    (_, i) => `    const h${i} = ${i === 0 ? "altitude.value" : `h${i - 1}`};`,
  ).join("\n");

  const PLANTED = `
    import { altitude, Unit } from "./world";

${CHAIN}

    export const deep = <Unit value={h14} />;
  `;

  const scan = scanPlanted({ "planted.tsx": PLANTED });

  it("read types that resolved, so the verdict is not a build artefact", () => {
    expect(scan.errorTyped).toBe(0);
  });

  it("still reports the unwrap at the far end of the chain", () => {
    expect(scan.sites.map((s) => s.prop)).toEqual(["value"]);
  });
});

describe("a split cannot lower a widget's debt and call it fixed", () => {
  /**
   * Per-file counts read lower after a widget is cut into files whenever the cut
   * severs a provenance chain, or lands the primitive in a file the walk does not
   * reach, and nothing was fixed. The unit of account is the widget directory.
   */
  it("flags a widget whose total fell in the commit that added a file to it", () => {
    const findings = splitLaunderingFindings({
      baseDebt: { "packages/components/src/Tank/TankView.tsx": 4 },
      nowDebt: {
        "packages/components/src/Tank/TankView.tsx": 2,
        "packages/components/src/Tank/TankRow.tsx": 1,
      },
      baseFiles: ["packages/components/src/Tank/TankView.tsx"],
      nowFiles: [
        "packages/components/src/Tank/TankView.tsx",
        "packages/components/src/Tank/TankRow.tsx",
      ],
    });
    expect(findings).toEqual([
      {
        unit: "packages/components/src/Tank",
        was: 4,
        now: 3,
        added: ["packages/components/src/Tank/TankRow.tsx"],
      },
    ]);
  });

  it("flags the case where the debt vanished into the new file entirely", () => {
    const findings = splitLaunderingFindings({
      baseDebt: { "packages/components/src/Tank/TankView.tsx": 4 },
      nowDebt: {},
      baseFiles: ["packages/components/src/Tank/TankView.tsx"],
      nowFiles: [
        "packages/components/src/Tank/TankView.tsx",
        "packages/components/src/Tank/TankRow.tsx",
      ],
    });
    expect(findings.map((f) => [f.unit, f.was, f.now])).toEqual([
      ["packages/components/src/Tank", 4, 0],
    ]);
  });

  it("allows a real fix that adds no file, and a split that keeps the total", () => {
    const base = { "packages/components/src/Tank/TankView.tsx": 4 };
    const baseFiles = ["packages/components/src/Tank/TankView.tsx"];
    expect(
      splitLaunderingFindings({
        baseDebt: base,
        nowDebt: { "packages/components/src/Tank/TankView.tsx": 2 },
        baseFiles,
        nowFiles: baseFiles,
      }),
    ).toEqual([]);
    expect(
      splitLaunderingFindings({
        baseDebt: base,
        nowDebt: {
          "packages/components/src/Tank/TankView.tsx": 3,
          "packages/components/src/Tank/TankRow.tsx": 1,
        },
        baseFiles,
        nowFiles: [...baseFiles, "packages/components/src/Tank/TankRow.tsx"],
      }),
    ).toEqual([]);
  });

  it("owns a file by its widget directory", () => {
    expect(debtUnitOf("packages/components/src/Tank/parts/Row.tsx")).toBe(
      "packages/components/src/Tank",
    );
    expect(debtUnitOf("packages/components/src/Loose.tsx")).toBe(
      "packages/components/src/Loose.tsx",
    );
  });

  it("holds for the live list against the ratchet base", () => {
    const base = ratchetBaseRef();
    if (!base) return;
    expect(
      splitFindingsAgainstBase(
        base,
        "packages/core/src/primitive-reading-feed.debt.ts",
        "DERIVED_FEED_DEBT",
        DERIVED_FEED_DEBT,
      ),
      "A widget's derived-feed total fell in the same change that added a file " +
        "to it. Land the split first, then the fix, so the drop is a fix.",
    ).toEqual([]);
  });
});
