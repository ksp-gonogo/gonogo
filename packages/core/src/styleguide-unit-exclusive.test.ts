import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SCANNED_PACKAGE_ROOTS,
  styleguideScanRoots,
  trackedModClientRoots,
} from "./styleguideScanRoots";

/**
 * `Unit` is the only unit renderer, enforced rather than merely stated.
 *
 * CLAUDE.md has said "Unit is the ONLY unit renderer" for months while
 * `packages/ui-kit/src/index.ts` exported `formatDuration` from the barrel, so
 * any widget and any Uplink could reach a raw string ladder by importing it.
 * Eleven files did. That is this repo's characteristic defect: a principle
 * written down with nothing checking it.
 *
 * The module boundary is the primary fix and this ratchet is the second half
 * of it. Unexporting a function stops an import; it does NOT stop somebody
 * hand-rolling the same s/m/h ladder locally, which is how four copies of one
 * existed before `formatDuration` was extracted. So:
 *
 *   Gate A  the six kit formatters are reachable only from Unit's own
 *           implementation. Anything else naming one is a violation.
 *   Gate B  every `format*` declaration outside that implementation is
 *           inventoried with a reason, so a hand-rolled renderer cannot be
 *           born unnoticed.
 *
 * Gate B is deliberately name-matched and therefore catches formatters that
 * are NOT unit renderers (`formatEntityLabel` builds an accessible name,
 * `formatBareArg` writes kerboscript). Those stay, each with a line saying why
 * it is not a quantity. The rule is not narrowed to make the number small: an
 * inventory that lists only the guilty cannot show a new entry arriving.
 */

/**
 * The six string formatters that render a quantity, and the ONE thing allowed
 * to call them.
 *
 * `formatQuantity` is the dispatcher behind `<Unit>`, `writeQuantity` and
 * `speakQuantity`; the duration pair is what it delegates to for the `time`
 * and `irlTime` kinds (units.ts:1174, 1188), which is precisely why converting
 * a `formatDuration(x)` call to `<Unit value={value("s", x)} />` is
 * behaviour-preserving rather than a re-render: the same ladder runs either
 * way.
 */
const KIT_FORMATTERS = [
  "formatDuration",
  "formatIrlDuration",
  "formatCountdown",
  "formatNumber",
  "formatKspDate",
  "formatQuantity",
] as const;

/**
 * Unit's own implementation. Not "ui-kit": a ui-kit WIDGET calling a raw
 * formatter is the same violation as a widget anywhere else calling one, and
 * exempting the whole package would have hidden five of them.
 */
const UNIT_IMPL = new Set([
  "packages/ui-kit/src/units.ts",
  "packages/ui-kit/src/Unit.tsx",
  // The half of Unit that answers what a reading says about its figure, split
  // out so the instruments resolve a reading the same way the readout does.
  // It reaches a formatter for one thing: the instant a held number was last a
  // reading of now, written on the game's own calendar.
  "packages/ui-kit/src/readingCurrency.ts",
  "packages/ui-kit/src/formatDuration.ts",
  "packages/ui-kit/src/formatKspDate.ts",
  // The two NODE forms of the ladders above, and the reason this set is not
  // just the five: `<Countdown>` is what a call site reaches for instead of
  // `formatDuration`, and `<MissionDate>` is the only renderer for a UT
  // INSTANT, which `<Unit>` deliberately refuses (see units.ts: a ut on the
  // time ladder renders a length, which is a true number about the wrong
  // quantity). They are the sanctioned surface, not consumers of it.
  "packages/ui-kit/src/Countdown.tsx",
  "packages/ui-kit/src/MissionDate.tsx",
]);

/**
 * Files outside `UNIT_IMPL` that still name a kit formatter, with the reason.
 * Shrink-only: an entry may be deleted, never added or raised.
 *
 * EMPTY since 2026-09-16, so the gate fails on the first reach any file makes.
 * The last entry was `ReadOnlyField`'s bare-`number` branch, and it closed the
 * way every entry here has to: not by finding another formatter but by removing
 * the number from the published union, so a caller hands over a `Value` and the
 * field has a unit to render. A genuinely unitless reading has `value("1", x)`
 * and a quantity of things has `value("count", n)`, both of which `<Unit>`
 * renders, so there is no longer a shape this component can be handed that
 * `<Unit>` cannot write.
 */
