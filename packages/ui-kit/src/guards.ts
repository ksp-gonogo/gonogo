import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Build-time guards an Uplink can run against its own source.
 *
 * Published as `@ksp-gonogo/ui-kit/guards`, and separate from `./testing` for
 * a concrete reason: this entrypoint reads the FILESYSTEM. `./testing` holds
 * DOM helpers that run anywhere a component test runs, including a browser
 * runner; these need `node:fs` and would break that.
 *
 * ## Why the kit ships a lint rule at all
 *
 * The rule this enforces has been learned the expensive way twice in the app
 * this kit came out of. A widget writes
 *
 *     `${closingSpeed.toFixed(1)} m/s`
 *
 * and nothing objects. It type-checks, it renders correctly, and it is the
 * whole problem the unit layer exists to solve: that symbol cannot be dimmed,
 * cannot be kept off a line break, is announced to a screen reader as the
 * letters "m", "slash", "s", and does not follow when the value's ladder
 * changes rung. Eleven widgets each grew their own private unit ladder that
 * way before anyone noticed, and unpicking them was days of work. Three
 * Uplinks then did the same thing, for the straightforward reason that the
 * app's own guard globbed `packages/` and stopped there.
 *
 * An Uplink imports the same `<Unit>` from the same published package, so it
 * should be able to run the same check. Keeping the check private to one repo
 * is what let those three drift.
 *
 * ## Using it
 *
 * One test file, anywhere your test runner will find it:
 *
 * ```ts
 * import { expectNoHandTypedUnits } from "@ksp-gonogo/ui-kit/guards";
 * import { it } from "vitest";
 *
 * it("renders units through <Unit>, not by typing the symbol", () => {
 *   expectNoHandTypedUnits({ dir: "src" });
 * });
 * ```
 *
 * On an existing codebase with offenders already in it, seed a `baseline` and
 * lower it as you convert. The point is the direction of travel, not a cliff:
 * a guessed conversion is worse than a hand-typed symbol, because it renders
 * a confident wrong label.
 */

/**
 * The symbols worth looking for, deliberately CURATED rather than derived from
 * the kit's full unit catalogue.
 *
 * Deriving it would look tidier and be worse. The catalogue holds tokens like
 * `count`, `id` and `flag` that never appear beside a number, and short ones
 * whose letters occur constantly in ordinary prose and JSX. What matters is
 * the symbols a developer actually types after an interpolation, which is a
 * much smaller set than the ones the system knows about.
 *
 * Pass your own through `symbols` when your Uplink introduces a unit of its
 * own: `registerUnit` makes the kit render it, and this list is what makes the
 * guard notice when somebody writes it by hand instead.
 */
export const HAND_TYPED_SYMBOLS: readonly string[] = [
  "m/s²",
  "m/s",
  "km/h",
  "km",
  "Mm",
  "Gm",
  "mm",
  "cm",
  "kPa",
  "MPa",
  "kN",
  "MN",
  "kW",
  "MW",
  "GW",
  "kg",
  "°C",
  "°",
  "%",
  "m",
  "s",
  "t",
  "N",
  "W",
  "f",
  "sci",
  "rep",
  "Mit",
  "deg",
  "rad",
];

/**
 * A CSS length is not a readout, and `width: ${pct}%` is by far the most
 * common shape in any component tree. Left unfiltered it drowns the real
 * findings entirely.
 *
 * The `[:(={]` covers all three spellings a length appears in: a declaration
 * (`width: …`), a call (`translate(…)`), and an SVG or JSX attribute
 * (`offset={…}`), which is how a gradient stop is written and which the first
 * two forms missed.
 *
 * The colour functions (`hsl`/`rgb`/`hsla`/`rgba`) are here for the same
 * reason: `hsl(${h}deg ${s}% ${l}%)` is a CSS colour value, not a readout, so
 * its `deg`/`%` are CSS syntax the way `translate`'s `%` is (e.g. the dynamic
 * hue in `resourceColor`).
 */
const CSS_PROPERTY =
  /(width|height|left|top|right|bottom|transform|translate|inset|margin|padding|gap|flex|stroke|offset|dasharray|dashoffset|hsl|hsla|rgb|rgba)\s*[:(={]/i;

/** Somewhere a unit symbol was typed next to a number. */
export interface HandTypedUnit {
  /** Path relative to the scanned directory, with `/` separators. */
  file: string;
  /** 1-based, so it is clickable in a terminal. */
  line: number;
  /** The offending source line, trimmed. */
  source: string;
  /** The symbol that matched. */
  symbol: string;
}

export interface HandTypedUnitOptions {
  /** Directory to scan. Defaults to `src` under the current directory. */
  dir?: string;
  /** Override the symbols looked for. See {@link HAND_TYPED_SYMBOLS}. */
  symbols?: readonly string[];
  /**
   * Per-file allowance, keyed by the path as it appears in a finding. A file
   * at or below its entry passes. Only ever lower one: an entry that stops
   * being reachable is itself reported, so a conversion cannot silently leave
   * the door open behind it.
   */
  baseline?: Readonly<Record<string, number>>;
  /**
   * Extra paths to skip, matched against the relative path. Tests, snapshots,
   * `node_modules` and build output are already skipped.
   */
  ignore?: (file: string) => boolean;
}

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".turbo",
  "__snapshots__",
]);

