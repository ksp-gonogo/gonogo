// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No page in this repo may take vertical scrolling away from the document.
 *
 * The render probes are not only a headless fixture. Each driver writes its
 * prepared page to the temp directory and leaves it there, self-contained, so
 * an operator opens that file to look at a state a screenshot cropped. Seven of
 * them carried `html, body { overflow: hidden }` to keep a scrollbar out of the
 * viewport screenshot, and a viewer whose window was shorter than the render
 * could reach none of the content below the fold: the wheel did nothing, End
 * and PageDown did nothing, and the only thing that still moved the page was a
 * `scrollTo` from the console. Reported from a real session on 2026-09-12.
 *
 * `scrollbar-width: none` plus a hidden `::-webkit-scrollbar` is the way to
 * keep a scrollbar out of a capture: it reserves no gutter either, so the shot
 * is pixel-identical (checked over 25 console renders and 5 alarm banner
 * renders, byte for byte), and the page still scrolls.
 *
 * This is a hard boundary rather than a shrink-only baseline. No page in this
 * tree legitimately refuses the wheel, and an overlay that wants to freeze the
 * page behind it does that from script, on the element it owns, for as long as
 * it is open, not from the document's own stylesheet.
 */

/** Which of a rule's declarations, if any, pins the document's vertical
 *  overflow to a value that stops it scrolling. `overflow-x` is left alone: a
 *  page that clips sideways still scrolls down, and the shorthand's second
 *  value is the vertical one, so `overflow: hidden auto` scrolls too. */
function verticalLock(declaration: string): string | null {
  const m = /^overflow(-x|-y)?\s*:\s*(.+)$/.exec(declaration);
  if (!m) return null;
  const axis = m[1];
  if (axis === "-x") return null;
  const values = m[2].trim().split(/\s+/);
  const vertical = axis === "-y" ? values[0] : (values[1] ?? values[0]);
  return vertical === "hidden" || vertical === "clip" ? declaration : null;
}

/** Does this selector list reach the document's own scrolling box? */
function isPageSelector(selector: string): boolean {
  return selector
    .split(",")
    .some((part) => /^(html|body|:root)\b/.test(part.trim()));
}

interface Hit {
  file: string;
  selector: string;
  declaration: string;
}

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
}

/** Tracked files and untracked-but-not-ignored ones, so a new probe page fails
 *  on the commit that introduces it rather than the one after. */
function candidates(root: string): string[] {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\n")
    .filter((f) => f.endsWith(".html") || f.endsWith(".css"))
    .filter((f) => !f.includes("/dist/") && !f.includes("node_modules/"));
}

/**
 * Every `selector { ... }` block whose selector list names the page and whose
 * body locks vertical overflow. Comments are stripped first so prose about the
 * rule is not mistaken for the rule, and only blocks with no nested braces are
 * read, so an `@media` wrapper is skipped rather than mis-attributed to the
 * selector above it: no page here has one, and a false positive costs more
 * here than a miss.
 */
function blockingPageRules(source: string, file: string): Hit[] {
  const sheets = file.endsWith(".html") ? styleBlocks(source) : [source];
  const hits: Hit[] = [];
  for (const sheet of sheets) hits.push(...rulesIn(sheet, file));
  return hits;
}

/** The CSS inside a document's own `<style>` blocks, so the markup before the
 *  first rule is not read as part of its selector list. */
function styleBlocks(html: string): string[] {
  const blocks: string[] = [];
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    blocks.push(m[1]);
  }
  return blocks;
}

function rulesIn(source: string, file: string): Hit[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, " ");
  const hits: Hit[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].replace(/\s+/g, " ").trim();
    if (!isPageSelector(selector)) continue;
    for (const raw of m[2].split(";")) {
      const declaration = verticalLock(raw.trim());
      if (declaration) hits.push({ file, selector, declaration });
    }
  }
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
    hits.push(...blockingPageRules(source, file));
  }
  return hits;
}

describe("no page refuses to scroll", () => {
  it("has no document-level overflow lock in any page or stylesheet", () => {
    const hits = scan();
    if (hits.length > 0) {
      throw new Error(
        `${hits.length} page rule(s) take vertical scrolling away from the ` +
          `document:\n` +
          `${hits
            .map((h) => `  ${h.file}  ${h.selector} { ${h.declaration} }`)
            .join("\n")}\n\n` +
          `Anything below the fold becomes unreachable: the wheel, PageDown ` +
          `and End all stop working, and the content is still there, which is ` +
          `what makes it read as a broken page rather than a short one. To ` +
          `keep a scrollbar out of a screenshot use "scrollbar-width: none" ` +
          `plus a "display: none" on html::-webkit-scrollbar and ` +
          `body::-webkit-scrollbar, which reserves no gutter and so changes ` +
          `no pixels.`,
      );
    }
  });

  it("sees the locks it plants, so a clean scan means something", () => {
    // The shape the seven probe pages carried, in the document form they
    // carry it in: inside a `<style>` block, after a head full of markup.
    const planted = blockingPageRules(
      '<!doctype html><head><title>x</title><style id="probe-theme"></style>' +
        "<style>html,\nbody {\n  margin: 0;\n  overflow: hidden;\n}</style>" +
        "</head>",
      "planted.html",
    );
    expect(planted).toHaveLength(1);
    expect(planted[0].declaration).toBe("overflow: hidden");
    expect(planted[0].selector).toBe("html, body");

    for (const lock of [
      "body { overflow-y: clip; }",
      ":root { overflow: clip; }",
      "body.dark { overflow-y: hidden; }",
      // The shorthand's SECOND value is the vertical axis.
      "body { overflow: auto hidden; }",
    ]) {
      expect(blockingPageRules(lock, "planted.css"), lock).toHaveLength(1);
    }

    // The shapes that must NOT count, or the guard fails on a healthy tree.
    for (const clean of [
      "html,\nbody {\n  scrollbar-width: none;\n}\n",
      // A widget's own clipped box, not the page's.
      ".sr-only { overflow: hidden; }",
      // A selector that merely contains the word is somebody else's box.
      ".panel-body { overflow: hidden; }",
      // Sideways clipping leaves the page scrolling down.
      "body { overflow-x: hidden; }",
      "body { overflow: hidden auto; }",
      // Prose about the rule is not the rule.
      "html,\nbody {\n  /* never overflow: hidden here */\n  margin: 0;\n}\n",
    ]) {
      expect(blockingPageRules(clean, "planted.css"), clean).toEqual([]);
    }
  });
});