const FORMATTER_REACH_DEBT: Record<string, { count: number; why: string }> = {};

/**
 * Every `format*` declaration outside `UNIT_IMPL`, with what it renders.
 * Shrink-only. An entry reading "not a quantity" is permanent by nature; one
 * reading "unit renderer" is work not yet done.
 */
const LOCAL_FORMATTER_DEBT: Record<string, { count: number; why: string }> = {
  // ── Hand-rolled COMPACTION ladders. Every one of these is a k/M/decimals
  //    ladder written out again, which is the defect this file is named for.
  //    They differ from each other in ways nobody chose: 10,000 vs 1,000 as
  //    the k threshold, round vs toFixed, trailing zeros kept or stripped. One
  //    ladder in `units.ts` is the answer; each needs its widget's values to
  //    carry declared units first.
  "packages/components/src/Graph/index.tsx": {
    count: 2,
    why: "unit renderer: a k/M readout ladder plus an axis-tick ladder",
  },
  "packages/components/src/PerfBudgets/index.tsx": {
    count: 1,
    why: "unit renderer: a K/M rate ladder",
  },
  "packages/components/src/PowerSystems/index.tsx": {
    count: 1,
    why: "unit renderer: a k ladder over resource units",
  },
  "packages/components/src/SpaceCenterStatus/index.tsx": {
    count: 1,
    why: "unit renderer: a k/M funds ladder",
  },
  "packages/core/src/utils/format.ts": {
    count: 4,
    why: "two already delegate to writeQuantity; formatCompactNumber and formatCompactCurrency are still k/M ladders",
  },
  "mod/GonogoBreakingGroundUplink/client/src/RoboticsConsole/index.tsx": {
    count: 1,
    why: "unit renderer: formats a servo position and the call sites append unitFor(type) beside it, i.e. a quantity assembled by hand",
  },
  "mod/GonogoKerbalismUplink/client/src/ShipSystems/index.tsx": {
    count: 2,
    why: "formatTimeToEmpty already delegates to speakQuantity; formatRate hand-assembles a signed per-second rate",
  },

  // ── A real GAP in `Unit`, not laziness. Every one of these renders a
  //    zero-padded colon clock ("T+02:15:30", "04:12"), and `<Unit>` and
  //    `<Countdown>` render the tiered ladder ("2h 15m"). The kit has no
  //    clock NOTATION, so there is currently nothing to convert these to.
  //    This is the finding worth acting on before the rest: four files have
  //    each written the same padded h/m/s split.
  "packages/components/src/LaunchDirector/index.tsx": {
    count: 1,
    why: "GAP: T+HH:MM:SS mission clock; the kit has no zero-padded clock notation",
  },
  "packages/data/src/FlightsManager/ChaptersEditor.tsx": {
    count: 1,
    why: "GAP: MM:SS / HH:MM:SS scrub position, same missing notation",
  },
  "packages/data/src/replaySession/ReplaySessionBanner.tsx": {
    count: 1,
    why: "GAP: MM:SS / HH:MM:SS replay position, same missing notation",
  },
  "packages/ui/src/lineChartMath.ts": {
    count: 1,
    why: "GAP: axis time labels on a padded clock, same missing notation",
  },
  "packages/data/src/FlightsManager/index.tsx": {
    count: 2,
    why: "GAP: a real calendar date plus a flight duration on the padded clock",
  },

  // ── Wrappers that ALREADY delegate. They match by name only, and each is a
  //    sentinel or a subtraction around a kit call rather than a ladder. Kept
  //    listed because the gate is an inventory: a line that vanishes is a file
  //    that changed shape, and that is worth seeing.
  "packages/components/src/AtmosphereProfile/index.tsx": {
    count: 1,
    why: "delegates to speakQuantity(value('Pa', p))",
  },
  "packages/components/src/shared/OrbitDiagram.tsx": {
    count: 1,
    why: "delegates to writeQuantity(value('m', ...)) after subtracting the body radius",
  },
  "packages/components/src/ContractManager/index.tsx": {
    count: 1,
    why: "converted: formatDeadline now composes writeQuantity, and is exported so its callers pin the string shape",
  },
  "packages/app/src/alarms/AlarmBanner.tsx": {
    count: 4,
    why: "converted: the duration wrapper is gone; the four left compose warp rate, a T-minus prefix and a next-alarm line",
  },

  // ── NOT quantities. Permanent by nature: nothing here has a unit, so
  //    there is no `Value` to hand `<Unit>` and no conversion to do.
  "mod/sitrep-sdk/src/unit-system/dimension.ts": {
    count: 1,
    why: "not a quantity: renders a DIMENSION (L, M, T exponents), the thing a unit has",
  },
  "packages/components/src/SystemView/systemEntities.ts": {
    count: 1,
    why: "not a quantity: builds an entity's accessible name from its metadata",
  },
  "packages/components/src/WarpControl/index.tsx": {
    count: 1,
    why: "not a quantity: a warp MULTIPLIER (1000x) is a dimensionless ratio, and its x suffix is not a unit symbol",
  },
  "packages/app/src/notes/templating.ts": {
    count: 1,
    why: "not a quantity: interpolates an unknown into a note template",
  },
  "packages/serial/src/renderStyles/textBuffer.ts": {
    count: 1,
    why: "not a quantity: ON/OFF and raw values into a fixed 21x8 hardware text buffer",
  },
  "packages/ui-kit/src/StreamStatusBadge.tsx": {
    count: 1,
    why: "not a quantity: maps a stream status enum to a word",
  },
  "packages/ui/src/LineChart.tsx": {
    count: 1,
    why: "not a quantity: an unlabelled y-axis tick on a caller-supplied series",
  },
  "packages/ui/src/SignalLossBanner.tsx": {
    count: 1,
    why: "GAP: padded clock again, on an outage's elapsed time",
  },
  "packages/ui/src/SourceOfflineBanner.tsx": {
    count: 1,
    why: "GAP: padded clock again, on an offline source's elapsed time",
  },
};

