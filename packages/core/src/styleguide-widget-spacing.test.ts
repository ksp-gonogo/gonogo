import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Design-system bans on how spacing is written, across every file git tracks.
 *
 * The SEMANTIC SPACING block in `packages/theme/src/tokens.css` names every
 * job a space does over a ladder of raw rungs, and the rest of the repo reads
 * the names. Three spellings route around that and each is banned outright:
 *
 *   - a raw rung (the `--space-` namespace) anywhere but a tokens.css
 *     definition. A rung says how many pixels; a name says which job, and the
 *     job is what a reader needs and what a container can change
 *   - a t-shirt size (`xs` to `xl`) on a layout primitive's `gap`, `rowGap`,
 *     `space` or `pad`. A size is a rung under another name. The primitives
 *     take the name of a gap or inset job instead
 *   - a literal fallback on a token tokens.css declares, such as a px value
 *     after the comma. The sheet always defines the token, so the fallback
 *     never renders, and a dead literal beside a token is a second value
 *     nothing checks against the first
 *
 * A site whose job has no name gets one in tokens.css. There is no exemption
 * list and no ceiling to raise.
 *
 * Every file is read whole, comments included: a comment that shows the next
 * author a rung or a size teaches the thing this bans. So the plants below are
 * assembled at runtime, and this file names none of the three in source.
 *
 * Blind to anything assembled at runtime elsewhere (`"--space-" + n`), because
 * this reads source text. Nothing in the tree builds one.
 */

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

const TOKENS_CSS = "packages/theme/src/tokens.css";

interface Use {
  file: string;
  line: number;
  found: string;
}

