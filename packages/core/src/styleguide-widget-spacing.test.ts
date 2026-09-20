import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { modClientRoots } from "./styleguideScanRoots";

/**
 * Design-system guard: a WIDGET does not pass a t-shirt size to a layout
 * primitive.
 *
 * `gap="sm"` looks like it satisfies the rule that a widget composes the kit
 * rather than writing its own CSS, and it does not. A size is a number wearing
 * a name: it says how far apart, which is the question the ladder answers, not
 * which job the space is doing. The semantic layer was defined around panels,
 * cards and containers precisely so the container decides what "related" or
 * "section" resolves to for everything inside it, and a widget reaching past
 * it for a size takes that decision away from the container it happens to be
 * dropped into. The common case is that a widget should set no spacing at all.
 *
 * Scope is the widget packages only, `packages/components/src` and every
 * `mod/<uplink>/client/src`. `packages/ui`, `packages/app` and `packages/ui-kit`
 * are containers and chrome: deciding spacing is their job, and it is where the
 * decision has to live for a widget to be able to stop making it.
 *
 * SHRINK-ONLY, not a ban, and the distance is the reason. 317 call sites across
 * 78 files at the seed, and the layer that would replace them does not exist
 * yet: `Panel`, `Card` and `Section` carry insets but no complete answer for
 * what the space between a widget's own rows should be. A ban today would be
 * permanently red against a population with nowhere to go, which is the failure
 * the rawSpacingRung family in `styleguide-tokens.test.ts` documents at length.
 * So the gate holds the line while that layer is designed: no file may grow, a
 * file that shrinks prints a hint rather than failing, and the seed shrinks to
 * nothing when the containers can answer the question.
 */

/** The props a layout primitive resolves against `theme.space`. */
const SIZE_PROPS = ["gap", "rowGap", "space", "pad"];

/** `SpaceToken`, as ui-kit declares it. */
const SIZES = ["xs", "sm", "md", "lg", "xl"];

/**
 * A size passed as a JSX attribute, in the three spellings the tree uses or
 * could: a bare string, a braced string, and `pad`'s `[vertical, horizontal]`
 * array. The leading class rules out a styled-component's transient `$gap`
 * and an object property `gap: "sm"`, which is bespoke CSS and belongs to the
 * styled-components rule rather than to this one.
 */
const SIZE_PROP = new RegExp(
  `(^|[^\\w$.-])(${SIZE_PROPS.join("|")})\\s*=\\s*` +
    `("[a-z+]+"|\\{\\s*"[a-z+]+"\\s*\\}|\\{\\s*\\[[^\\]]*\\]\\s*\\})`,
  "g",
);

function sizesIn(value: string): string[] {
  return SIZES.filter((size) => new RegExp(`"${size}"`).test(value));
}

/**
 * Which debt key a file counts against. `packages/` files are keyed by their
 * own path so a failure names what moved; everything under `mod/` shares one
 * bucket, because `packages/core` may not name an Uplink directory
 * (`uplink-boundary.test.ts` fails the build on any mention of one outside its
 * owning directory). The runtime failure still prints the exact mod file,
 * which comes from the scan rather than from this table.
 */
function debtKey(file: string): string {
  return file.startsWith("mod/") ? "mod/" : file;
}

/**
 * Per-file ceilings, seeded 2026-09-16 at 317 sites across 78 files: 109 in
 * `packages/components` over 43 files, and 208 across the Uplinks in the one
 * `mod/` bucket.
 *
 * Lower an entry (or delete the key) in the same commit as the cleanup; a drop
 * warns rather than fails, so a cleanup lands green.
 *
 * Re-measured 2026-09-20 at 145 sites across 39 files, and the `mod/` bucket
 * fell 208 -> 38 without a single site being migrated. The Uplinks DEPARTED to
 * `gonogo-uplinks` and took their widgets with them, leaving 170 sites of
 * headroom a new violation could have landed in unnoticed. A departure is not
 * a cleanup, so nothing prompted anyone to lower the number, and the drop hint
 * below is a `console.warn` that the default vitest reporter suppresses for a
 * PASSING test: the slack was reported on every run and displayed on none.
 * Re-measure this bucket whenever an Uplink leaves, with
 * `--reporter=verbose` to see the hint at all.
 */