const SCAN_EXTENSION = /\.tsx?$/;
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "__fixtures__",
  "__generated__",
]);
const SKIP_FILE = /\.(test|test-d)\.tsx?$/;

/** A `format*` function or const declaration, however it is spelled. */
const LOCAL_FORMATTER =
  /(?:export\s+)?(?:async\s+)?(?:function|const|let)\s+(format[A-Z][A-Za-z0-9_]*)/g;

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

/** The barrel import, including the multi-line form Biome writes. */
const FROM_UI_KIT =
  /import\s*\{([^}]*)\}\s*from\s*["']@ksp-gonogo\/ui-kit["']/g;

/** Gate C's walk: the same tree, but tests included. */
function* walkAll(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      yield* walkAll(path);
    } else if (SCAN_EXTENSION.test(name)) {
      yield path;
    }
  }
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      yield* walk(path);
    } else if (SCAN_EXTENSION.test(name) && !SKIP_FILE.test(name)) {
      yield path;
    }
  }
}

/**
 * Strip comments before matching. Twelve files discuss `formatDuration` in a
 * doc comment explaining why they no longer call it, and a ratchet that counts
 * its own paper trail as a violation cannot be shrunk to zero.
 *
 * Crude on purpose, exactly as `styleguide-wall-clock` is: over-stripping can
 * only UNDER-count, and an under-count fails the stale half loudly rather than
 * letting something through in silence.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** How many times a file names one of the six, comments removed. */