/** Blank a comment out, keeping its newlines so line numbers stay true. */
function blankOut(match: string): string {
  return match.replace(/[^\n]/g, " ");
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

/** Every tracked text file matching an extended regex, as git sees it. */
function trackedFilesMatching(pattern: string): string[] {
  return execFileSync("git", ["grep", "-I", "-l", "-z", "-E", "-e", pattern], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
}

/**
 * Every tracked source and document a layout prop can be written in. Read
 * whole rather than pre-filtered by a grep, because the tree holds no size to
 * match and a filter that finds nothing cannot be told from one that is broken.
 */
function trackedSourcesAndDocs(): string[] {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((rel) => /\.(tsx?|jsx?|mdx?)$/.test(rel));
}

const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const NAMESPACE = "--space-";
const RUNG = new RegExp(`${NAMESPACE}[a-z0-9]+(?![\\w-])`, "g");

/** Every rung reference in a file other than `tokens.css`. */
function rungUses(source: string, file: string): Use[] {
  const lineOf = lineIndexer(source);
  return [...source.matchAll(RUNG)].map((match) => ({
    file,
    line: lineOf(match.index),
    found: match[0],
  }));
}

/**
 * The rung references in `tokens.css` that are not the value of a custom
 * property declaration. Comments are blanked first: the ladder documents its
 * own rungs.
 */
function tokensSheetMisuses(source: string, file: string): Use[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, blankOut);
  const lineOf = lineIndexer(stripped);
  const out: Use[] = [];
  for (const decl of stripped.matchAll(/([-\w]+)\s*:([^;{}]*)/g)) {
    if (decl[1].startsWith("--")) continue;
    const valueStart = decl.index + decl[0].length - decl[2].length;
    for (const match of decl[2].matchAll(RUNG)) {
      out.push({
        file,
        line: lineOf(valueStart + match.index),
        found: match[0],
      });
    }
  }
  return out;
}

function scanForRungs(source: string, file: string): Use[] {
  return file === TOKENS_CSS
    ? tokensSheetMisuses(source, file)
    : rungUses(source, file);
}

const SIZES = ["xs", "sm", "md", "lg", "xl"];
const SIZE_PROPS = ["gap", "rowGap", "space", "pad"];

/**
 * A layout prop given a literal value, in the three spellings a JSX attribute
 * can take (a bare string, a braced string and an array) and as a key of the
 * object handed to `.attrs()`. The leading class rules out a styled-component's
 * transient `$gap`. An object key holding a size is never bespoke CSS, since
 * no CSS property takes `md` as a value.
 */
const SIZE_PROP = new RegExp(
  `(^|[^\\w$.-])(${SIZE_PROPS.join("|")})\\s*(?:=|:)\\s*` +
    `("[a-z-]+"|\\{\\s*"[a-z-]+"\\s*\\}|\\{\\s*\\[[^\\]]*\\]\\s*\\}|\\[[^\\]]*\\])`,
  "g",
);

function sizeUses(source: string, file: string): Use[] {
  const lineOf = lineIndexer(source);
  const out: Use[] = [];
  for (const match of source.matchAll(SIZE_PROP)) {
    const quoted = [...match[3].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
    if (!quoted.some((value) => SIZES.includes(value))) continue;
    out.push({
      file,
      line: lineOf(match.index),
      found: `${match[2]}=${match[3].trim().slice(0, 40)}`,
    });
  }
  return out;
}

/** Every custom property `tokens.css` declares, in any rule. */
function declaredTokens(): Set<string> {
  const sheet = read(TOKENS_CSS).replace(/\/\*[\s\S]*?\*\//g, blankOut);
  return new Set([...sheet.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

/**
 * A `var()` of a declared token whose fallback is a literal. A fallback that
 * is itself a `var()` is a different decision and is left alone, and so is a
 * fallback on a name the sheet does not declare, where it is what renders.
 */
function fallbackUses(
  source: string,
  file: string,
  declared: Set<string>,
): Use[] {
  const lineOf = lineIndexer(source);
  const out: Use[] = [];
  for (const match of source.matchAll(/var\(\s*(--[a-z0-9-]+)\s*,\s*/g)) {
    if (!declared.has(match[1])) continue;
    const rest = source.slice(match.index + match[0].length);
    if (rest.startsWith("var(")) continue;
    out.push({
      file,
      line: lineOf(match.index),
      found: `${match[1]}, ${rest.split(/[)\n]/)[0].slice(0, 24)}`,
    });
  }
  return out;
}

function report(uses: Use[]): string {
  return uses.map((u) => `  ${u.file}:${u.line}  ${u.found}`).join("\n");
}

const DECLARED = declaredTokens();
const RUNG_PATTERN = `${NAMESPACE}[a-z0-9]+`;
const FALLBACK_PATTERN = "var\\( *--[a-z0-9-]+ *,";

describe("design-system: spacing is written as a job, everywhere", () => {
  it("references a raw rung nowhere but a tokens.css definition", () => {
    const uses = trackedFilesMatching(RUNG_PATTERN).flatMap((rel) =>
      scanForRungs(read(rel), rel),
    );
    expect(
      uses,
      `${uses.length} raw spacing rung reference(s):\n${report(uses)}\n` +
        `Read the job's name from the SEMANTIC SPACING block in ${TOKENS_CSS} ` +
        `instead. If the job has no name, add one there, defined from the rungs, ` +
        `and read that.`,
    ).toEqual([]);
  });

  it("passes no t-shirt size to a layout primitive", () => {
    const uses = trackedSourcesAndDocs().flatMap((rel) =>
      sizeUses(read(rel), rel),
    );
    expect(
      uses,
      `${uses.length} t-shirt spacing size(s):\n${report(uses)}\n` +
        `Pass the job instead: a gap name from GapToken, or an inset name from ` +
        `InsetToken for Box's pad, both in packages/ui-kit/src/scales.ts. Better ` +
        `still, pass nothing and let the container decide.`,
    ).toEqual([]);
  });

  it("gives no declared token a literal fallback", () => {
    const uses = trackedFilesMatching(FALLBACK_PATTERN).flatMap((rel) =>
      fallbackUses(read(rel), rel, DECLARED),
    );
    expect(
      uses,
      `${uses.length} literal fallback(s) on a token ${TOKENS_CSS} declares:\n` +
        `${report(uses)}\nThe sheet defines every one of these, so the ` +
        `fallback never renders. Delete it.`,
    ).toEqual([]);
  });

  // Each grep decides which files get read, so each is proved against files
  // that must always match it.
  it("actually searched the tree", () => {
    expect(trackedFilesMatching(RUNG_PATTERN)).toContain(TOKENS_CSS);
    const ladder = new RegExp(`(${RUNG_PATTERN})\\s*:`, "g");
    expect([...read(TOKENS_CSS).matchAll(ladder)].length).toBeGreaterThan(8);
    expect(DECLARED.has("--gap-related")).toBe(true);
    expect(DECLARED.has("--radius-regular")).toBe(true);
    expect(trackedFilesMatching(FALLBACK_PATTERN).length).toBeGreaterThan(0);
    const sources = trackedSourcesAndDocs();
    expect(sources.length).toBeGreaterThan(1000);
    expect(sources).toContain("packages/ui-kit/src/Stack.tsx");
  });
});

/**
 * A scan that has stopped matching reports zero and zero reads as a clean tree,
 * so every run plants each spelling and fails as BLIND rather than green. The
 * other half is the one a matcher usually gets wrong: a pattern loose enough to
 * find every offence also finds things that are not offences, and a gate that
 * fires on `justify="between"` gets loosened until it fires on nothing.
 */
describe("design-system: the spacing bans can see a violation", () => {
  const rung = (step: string) => `${NAMESPACE}${step}`;
  const prop = (name: string, value: string) => `${name}="${value}"`;
  const fallback = (token: string, value: string) => `var(${token}, ${value})`;

  const RUNGS_CAUGHT: [string, string][] = [
    ["plant.tsx", `  gap: var(${rung("8")});`],
    ["plant.tsx", `  padding: "var(${rung("6")}) var(${rung("12")})",`],
    ["plant.tsx", `  \${(p) => (p.$tight ? "var(${rung("hair")})" : "0")};`],
    ["plant.tsx", `  /* ${rung("16")} is the gutter */`],
    ["plant.tsx", `  margin: var(${rung("3")});`],
    ["plant.md", `Write \`gap: var(${rung("4")})\`.`],
    [TOKENS_CSS, `:root {\n  padding: var(${rung("8")});\n}`],
    [
      TOKENS_CSS,
      `:root { --gap-x: var(${rung("4")}); gap: var(${rung("4")}); }`,
    ],
  ];

  const RUNGS_IGNORED: [string, string][] = [
    ["plant.tsx", "  gap: var(--gap-related);"],
    ["plant.tsx", "  padding: var(--inset-surface);"],
    ["plant.tsx", "  letter-spacing: 0.04em;"],
    [TOKENS_CSS, `:root {\n  --gap-related: var(${rung("8")});\n}`],
    [TOKENS_CSS, `:root {\n  ${rung("8")}: 8px;\n}`],
    [TOKENS_CSS, `/* padding: var(${rung("8")}) is how not to */`],
  ];

  const SIZES_CAUGHT = [
    `<Stack ${prop("gap", "sm")}>`,
    `<Cluster justify="between" ${prop("gap", "md")} wrap>`,
    `<Box pad={["${SIZES[0]}", "${SIZES[2]}"]}>`,
    `<Grid ${prop("rowGap", "lg")} />`,
    `<Divider ${prop("space", "xs")} />`,
    `<Inline gap={"${SIZES[4]}"} />`,
    `styled(Stack).attrs({ gap: "${SIZES[1]}" as const })`,
    `  rowGap: "${SIZES[3]}",`,
  ];

  const SIZES_IGNORED = [
    '<Cluster justify="between" align="center">',
    "<Stack gap={density} />",
    '  gap: "related",',
    `<Stack__Root $${prop("gap", "sm")} />`,
    '<Stack gap="related-dense">',
    '<Box pad="chip-readout">',
  ];

  const FALLBACKS_CAUGHT = [
    `  border-radius: ${fallback("--radius-regular", "3px")};`,
    `  gap: ${fallback("--gap-related", "8px")};`,
    `  z-index: ${fallback("--z-dropdown", "200")};`,
    `  transition: opacity ${fallback("--duration-fast", "120ms")};`,
  ];

  const FALLBACKS_IGNORED = [
    "  border-radius: var(--radius-regular);",
    `  background: ${fallback("--color-tag-purple-bg", "var(--color-surface-raised)")};`,
    `  min-height: ${fallback("--block-body-floor", "9rem")};`,
  ];

  for (const [file, source] of RUNGS_CAUGHT) {
    it(`sees the rung in ${JSON.stringify(source)} in ${file}`, () => {
      expect(
        scanForRungs(source, file),
        `the raw-rung ban is BLIND to ${JSON.stringify(source)}`,
      ).not.toEqual([]);
    });
  }

  for (const [file, source] of RUNGS_IGNORED) {
    it(`leaves ${JSON.stringify(source)} in ${file} alone`, () => {
      expect(scanForRungs(source, file)).toEqual([]);
    });
  }

  it("reports the line a rung sits on", () => {
    expect(
      scanForRungs(`:root {\n\n  padding: var(${rung("8")});\n}`, TOKENS_CSS),
    ).toEqual([{ file: TOKENS_CSS, line: 3, found: rung("8") }]);
  });

  for (const source of SIZES_CAUGHT) {
    it(`sees the size in ${source}`, () => {
      expect(
        sizeUses(source, "plant.tsx"),
        `the t-shirt ban is BLIND to ${JSON.stringify(source)}`,
      ).not.toEqual([]);
    });
  }

  for (const source of SIZES_IGNORED) {
    it(`leaves ${source} alone`, () => {
      expect(sizeUses(source, "plant.tsx")).toEqual([]);
    });
  }

  it("grades every size", () => {
    for (const size of SIZES) {
      expect(
        sizeUses(`<Stack ${prop("gap", size)} />`, "plant.tsx"),
        `${size} is a size the ban cannot see`,
      ).not.toEqual([]);
    }
  });

  for (const source of FALLBACKS_CAUGHT) {
    it(`sees the fallback in ${source.trim()}`, () => {
      expect(
        fallbackUses(source, "plant.tsx", DECLARED),
        `the fallback ban is BLIND to ${JSON.stringify(source)}`,
      ).not.toEqual([]);
    });
  }

  for (const source of FALLBACKS_IGNORED) {
    it(`leaves ${source.trim()} alone`, () => {
      expect(fallbackUses(source, "plant.tsx", DECLARED)).toEqual([]);
    });
  }
});
