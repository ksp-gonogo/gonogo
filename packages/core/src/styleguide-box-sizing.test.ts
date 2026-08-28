// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One border-box reset, in the sheet every gonogo page loads, and nowhere else.
 *
 * `box-sizing` is a document-level decision and this tree made it 36 times, once
 * per place somebody noticed: `width: 100%` beside horizontal padding resolves
 * to 100% PLUS the padding under the default `content-box`, so the rule that
 * overflows reads as if it asks for exactly the space it has. Two shipped bugs
 * came from the places nobody had noticed yet, the panel toolbar hanging 32px
 * past its own panel at every tile width and a fill empty state slicing its own
 * sentence in four widgets.
 *
 * So the reset lives in `packages/theme/src/tokens.css`, which the app imports
 * and every render probe injects verbatim, and a local `box-sizing` declaration
 * is a spot-fix for something the page already settled. This is a hard boundary
 * rather than a shrink-only baseline: the population is one, and there is no
 * legitimate second.
 *
 * A local declaration would be harmless where it agrees with the reset and
 * invisible where it does not, which is the reason to keep the count at one
 * rather than to police the value.
 */

/** The one file allowed to say it, and the rule it has to say. */
const RESET_FILE = "packages/theme/src/tokens.css";
const RESET_SELECTOR =
  "*,\n*::before,\n*::after {\n  box-sizing: border-box;\n}";

/** A declaration, not prose: the property, then a colon. A comment saying
 *  "border-box" is describing the reset rather than making one. */
const DECLARATION = /box-sizing\s*:/;

/** Anything that reaches a browser as CSS: stylesheets, styled-components
 *  templates, and the probe pages' own hand-written `<style>` blocks. */
const STYLED_FILE = /\.(css|ts|tsx|html)$/;

/**
 * Pages that are not gonogo pages, so the reset is not theirs to inherit. Each
 * entry is a document that never loads the theme sheet and has to say it itself.
 */
const OWN_DOCUMENT = [
  // The public marketing page: one hand-written file, served on its own, with
  // no build step and no import of the theme package.
  "docs/homepage/index.html",
  // This guard, which quotes the rule it is looking for.
  "packages/core/src/styleguide-box-sizing.test.ts",
];

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
}

interface Hit {
  file: string;
  line: number;
  text: string;
}

/** Tracked files and untracked-but-not-ignored ones, so a spot-fix written into
 *  a brand new file fails on the commit that introduces it rather than the one
 *  after. */
function candidates(root: string): string[] {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\n")
    .filter((f) => STYLED_FILE.test(f))
    .filter((f) => !f.includes("/dist/"));
}

function declarationsIn(source: string, file: string): Hit[] {
  const hits: Hit[] = [];
  source.split("\n").forEach((text, i) => {
    if (DECLARATION.test(text))
      hits.push({ file, line: i + 1, text: text.trim() });
  });
  return hits;
}

function scan(): Hit[] {
  const root = repoRoot();
  const hits: Hit[] = [];
  for (const file of candidates(root)) {
    let source: string;
    try {
      source = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    hits.push(...declarationsIn(source, file));
  }
  return hits;
}

describe("box-sizing is set once, for the whole document", () => {
  it("declares the reset in the theme sheet", () => {
    const css = readFileSync(join(repoRoot(), RESET_FILE), "utf8");
    expect(css).toContain(RESET_SELECTOR);
  });

  it("has no other declaration anywhere", () => {
    const strays = scan().filter(
      (h) => h.file !== RESET_FILE && !OWN_DOCUMENT.includes(h.file),
    );
    if (strays.length > 0) {
      throw new Error(
        `${strays.length} local box-sizing declaration(s), where the ` +
          `document already sets one:\n` +
          `${strays.map((h) => `  ${h.file}:${h.line}  ${h.text}`).join("\n")}\n\n` +
          `Delete it: ${RESET_FILE} sets border-box on everything, the app ` +
          `imports that sheet and every render probe injects it. If a box ` +
          `genuinely needs content-box, it needs a comment saying which ` +
          `measurement is the load-bearing one, and this guard's reasoning ` +
          `revisited rather than an exception bolted on.`,
      );
    }
  });

  it("sees a declaration it plants, so a clean scan means something", () => {
    const planted = declarationsIn(
      "  padding: 4px;\n  box-sizing: content-box;\n",
      "planted.css",
    );
    expect(planted).toHaveLength(1);
    expect(planted[0].line).toBe(2);
    // Prose about the reset is not a declaration, and a guard that counted it
    // would fail on its own documentation.
    expect(
      declarationsIn("/* the border-box reset */\n", "planted.css"),
    ).toEqual([]);
  });
});