function countFormatterReach(source: string): number {
  const code = stripComments(source);
  let total = 0;
  for (const name of KIT_FORMATTERS) {
    // No `\b`: a word boundary is fine here, but `formatNumber` must not also
    // match `formatNumericTick`, so the trailing guard is an explicit
    // not-an-identifier-character rather than a boundary that `Tick` satisfies.
    // Two guards beyond the identifier boundary, both about PATHS rather than
    // code. A trailing `.ts`/`.tsx` is a file path, which is how two of core's
    // allowlists name `packages/ui-kit/src/formatDuration.ts`; a leading `/` is
    // a module-specifier segment, which is how the barrel still says
    // `from "./formatKspDate"` while exporting only the notation lever from it.
    // Neither reaches the function, and an entry that can only ever be debted
    // is noise in a list whose whole value is that every line means something.
    // A namespace call (`kit.formatDuration`) is spelled with a dot and still
    // matches, which is the case that must not be lost to this.
    const re = new RegExp(
      `(?<![A-Za-z0-9_$/])${name}(?![A-Za-z0-9_$])(?!\\.[\\w.]*tsx?\\b)`,
      "g",
    );
    total += [...code.matchAll(re)].length;
  }
  return total;
}

/** How many `format*` helpers a file declares, comments removed. */
function countLocalFormatters(source: string): number {
  return [...stripComments(source).matchAll(LOCAL_FORMATTER)].length;
}

interface Scan {
  reach: Record<string, number>;
  local: Record<string, number>;
  perRoot: Record<string, number>;
  scanned: number;
}

/**
 * Every UI source root, plus the SDK's own unit system.
 *
 * `styleguideScanRoots` is shared with the hex and token ratchets and already
 * discovers each `mod/*\/client/src` by listing rather than enumerating, so a
 * new Uplink is covered the day it lands. `mod/sitrep-sdk/src` is added on top
 * because the unit system itself lives there and a formatter hiding in the SDK
 * would reach every consumer of the published package.
 */
function scanRoots(root: string): string[] {
  const roots = styleguideScanRoots(root).map((rel) => join(root, rel));
  const sdk = join(root, "mod", "sitrep-sdk", "src");
  if (existsSync(sdk)) roots.push(sdk);
  return roots.filter((abs) => existsSync(abs));
}

/**
 * Each file's text, read once per run. Three gates and the census each walk the
 * same tree, and on the fleet's machine opening a file is what a walk costs.
 */
const texts = new Map<string, string>();
function read(file: string): string {
  let text = texts.get(file);
  if (text === undefined) {
    text = readFileSync(file, "utf8");
    texts.set(file, text);
  }
  return text;
}

function scan(root: string): Scan {
  const reach: Record<string, number> = {};
  const local: Record<string, number> = {};
  const perRoot: Record<string, number> = {};
  let scanned = 0;
  for (const srcDir of scanRoots(root)) {
    const rootKey = relative(root, srcDir);
    perRoot[rootKey] = 0;
    for (const file of walk(srcDir)) {
      scanned++;
      perRoot[rootKey]++;
      const rel = relative(root, file);
      if (UNIT_IMPL.has(rel)) continue;
      const source = read(file);
      const reached = countFormatterReach(source);
      if (reached > 0) reach[rel] = reached;
      const declared = countLocalFormatters(source);
      if (declared > 0) local[rel] = declared;
    }
  }
  return { reach, local, perRoot, scanned };
}

function grade(
  found: Record<string, number>,
  debt: Record<string, { count: number; why: string }>,
): { newOrChanged: string[]; stale: string[] } {
  const newOrChanged = Object.keys(found)
    .filter((f) => found[f] !== debt[f]?.count)
    .sort();
  const stale = Object.keys(debt)
    .filter((f) => !(f in found))
    .sort();
  return { newOrChanged, stale };
}

const REPO_ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

/**
 * What a file reaching a kit formatter is told to do instead.
 *
 * Named rather than inline so the guidance can be asserted. A ratchet's message
 * is the only part of it nothing else checks, so it is the part that rots: one
 * that stopped naming `<Unit>` would still fail the build, just uselessly.
 */