const SOURCE = /\.(ts|tsx|js|jsx)$/;

/**
 * Blank out comments, keeping line structure so reported line numbers still
 * point at the source.
 *
 * A symbol inside prose is not a readout, and a file explaining WHY not to
 * write `${x.toFixed(1)} m/s` should not fail the guard for saying so. The
 * sibling guard on Earth days learned this the same way: it matched inside
 * comments, and the file documenting the rule was its own first offender.
 *
 * Not a parser, and it does not need to be. It only has to stop prose about
 * the rule from reading as a breach of it. Over-blanking would at worst hide a
 * symbol typed inside a string, and a `"12 km"` literal is a different problem
 * from an interpolation.
 */
function stripComments(source: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const line of source.split("\n")) {
    let kept = "";
    let i = 0;
    while (i < line.length) {
      if (inBlock) {
        if (line.startsWith("*/", i)) {
          inBlock = false;
          i += 2;
        } else {
          i += 1;
        }
        continue;
      }
      if (line.startsWith("/*", i)) {
        inBlock = true;
        i += 2;
        continue;
      }
      if (line.startsWith("//", i)) break;
      kept += line[i];
      i += 1;
    }
    out.push(kept);
  }
  return out;
}

function isTest(file: string): boolean {
  return file.includes(".test.") || file.includes(".spec.");
}

function walk(root: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(root, full, out);
      continue;
    }
    if (SOURCE.test(entry)) out.push(relative(root, full).split(sep).join("/"));
  }
}

/**
 * The pattern every offender takes: a `${…}` interpolation, then optionally
 * one space, then a unit symbol ending at a non-word boundary.
 *
 * Longest symbol first, so `m/s` cannot be matched as a bare `m` and reported
 * with the wrong symbol.
 */
function patternFor(symbols: readonly string[]): RegExp {
  const alternatives = [...symbols].sort((a, b) => b.length - a.length);
  const escaped = alternatives.map((s) =>
    s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  return new RegExp(`\\}\\s?(${escaped.join("|")})([^A-Za-z0-9_/]|\`|$)`);
}

/**
 * Every place a unit symbol is typed next to a number, under `dir`.
 *
 * Returns findings rather than throwing, so a caller can report them their own
 * way. {@link expectNoHandTypedUnits} is the assertion built on top.
 */
export function findHandTypedUnits(
  options: HandTypedUnitOptions = {},
): HandTypedUnit[] {
  const dir = options.dir ?? "src";
  const pattern = patternFor(options.symbols ?? HAND_TYPED_SYMBOLS);
  const files: string[] = [];
  walk(dir, dir, files);

  const found: HandTypedUnit[] = [];
  for (const file of files) {
    if (isTest(file)) continue;
    if (options.ignore?.(file)) continue;
    const raw = readFileSync(join(dir, file), "utf8").split("\n");
    stripComments(raw.join("\n")).forEach((code, index) => {
      const match = pattern.exec(code);
      if (match === null) return;
      if (CSS_PROPERTY.test(code)) return;
      found.push({
        file,
        line: index + 1,
        // The RAW line, so the report shows what is actually written there
        // rather than the blanked form the scan matched against.
        source: raw[index].trim(),
        symbol: match[1],
      });
    });
  }
  return found;
}

/**
 * Throws when a unit symbol is typed next to a number, with the fix in the
 * message rather than in a document somebody has to go and find.
 *
 * Silent when everything renders through `<Unit>`, and silent for a file at or
 * below its `baseline` entry. A file BELOW its entry throws too: leaving a
 * stale allowance in place is how a ratchet stops ratcheting, because the
 * symbol is then free to come back unnoticed.
 */
export function expectNoHandTypedUnits(
  options: HandTypedUnitOptions = {},
): void {
  const baseline = options.baseline ?? {};
  const found = findHandTypedUnits(options);

  const counts: Record<string, number> = {};
  for (const one of found) counts[one.file] = (counts[one.file] ?? 0) + 1;

  const over = found.filter(
    (one) => (counts[one.file] ?? 0) > (baseline[one.file] ?? 0),
  );
  if (over.length > 0) {
    throw new Error(
      `A unit symbol was typed next to a number in ${over.length} place(s). ` +
        "Render <Unit value={x} /> instead, so the symbol keeps its styling, " +
        "follows the value's ladder, and is announced as a word rather than " +
        "as letters.\n\nWhere a string is genuinely required: speakQuantity " +
        "for an accessible name, writeQuantity for visible text that is " +
        "MEASURED (an SVG <text>, a canvas label), and nothing else.\n\n" +
        over
          .map((one) => `  ${one.file}:${one.line}  ${one.source}`)
          .join("\n"),
    );
  }

  const stale = Object.keys(baseline).filter(
    (file) => (counts[file] ?? 0) < baseline[file],
  );
  if (stale.length > 0) {
    throw new Error(
      "These are below their baseline, which is good news. Lower or remove " +
        "the entry so the gain is locked in, otherwise the symbol is free to " +
        `come back:\n${stale
          .map((f) => `  ${f}: now ${counts[f] ?? 0}, baseline ${baseline[f]}`)
          .join("\n")}`,
    );
  }
}
