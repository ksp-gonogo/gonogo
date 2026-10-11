// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ACRONYMS,
  emphasisIn,
  proseMask,
  scanDocEmphasis,
} from "./doc-emphasis.scan";
import { ratchetRepoRoot } from "./ratchetBaseRef";
import { scanScope } from "./scanScope";

/**
 * Doc-comment emphasis ratchet. CLAUDE.md says a word in capitals is an acronym
 * or a label the UI prints, never stress, and that a sentence needing the stress
 * to be read correctly is reworded. A doc comment (`/** *\/` in TS and TSX,
 * `///` in C#) is held to zero anywhere in the repo, published or not. A plain
 * `//` comment is outside it.
 *
 * There is no debt list: the tree was brought to zero in the commit that added
 * this gate, and a new hit is new prose. An acronym or unit that is really a
 * name belongs in `ACRONYMS`; a label the UI prints goes in code font or quotes.
 */

/** Spelled in two parts so this file's own source holds no comment block to scan. */
const OPEN = `${"/"}**`;
const CLOSE = `*${"/"}`;

const SCOPE = scanScope();
const RESULT = scanDocEmphasis(SCOPE.covers);

describe("doc comment emphasis", () => {
  it("actually scanned the source tree", () => {
    const total = [...RESULT.hits.values()].reduce((a, h) => a + h.length, 0);
    console.info(
      `[doc-emphasis] ${SCOPE.label}, root ${ratchetRepoRoot()}, listed ${RESULT.enumerated} files, scanned ${RESULT.scanned}, ${total} hits`,
    );
    expect(RESULT.enumerated).toBeGreaterThanOrEqual(3000);
    if (SCOPE.mode === "changed") return;
    expect(RESULT.scanned).toBeGreaterThanOrEqual(3000);
  });

  it("sees a planted emphasis word in a TS doc comment and a C# one", () => {
    const ts = `${OPEN}\n * The delay is NOT applied twice.\n ${CLOSE}\nexport const x = 1;`;
    const cs = "/// <summary>The value MUST be finite.</summary>\nclass A {}";
    expect(emphasisIn(ts, false).map((h) => h.word)).toEqual(["NOT"]);
    expect(emphasisIn(cs, true).map((h) => h.word)).toEqual(["MUST"]);
    expect(emphasisIn(ts, false)[0].line).toBe(2);
  });

  it("passes acronyms, units, quoted labels, code and plain comments", () => {
    const ok = [
      OPEN,
      " * The KSP UT in JSON, at the SOI edge, 12 MB.",
      ' * The pill reads "NO DATA" or `HELD`, and {@link HELD} is a label.',
      " * Pins AG1 and M2 and TS2367.",
      " * ```ts",
      " * const x = NEVER;",
      " * ```",
      ` ${CLOSE}`,
      "// NOT a doc comment",
      `/* ALSO not a doc comment ${CLOSE}`,
    ].join("\n");
    expect(emphasisIn(ok, false)).toEqual([]);
    const cs = [
      '/// <summary>Fails as <c>BLIND</c> and reads <see cref="NEVER"/>.</summary>',
      "// NOT a doc comment",
    ].join("\n");
    expect(emphasisIn(cs, true)).toEqual([]);
  });

  it("masks a span to the same length so an offset stays valid", () => {
    const body = 'a "NO DATA" b `CODE` c';
    expect(proseMask(body)).toHaveLength(body.length);
    expect(ACRONYMS.has("KSP")).toBe(true);
    expect(ACRONYMS.has("NOT")).toBe(false);
  });

  it("finds no emphasis capitals in any doc comment", () => {
    const offenders: string[] = [];
    for (const [file, hits] of RESULT.hits) {
      for (const h of hits.slice(0, 3)) {
        offenders.push(
          `${file}:${h.line}: ${h.word} -> ${h.text.slice(0, 90)}`,
        );
      }
    }
    expect(
      offenders,
      [
        "A doc comment uses a word in capitals for emphasis.",
        "",
        "CLAUDE.md: no capitals for emphasis. A word in capitals is an acronym or",
        "a label the UI prints. Lower the word; if the sentence needs the stress",
        "to be read correctly, reword it. A label the UI prints goes in quotes or",
        "code font. A real acronym, unit or file name is added to ACRONYMS in",
        "doc-emphasis.scan.ts. There is no debt list.",
      ].join("\n"),
    ).toEqual([]);
  });
});