function formatterReachMessage(lines: readonly string[]): string {
  return (
    `A kit string formatter is reachable outside \`Unit\`:\n${lines.join("\n")}\n\n` +
    `Render \`<Unit value={value("s", seconds)} />\`. It runs the SAME ladder ` +
    `(formatQuantity delegates the \`time\` kind to formatDuration), so the ` +
    `text does not change. Where a node genuinely cannot go (an SVG <text>, ` +
    `a contribution \`label\` string, an aria-label) use \`writeQuantity\` or ` +
    `\`speakQuantity\`, which are the two sanctioned string escapes.\n\n` +
    `If the value is not a quantity Unit can express, say so in ` +
    `FORMATTER_REACH_DEBT with the gap it would need closed.`
  );
}

/** The same, for a locally-declared `format*` helper. */
function localFormatterMessage(lines: readonly string[]): string {
  return (
    `A new \`format*\` helper appeared:\n${lines.join("\n")}\n\n` +
    `If it renders a QUANTITY it must not exist: hand it to \`<Unit>\`, or ` +
    `to \`writeQuantity\`/\`speakQuantity\` where a node cannot go. A ladder ` +
    `written locally is how four copies of the duration ladder existed ` +
    `before it was extracted.\n\n` +
    `If it is genuinely not a quantity (an accessible name, a script ` +
    `argument, a status word), add a line to LOCAL_FORMATTER_DEBT saying so.`
  );
}

