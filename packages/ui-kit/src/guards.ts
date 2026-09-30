import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Build-time guards an Uplink can run against its own source.
 *
 * Published as `@ksp-gonogo/ui-kit/guards`, separate from `./testing` because
 * it reads the filesystem (`node:fs`), which would break a browser test runner.
 *
 * ## Why
 *
 * A widget that writes
 *
 *     `${closingSpeed.toFixed(1)} m/s`
 *
 * type-checks and renders, but the symbol cannot be dimmed, cannot be kept off
 * a line break, is announced as the letters "m", "slash", "s", and does not
 * follow when the value's ladder changes rung. `<Unit>` solves all four.
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
 * lower it as you convert: a guessed conversion is worse than a hand-typed
 * symbol, because it renders a confident wrong label.
 */

/**
 * The symbols worth looking for, curated rather than derived from the unit
 * catalogue, whose tokens include ones never typed beside a number and short
 * ones that occur constantly in prose.
 *
 * Pass your own through `symbols` when your Uplink registers a unit of its own.
 *
 * @category Testing
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
  /*
   * Matching is case-sensitive, since single letters like `m` and `W` would
   * otherwise match prose and CSS, so a unit conventionally written both ways
   * (`rpm`, `RPM`) is listed in both spellings.
   */
  "rpm",
  "RPM",
  "dB",
  "rad/s",
  "bit/s",
  "J/s",
  "N·m",
  "m²",
  "Pa",
  "kg/m³",
  "g/m³",
];

/**
 * A CSS length or colour is not a readout. `[:(={]` covers a declaration
 * (`width: ...`), a call (`translate(...)`) and an attribute (`offset={...}`);
 * the colour functions cover `hsl(${h}deg ${s}% ${l}%)`.
 */
const CSS_PROPERTY =
  /(width|height|left|top|right|bottom|transform|translate|inset|margin|padding|gap|flex|stroke|offset|dasharray|dashoffset|hsl|hsla|rgb|rgba)\s*[:(={]/i;

/**
 * Somewhere a unit symbol was typed next to a number.
 *
 * @category Testing
 */
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

/**
 * Options for {@link findHandTypedUnits} and {@link expectNoHandTypedUnits}.
 *
 * @category Testing
 */
export interface HandTypedUnitOptions {
  /** Directory to scan. Defaults to `src` under the current directory. */
  dir?: string;
  /** Override the symbols looked for. See {@link HAND_TYPED_SYMBOLS}. */
  symbols?: readonly string[];
  /**
   * Per-file allowance, keyed by the path as it appears in a finding. A file
   * at its entry passes, and a file below it throws, so an allowance left
   * higher than needed is reported rather than left open.
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
 * point at the source, so prose about the rule is not a breach of it. Not a
 * parser: over-blanking would at worst hide a symbol inside a string literal.
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
 * The pattern every offender takes: a `${...}` interpolation, then optionally
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
 *
 * @category Testing
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
        // The raw line, not the blanked form the scan matched against.
        source: raw[index].trim(),
        symbol: match[1],
      });
    });
  }
  return found;
}

/**
 * Throws when a unit symbol is typed next to a number, with the fix in the
 * message. Silent for a file at its `baseline` entry; a file below its entry
 * throws, so an allowance left higher than needed cannot let the symbol come
 * back unnoticed.
 *
 * @example
 * ```ts
 * import { expectNoHandTypedUnits } from "@ksp-gonogo/ui-kit/guards";
 * import { it } from "vitest";
 *
 * it("renders units through <Unit>, not by typing the symbol", () => {
 *   expectNoHandTypedUnits({ dir: "src" });
 * });
 * ```
 *
 * @category Testing
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
