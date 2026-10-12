// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  headerBlockAboveExportIn,
  mangledTablesIn,
  markupInTsDocIn,
  type ShapeHit,
  scanDocShape,
} from "./doc-shape.scan";
import { ratchetRepoRoot } from "./ratchetBaseRef";
import { scanScope } from "./scanScope";

/**
 * Doc-comment shape ratchet. A doc comment is read as TSDoc or XML doc and
 * shown as hover text and on the reference site, so three shapes that look fine
 * in source come out wrong there: a markdown table that does not line up, a
 * file-header block that touches the first export and becomes its doc, and an
 * HTML or C# doc tag in a TypeScript comment.
 *
 * There is no debt list: the tree was brought to zero in the commit that added
 * this gate.
 */

/** Spelled in two parts so this file's own source holds no comment block to scan. */
const OPEN = `${"/"}**`;
const CLOSE = `*${"/"}`;

const SCOPE = scanScope();
const RESULT = scanDocShape(SCOPE.covers);

const doc = (...lines: string[]) =>
  [OPEN, ...lines.map((l) => ` * ${l}`), ` ${CLOSE}`].join("\n");

const offenders = (found: Map<string, ShapeHit[]>) =>
  [...found].flatMap(([file, hits]) =>
    hits.slice(0, 3).map((h) => `${file}:${h.line}: ${h.reason}: ${h.text}`),
  );

describe("doc comment shape", () => {
  it("actually scanned the source tree", () => {
    console.info(
      `[doc-shape] ${SCOPE.label}, root ${ratchetRepoRoot()}, listed ${RESULT.enumerated} files, scanned ${RESULT.scanned}`,
    );
    expect(RESULT.enumerated).toBeGreaterThanOrEqual(3000);
    if (SCOPE.mode === "changed") return;
    expect(RESULT.scanned).toBeGreaterThanOrEqual(3000);
  });

  it("sees a planted mangled table in a TS and a C# doc comment", () => {
    const noSeparator = `${doc("| a | b |", "| 1 | 2 |")}\nexport const x = 1;`;
    const unevenRow = `${doc("| a | b |", "| - | - |", "| 1 | 2 | 3 |")}\nexport const x = 1;`;
    const folded = `${doc("| a | b | | --- | --- | | 1 | 2 |")}\nexport const x = 1;`;
    const cs =
      "/// <summary>\n/// | a | b |\n/// | 1 | 2 |\n/// </summary>\nclass A {}";
    expect(mangledTablesIn(noSeparator, false)).toHaveLength(1);
    expect(mangledTablesIn(unevenRow, false)).toHaveLength(1);
    expect(mangledTablesIn(folded, false)).toHaveLength(1);
    expect(mangledTablesIn(cs, true)).toHaveLength(1);
    expect(mangledTablesIn(noSeparator, false)[0].line).toBe(2);
  });

  it("passes a well-formed table, escaped and quoted pipes, and a fenced one", () => {
    const ok = [
      doc(
        "| name | form |",
        "| ---- | :--: |",
        "| `a|b` | x \\| y |",
        "",
        "```",
        "| not | a table",
        "```",
      ),
      "export const x = 1;",
    ].join("\n");
    expect(mangledTablesIn(ok, false)).toEqual([]);
    const cs = "/// | a | b |\n/// |---|---|\n/// | 1 | 2 |\nclass A {}";
    expect(mangledTablesIn(cs, true)).toEqual([]);
  });

  it("sees a planted file header above a declaration and leaves the declaration's own doc", () => {
    const header = [
      doc("The history buffer in this file records transitions.", "", "More."),
      "export interface A {}",
    ].join("\n");
    expect(headerBlockAboveExportIn(header)).toHaveLength(1);
    expect(headerBlockAboveExportIn(header)[0].line).toBe(1);
    const own = [
      doc("A link, as the buffer reads it."),
      "export interface A {}",
    ];
    expect(headerBlockAboveExportIn(own.join("\n"))).toEqual([]);
    const separated = `${doc("This file does a thing.")}\n\n${doc("A.")}\nexport interface A {}`;
    expect(headerBlockAboveExportIn(separated)).toEqual([]);
    const reexport = `${doc("This file re-exports the spine.")}\nexport * from "./spine";`;
    expect(headerBlockAboveExportIn(reexport)).toEqual([]);
  });

  it("sees planted HTML and C# tags in a TS doc comment and passes what is not prose", () => {
    const bad = doc(
      "<p>A paragraph.</p>",
      'A <b>bold</b> word and <see cref="X"/> and <para>text</para>.',
    );
    expect(markupInTsDocIn(bad).map((h) => h.text)).toEqual([
      "<p>",
      "</p>",
      "<b>",
      "</b>",
      '<see cref="X"/>',
      "<para>",
      "</para>",
    ]);
    const ok = doc(
      "A `<p>` in code, a {@link Foo<T>}, and Promise<void> or Array<string>.",
      "```html",
      "<p>fenced</p>",
      "```",
      "@example",
      "<b>shown</b>",
    );
    expect(markupInTsDocIn(ok)).toEqual([]);
  });

  it("finds no mangled table in any doc comment", () => {
    expect(
      offenders(RESULT.tables),
      "A doc comment holds a markdown table that will not render. Give it a header row, a separator row of dashes directly under it, and the same number of cells in every row.",
    ).toEqual([]);
  });

  it("finds no file-header block above an export in a published package", () => {
    expect(
      offenders(RESULT.headers),
      "A doc block that opens the file and touches the first export is that export's hover text. Turn it into a plain block comment, or separate it with a blank line and give the export its own doc.",
    ).toEqual([]);
  });

  it("finds no HTML or C# doc tag in a published TS doc comment", () => {
    expect(
      offenders(RESULT.markup),
      "TSDoc renders none of <p>, <b>, <para> or <see cref>. Separate paragraphs with a blank line, use ** for bold, and {@link} for a reference.",
    ).toEqual([]);
  });
});