describe("Unit is the only unit renderer", () => {
  it("gate A: nothing outside Unit's implementation reaches a kit formatter", () => {
    const { reach } = scan(REPO_ROOT);
    const { newOrChanged, stale } = grade(reach, FORMATTER_REACH_DEBT);

    if (newOrChanged.length > 0) {
      const lines = newOrChanged.map((f) => {
        const seeded = FORMATTER_REACH_DEBT[f];
        return seeded === undefined
          ? `  ${f}: names a kit formatter ${reach[f]}x, no debt entry`
          : `  ${f}: seeded ${seeded.count}, found ${reach[f]}`;
      });
      throw new Error(formatterReachMessage(lines));
    }
    if (stale.length > 0) {
      throw new Error(
        `Stale FORMATTER_REACH_DEBT entries, delete them to ratchet down:\n` +
          stale.map((f) => `  ${f}`).join("\n"),
      );
    }
    expect(newOrChanged).toEqual([]);
    expect(stale).toEqual([]);
  });

  it("gate B: every hand-rolled format* helper is inventoried with a reason", () => {
    const { local } = scan(REPO_ROOT);
    const { newOrChanged, stale } = grade(local, LOCAL_FORMATTER_DEBT);

    if (newOrChanged.length > 0) {
      const lines = newOrChanged.map((f) => {
        const seeded = LOCAL_FORMATTER_DEBT[f];
        return seeded === undefined
          ? `  ${f}: declares ${local[f]} format* helper(s), no debt entry`
          : `  ${f}: seeded ${seeded.count}, found ${local[f]}`;
      });
      throw new Error(localFormatterMessage(lines));
    }
    if (stale.length > 0) {
      throw new Error(
        `Stale LOCAL_FORMATTER_DEBT entries, delete them to ratchet down:\n` +
          stale.map((f) => `  ${f}`).join("\n"),
      );
    }
    expect(newOrChanged).toEqual([]);
    expect(stale).toEqual([]);
  });

  /**
   * Both failures NAME THE FIX, and name the file that has to change.
   *
   * Pinned because guidance is the half of a ratchet nothing else exercises:
   * these messages are built only on the failing path, so every run of a green
   * tree leaves them unread.
   */
  it("tells a formatter-reaching file what to do instead", () => {
    const reach = formatterReachMessage([
      "  packages/components/src/Example/index.tsx: names a kit formatter 2x, no debt entry",
    ]);
    expect(reach).toContain("<Unit");
    expect(reach).toContain("writeQuantity");
    expect(reach).toContain("speakQuantity");
    expect(reach).toContain("FORMATTER_REACH_DEBT");
    expect(reach).toContain("packages/components/src/Example/index.tsx");

    const local = localFormatterMessage([
      "  packages/components/src/Example/index.tsx: declares 1 format* helper(s), no debt entry",
    ]);
    expect(local).toContain("<Unit>");
    expect(local).toContain("writeQuantity");
    expect(local).toContain("LOCAL_FORMATTER_DEBT");
    expect(local).toContain("packages/components/src/Example/index.tsx");
  });

  /**
   * Gate C: the MODULE BOUNDARY, asked of tests too.
   *
   * Gates A and B skip `.test.ts(x)` because a test legitimately exercises a
   * formatter through a relative import, and holding a formatter's own suite to
   * "do not name the formatter" is absurd. That skip had a hole: two app tests
   * imported `formatDuration` from the PACKAGE barrel, and when the export was
   * removed they failed at runtime with `formatDuration is not a function`
   * while both gates above reported a clean tree. The suite caught what this
   * file did not.
   *
   * So this gate asks the one question that is about reachability rather than
   * rendering, and asks it of every file including tests: does anything import
   * one of the six from `@ksp-gonogo/ui-kit`? Nothing may, because nothing
   * can. The point is to say so in a sentence rather than in a stack trace,
   * and to keep saying it if the export is ever put back.
   */
  it("gate C: nothing imports a formatter from the ui-kit package, tests included", () => {
    // This file is the one exclusion, and it earns it: the planted fixtures
    // in the two blindness tests are barrel imports written out in full, so
    // the gate reads them as real. That it does is the proof, at GATE level
    // rather than matcher level, that a genuine one would not slip past: the
    // first run of this check returned exactly these three and nothing else.
    const SELF = "packages/core/src/styleguide-unit-exclusive.test.ts";
    const offenders: string[] = [];
    for (const srcDir of scanRoots(REPO_ROOT)) {
      for (const file of walkAll(srcDir)) {
        if (relative(REPO_ROOT, file) === SELF) continue;
        const code = stripComments(read(file));
        for (const m of code.matchAll(FROM_UI_KIT)) {
          const bound = m[1];
          const hit = KIT_FORMATTERS.filter((n) =>
            new RegExp(`(?<![A-Za-z0-9_$])${n}(?![A-Za-z0-9_$])`).test(bound),
          );
          if (hit.length > 0) {
            offenders.push(`${relative(REPO_ROOT, file)}: ${hit.join(", ")}`);
          }
        }
      }
    }
    expect(
      offenders,
      `These import a formatter from the ui-kit BARREL. None of the six is ` +
        `exported from it, so this is a runtime TypeError waiting to happen. ` +
        `Render <Unit>, or take writeQuantity/speakQuantity for a string.`,
    ).toEqual([]);
  });

  /**
   * Gate C can only report a clean tree if it can see a dirty one.
   */
  it("gate C recognises a barrel import of a formatter", () => {
    const bindings = (src: string) =>
      [...stripComments(src).matchAll(FROM_UI_KIT)].map((m) => m[1]);
    expect(
      bindings(`import { Badge, formatDuration } from "@ksp-gonogo/ui-kit";`),
      "single-line barrel import",
    ).toEqual([" Badge, formatDuration "]);
    expect(
      bindings(
        `import {\n  kspCalendar,\n  formatDuration,\n} from "@ksp-gonogo/ui-kit";`,
      ).length,
      "multi-line barrel import",
    ).toBe(1);
    expect(
      bindings(`import { formatDuration } from "./formatDuration";`),
      "a relative import inside the kit is not a barrel import",
    ).toEqual([]);
  });

  /**
   * The instrument, asked apart from the result. Both gates above grade an
   * offender LIST, and a walk that reads nothing produces the same empty list
   * as a clean tree. `styleguide-wall-clock` sat on 1 widget root of 13 and
   * stayed green for months on exactly that.
   */
  it("walked every root, and no root was empty", () => {
    const { perRoot } = scan(REPO_ROOT);
    const roots = Object.keys(perRoot);
    // Not a count. This was a floor of 17 roots and 900 files, set below the
    // measured 20 and 1,141 so one Uplink leaving would not trip it, and every
    // mod Uplink is leaving for the gonogo-uplinks repo. The roots walked must
    // be exactly the package roots, the sdk, and every client src git tracks.
    expect([...roots].sort(), "roots walked").toEqual(
      [
        ...SCANNED_PACKAGE_ROOTS,
        "mod/sitrep-sdk/src",
        ...trackedModClientRoots(REPO_ROOT),
      ].sort(),
    );
    const empty = roots.filter((r) => perRoot[r] === 0);
    expect(
      empty,
      `roots that walked ZERO files (a pathspec or listing that silently ` +
        `matched nothing): ${empty.join(", ")}`,
    ).toEqual([]);
  });

  /**
   * And whether the matcher can RECOGNISE a reach once it has one. Neither
   * gate asks this: a pattern that stopped matching reports a clean tree.
   * Every spelling a caller could use, planted.
   */
  it("recognises every spelling of a reach, and not a comment about one", () => {
    expect(
      countFormatterReach(`const s = formatDuration(t);`),
      "direct call",
    ).toBe(1);
    expect(
      countFormatterReach(
        `import { formatDuration as fd } from "@ksp-gonogo/ui-kit";`,
      ),
      "aliased import",
    ).toBe(1);
    expect(
      countFormatterReach(`import * as kit from "x"; kit.formatDuration(t);`),
      "namespace call",
    ).toBe(1);
    expect(
      countFormatterReach(`export { formatDuration } from "./formatDuration";`),
      // Once: the exported specifier. The `"./formatDuration"` half is a
      // module path and is excluded, which is what lets the barrel keep
      // `from "./formatKspDate"` while exporting only the notation lever.
      // The specifier is the half that matters: it is what a consumer binds.
      "re-export",
    ).toBe(1);
    expect(
      countFormatterReach(`const f = kit["formatKspDate"];`),
      "computed member access",
    ).toBe(1);
    expect(
      countFormatterReach(`// never call formatDuration here`),
      "line comment",
    ).toBe(0);
    expect(
      countFormatterReach(`/** the retired formatQuantity path */`),
      "block comment",
    ).toBe(0);
  });

  /**
   * The false-positive half. A gate that flags Unit's own internals, or every
   * identifier with `format` in it, gets switched off rather than obeyed.
   */
  it("does not flag Unit's own implementation, nor a near-miss identifier", () => {
    for (const f of UNIT_IMPL) {
      expect(existsSync(join(REPO_ROOT, f)), `${f} exists`).toBe(true);
    }
    const { reach } = scan(REPO_ROOT);
    for (const f of UNIT_IMPL) {
      expect(reach[f], `${f} is Unit's implementation`).toBeUndefined();
    }
    expect(
      countFormatterReach(`formatNumericTick(v);`),
      "formatNumber must not match formatNumericTick",
    ).toBe(0);
    expect(
      countFormatterReach(`myFormatDuration(t);`),
      "must not match a longer identifier ending in the name",
    ).toBe(0);
    expect(
      countFormatterReach(
        `"packages/ui-kit/src/formatDuration.ts": { T1a: 1 },`,
      ),
      "a file path in an allowlist is not a reach",
    ).toBe(0);
    expect(
      countFormatterReach(`"packages/ui-kit/src/formatDuration.test.ts": 1,`),
      "nor a path to its test file",
    ).toBe(0);
    expect(
      countFormatterReach(`export { realDatesWanted } from "./formatKspDate";`),
      "a module specifier is not a reach to the function it is named after",
    ).toBe(0);
    expect(
      countLocalFormatters(`export function formatDimension(d: Dimension) {}`),
      "a non-quantity formatter is still inventoried, by name",
    ).toBe(1);
    expect(
      countLocalFormatters(`const formatted = x;`),
      "a variable that merely starts with 'format' is not a declaration",
    ).toBe(0);
  });
});
