import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { styleguideScanRoots } from "./styleguideScanRoots";

/**
 * Design-system guard: every `var(--token)` reference must resolve to a
 * token that actually exists.
 *
 * The sibling guards cover the other two ways a token can go wrong:
 * `styleguide-tokens.test.ts` catches a literal written instead of a
 * token, and `tokenSingleSource.test.ts` catches a second copy of the
 * declarations. Neither catches the third and quietest failure, a
 * reference to a name that was never declared.
 *
 * It is quiet because CSS makes it quiet. An unresolvable `var()` with no
 * fallback makes the whole declaration invalid at computed-value time, so
 * the property silently falls back to its inherited or initial value. A
 * colour becomes whatever the parent was using and still looks like a
 * deliberate choice; a background disappears; a border vanishes. Nothing
 * throws, nothing logs, and a screenshot looks plausible.
 *
 * This is not hypothetical. Every one of these shipped:
 *   - `--color-status-warn-bg`, a typo for `--color-status-warning-bg`, so
 *     a status badge rendered as ordinary muted text with no signal at all;
 *   - `--color-status-nogo-on-bg` added to the theme package while the app
 *     read a second copy that lacked it, so the badge it was added to fix
 *     got WORSE, 2.04:1 against the 2.61:1 it was correcting;
 *   - `--color-border`, `--color-text-secondary`, `--color-surface-elevated`
 *     and `--color-danger-fg`/`--color-warning-fg`, none of which have ever
 *     existed, leaving an invisible button border, unstyled secondary text
 *     and a severity readout with no severity colour.
 *
 * Two of those three were found by a human opening a PNG, which is not a
 * gate. This is.
 *
 * A reference WITH a fallback (`var(--space-8, 8px)`) is deliberately not
 * flagged: the fallback is what makes it safe, and ui-kit uses that form on
 * purpose for a host that mounts no stylesheet at all.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");

/** Where tokens are declared. One file, and it is the source of truth. */
const TOKEN_SOURCES = ["packages/theme/src/tokens.css"];

/** `--foo:` in a stylesheet, and `"--foo":` in a JS style object. */
const DECLARATION_RE = /(--[a-z0-9-]{2,})["']?\s*:/g;

/** A `var(--foo)` with NO comma, i.e. no fallback to save it. */
const BARE_REFERENCE_RE = /var\(\s*(--[a-z0-9-]{2,})\s*\)/g;

function matches(text: string, re: RegExp): string[] {
  return [...text.matchAll(re)].map((m) => m[1]);
}

/**
 * Blank out block and line comments, preserving line structure so
 * reported line numbers stay right.
 *
 * Needed because comments legitimately discuss tokens by name, including
 * ones that deliberately do not exist: the note in `Strategies` explaining
 * why an undeclared `--color-status-go-muted` was removed would otherwise
 * fail this guard, which would teach authors to stop writing the note. Not
 * a full parser, and it does not need to be: over-blanking inside a string
 * that looks like a comment can only hide a reference, and a reference this
 * misses is a reference the CSS engine was never going to see either.
 */
function stripComments(source: string): string {
  let out = "";
  let inBlock = false;
  let inLine = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "\n") {
      inLine = false;
      out += ch;
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        out += "  ";
        i++;
        continue;
      }
      out += " ";
      continue;
    }
    if (inLine) {
      out += " ";
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      out += "  ";
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      out += "  ";
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

function collectDeclared(): Set<string> {
  const declared = new Set<string>();

  for (const rel of TOKEN_SOURCES) {
    const abs = join(REPO, rel);
    if (!existsSync(abs)) continue;
    const text = stripComments(readFileSync(abs, "utf8"));
    for (const name of matches(text, DECLARATION_RE)) {
      declared.add(name);
    }
  }

  // Locally-scoped custom properties: a component may declare its own on an
  // element (`--scroll-glow-pad-y`) or set one from JS
  // (`style={{ "--apsis-focus-stroke-w": ... }}`) and read it in a child.
  // Those are legitimate and are not theme tokens, so any name declared
  // anywhere in the scanned source counts as declared. That deliberately
  // trades some precision for zero false positives: the failure this guard
  // exists to catch is a name that appears NOWHERE as a declaration.
  for (const file of styleguideScanRoots(REPO).flatMap(sourceFiles)) {
    const text = stripComments(readFileSync(file, "utf8"));
    for (const name of matches(text, DECLARATION_RE)) {
      declared.add(name);
    }
  }

  return declared;
}

function sourceFiles(root: string): string[] {
  const abs = join(REPO, root);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        walk(full);
        continue;
      }
      if (/\.(ts|tsx|css)$/.test(entry.name)) out.push(full);
    }
  };
  walk(abs);
  return out;
}