const DEBT: Record<string, number> = {
  "mod/": 38,
  "packages/components/src/ActionGroup/index.tsx": 4,
  "packages/components/src/AstronautComplex/index.tsx": 8,
  "packages/components/src/CommSignal/index.tsx": 4,
  "packages/components/src/CrewStatus/index.tsx": 5,
  "packages/components/src/DataSourceStatus/index.tsx": 3,
  "packages/components/src/EscapeProfile/index.tsx": 2,
  "packages/components/src/Experiments/index.tsx": 10,
  "packages/components/src/FleetComms/index.tsx": 1,
  "packages/components/src/FleetReliability/index.tsx": 7,
  "packages/components/src/FleetRoster/index.tsx": 2,
  "packages/components/src/FuelStatus/index.tsx": 6,
  "packages/components/src/LandingStatus/index.tsx": 9,
  "packages/components/src/LibrationPoints/index.tsx": 1,
  "packages/components/src/ManeuverPlanner/BurnConformanceRow.tsx": 1,
  "packages/components/src/ManeuverPlanner/BurnWindowRows.tsx": 4,
  "packages/components/src/ManeuverPlanner/ConformancePlot.tsx": 1,
  "packages/components/src/ManeuverPlanner/index.tsx": 3,
  "packages/components/src/Navball/AttitudeIndicator.tsx": 1,
  "packages/components/src/PowerSystems/index.tsx": 1,
  "packages/components/src/ResourceOps/index.tsx": 14,
  "packages/components/src/ScienceData/AboardTab.tsx": 1,
  "packages/components/src/ScienceData/ArchiveTab.tsx": 1,
  "packages/components/src/SemiMajorAxis/index.tsx": 1,
  "packages/components/src/SpaceCenterStatus/index.tsx": 2,
  "packages/components/src/Strategies/index.tsx": 5,
  "packages/components/src/SystemView/AlmanacPanel.tsx": 1,
  "packages/components/src/SystemView/VesselInfoPanel.tsx": 1,
  "packages/components/src/Targeting/index.tsx": 6,
  "packages/components/src/shared/OrbitalEventChips.tsx": 1,
  "packages/components/src/shared/trajectoryWithheld.tsx": 1,
};

interface Offender {
  file: string;
  line: number;
  property: string;
  value: string;
}

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

/** Blank a comment out, keeping its newlines so line numbers stay true. */
function blankOut(match: string): string {
  return match.replace(/[^\n]/g, " ");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blankOut)
    .replace(
      /(^|[^:"'`\\])\/\/[^\n]*/g,
      (match, lead: string) => lead + " ".repeat(match.length - lead.length),
    );
}

function lineIndexer(source: string): (offset: number) => number {
  const starts: number[] = [];
  let cursor = 0;
  for (const line of source.split("\n")) {
    starts.push(cursor);
    cursor += line.length + 1;
  }
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

/** The widget roots, and only those. */
function widgetRoots(): string[] {
  return ["packages/components/src", ...modClientRoots(ROOT)];
}

/**
 * Enumerate git-TRACKED widget sources. Same reasoning as the other scans: a
 * live filesystem walk races with the dist output and temp fixtures a
 * concurrent `turbo test` writes, so the count flickers; the git index does not
 * move mid-run.
 */
function trackedWidgetSources(): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", ...widgetRoots()], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(
      (rel) =>
        /\.tsx?$/.test(rel) &&
        !/\.test\.|\.test-d\./.test(rel) &&
        !rel.includes("/__generated__/") &&
        !rel.includes("/__snapshots__/"),
    );
}

function scan(source: string, file: string): Offender[] {
  const stripped = stripComments(source);
  const lineOf = lineIndexer(stripped);
  const out: Offender[] = [];
  for (const match of stripped.matchAll(new RegExp(SIZE_PROP.source, "g"))) {
    if (sizesIn(match[3]).length === 0) continue;
    out.push({
      file,
      line: lineOf(match.index),
      property: match[2],
      value: match[3].trim().slice(0, 48),
    });
  }
  return out;
}

const OFFENDERS: Offender[] = trackedWidgetSources().flatMap((rel) => {
  try {
    return scan(readFileSync(join(ROOT, rel), "utf8"), rel);
  } catch {
    return [];
  }
});