interface DanglingReference {
  file: string;
  line: number;
  token: string;
}

function collectDangling(declared: Set<string>): DanglingReference[] {
  const dangling: DanglingReference[] = [];

  for (const file of styleguideScanRoots(REPO).flatMap(sourceFiles)) {
    const rel = file.slice(REPO.length + 1);
    // This file names undeclared tokens on purpose, as examples.
    if (rel.endsWith("styleguide-token-refs.test.ts")) continue;

    const lines = stripComments(readFileSync(file, "utf8")).split("\n");
    lines.forEach((text, i) => {
      for (const token of matches(text, BARE_REFERENCE_RE)) {
        if (!declared.has(token)) {
          dangling.push({ file: rel, line: i + 1, token });
        }
      }
    });
  }

  return dangling;
}

describe("design-system: every token reference resolves", () => {
  // This walks every source file in the workspace twice, once to collect the
  // declared tokens and once to find references. That is ~1.5s alone and well
  // past vitest's 5s default under `turbo test`, where a dozen packages compete
  // for the same cores: it timed out at 30s on a machine running other work,
  // on staging as well as on a branch, which reads as a design-system
  // regression and is only ever contention. The scan's job is to be exhaustive,
  // not fast, so it gets room rather than a narrower walk.
  it("has no var(--token) that was never declared", {
    timeout: 120_000,
  }, () => {
    const declared = collectDeclared();
    const dangling = collectDangling(declared);

    if (dangling.length > 0) {
      const detail = dangling
        .map((d) => `  ${d.file}:${d.line}  var(${d.token})`)
        .join("\n");
      throw new Error(
        `${dangling.length} reference(s) to a token that does not exist:\n` +
          `${detail}\n` +
          `An unresolvable var() with no fallback makes the whole ` +
          `declaration invalid, so the property silently falls back to its ` +
          `inherited or initial value and the render still looks ` +
          `deliberate. Either fix the name (the tokens are declared in ` +
          `packages/theme/src/tokens.css), add the token there if it ` +
          `genuinely should exist, or give the reference a fallback if the ` +
          `property is meant to be optional.`,
      );
    }

    expect(dangling).toEqual([]);
  });

  it("finds the tokens it is supposed to be reading", () => {
    // Guards the guard: if TOKEN_SOURCES ever stops resolving, every
    // reference in the repo becomes "undeclared" and the test above turns
    // into noise, or the walk silently reads nothing and it passes forever.
    const declared = collectDeclared();
    expect(declared.has("--color-surface-panel")).toBe(true);
    expect(declared.has("--space-8")).toBe(true);
    expect(declared.has("--color-token-that-does-not-exist")).toBe(false);
  });

  /**
   * The other half of the same guard, and the half that was missing. The check
   * above proves the DECLARATION scan works; nothing proved the REFERENCE scan
   * does, and `dangling` is empty both when every reference resolves and when
   * `BARE_REFERENCE_RE` has stopped matching. Those read identically, and the
   * failure this file exists to catch is silent in the browser too: an
   * unresolvable `var()` invalidates the declaration and the property falls back
   * to something that still looks deliberate. Two blind steps in a row is how
   * five of these shipped.
   *
   * The fallback case is graded here as well, because it is the one deliberate
   * exemption in the matcher and the easiest thing to break while widening it.
   */
  it("recognises a bare var() reference, and skips the ones it should", () => {
    const found = (source: string) => matches(source, BARE_REFERENCE_RE);
    expect(found("color: var(--color-surface-panel);"), "bare").toEqual([
      "--color-surface-panel",
    ]);
    expect(found("color: var( --space-8 );"), "padded").toEqual(["--space-8"]);
    expect(
      found("gap: var(--space-8, 8px);"),
      "a fallback is what makes a reference safe, and must NOT be flagged",
    ).toEqual([]);
    expect(
      found("border: 1px solid var(--color-border) var(--color-accent);"),
      "two on one line",
    ).toEqual(["--color-border", "--color-accent"]);
    expect(
      found("width: var(--x);"),
      "a one-character name, which the {2,} in the pattern excludes on purpose so a minified `var(--a)` in vendor CSS is not read as a token",
    ).toEqual([]);
  });

  /**
   * And that the two halves meet: a dangling reference in a real scanned file
   * is what the gate reports, not just what the matcher can see in a string.
   * `collectDangling` walks the tree and filters against the declared set, and
   * a mistake in either half produces the same empty list.
   */
  it("would report a dangling reference from a scanned file", () => {
    const declared = new Set(["--declared-one"]);
    const dangling = collectDangling(declared);
    expect(
      dangling.length,
      "with a declared set of one token, every other reference in the tree is dangling; an empty result here means the reference walk found nothing at all",
    ).toBeGreaterThan(50);
  });
});