describe("design-system: widgets do not pass a t-shirt spacing size", () => {
  it("holds the per-file ceiling", () => {
    const byKey = new Map<string, Offender[]>();
    for (const offender of OFFENDERS) {
      const key = debtKey(offender.file);
      const list = byKey.get(key) ?? [];
      list.push(offender);
      byKey.set(key, list);
    }

    const added: Offender[] = [];
    for (const [key, list] of byKey) {
      const allowed = DEBT[key] ?? 0;
      if (list.length > allowed) added.push(...list.slice(allowed));
    }

    if (added.length > 0) {
      const detail = added
        .map((o) => `  ${o.file}:${o.line}  ${o.property}=${o.value}`)
        .join("\n");
      throw new Error(
        `${added.length} new t-shirt spacing size(s) passed from a widget:\n${detail}\n` +
          `A size says how far apart; the container it lands in is what should ` +
          `decide that. Let the Panel / Card / Section around it carry the ` +
          `spacing and pass nothing, or reach for a semantic name from the ` +
          `SEMANTIC SPACING block in packages/theme/src/tokens.css. If neither ` +
          `can express what the widget needs, that is a gap in the container ` +
          `layer worth raising rather than a size to pass: say so rather than ` +
          `raising this file's entry in DEBT in ` +
          `packages/core/src/styleguide-widget-spacing.test.ts.`,
      );
    }

    const cleaned: string[] = [];
    for (const [key, allowed] of Object.entries(DEBT)) {
      const now = byKey.get(key)?.length ?? 0;
      if (now < allowed) {
        cleaned.push(
          `  ${key}: ${allowed} -> ${now}${now === 0 ? " (remove the key)" : ""}`,
        );
      }
    }
    if (cleaned.length > 0) {
      console.warn(
        `[styleguide] widget spacing debt can be lowered in ` +
          `packages/core/src/styleguide-widget-spacing.test.ts:\n${cleaned.join("\n")}`,
      );
    }

    expect(added).toEqual([]);
  });

  it("names no debt entry that has moved or been deleted", () => {
    const stale = Object.keys(DEBT).filter(
      (key) => key !== "mod/" && !existsSync(join(ROOT, key)),
    );
    expect(stale).toEqual([]);
  });

  // A guard that scans nothing passes forever, and this one narrows its roots
  // by hand, so a renamed package would empty it silently.
  it("actually scanned the widget tree", () => {
    expect(trackedWidgetSources().length).toBeGreaterThan(100);
    expect(OFFENDERS.length).toBeGreaterThan(0);
  });
});

/**
 * A scan that has stopped matching reports zero and zero reads as a clean
 * tree, so every run plants each spelling and fails as BLIND rather than
 * green. The second half is the one a matcher usually gets wrong: a pattern
 * loose enough to find every offence also finds things that are not offences,
 * and a gate that fires on `justify="between"` gets loosened until it fires on
 * nothing.
 */
describe("design-system: the widget-spacing gate can see a violation", () => {
  const CAUGHT = [
    '<Stack gap="sm">',
    '<Cluster justify="between" gap="md" wrap>',
    '<Box pad={["xs", "md"]}>',
    '<Grid rowGap="lg" />',
    '<Divider space="xs" />',
    '<Inline gap={"xl"} />',
  ];

  const IGNORED = [
    // A non-spacing prop that happens to take a short word.
    '<Cluster justify="between" align="center">',
    // The size arriving from a variable is not a literal this can grade, and
    // pretending otherwise would mean flagging the identifier `gap`.
    "<Stack gap={density} />",
    // An object property, not a JSX prop: bespoke CSS, which the
    // styled-components rule owns.
    '  gap: "sm",',
    // A styled component's transient prop, same reason.
    '<Stack__Root $gap="sm" />',
    // A semantic name is the destination, not the offence.
    '<Box style={{ gap: "var(--gap-related)" }} />',
  ];

  for (const source of CAUGHT) {
    it(`catches ${source}`, () => {
      expect(
        scan(source, "plant.tsx"),
        `the widget-spacing scan is BLIND to ${JSON.stringify(source)}, so a ` +
          `zero from it says nothing about the tree`,
      ).not.toEqual([]);
    });
  }

  for (const source of IGNORED) {
    it(`leaves ${source} alone`, () => {
      expect(
        scan(source, "plant.tsx"),
        `the widget-spacing scan fires on ${JSON.stringify(source)}, which is ` +
          `not a widget passing a size`,
      ).toEqual([]);
    });
  }

  it("grades every size the kit declares", () => {
    for (const size of SIZES) {
      expect(
        scan(`<Stack gap="${size}" />`, "plant.tsx"),
        `${size} is a SpaceToken the gate cannot see`,
      ).not.toEqual([]);
    }
  });
});
