// @vitest-environment node
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Corpus,
  countsByFamily,
  FAMILIES,
  FAMILY_KEYS,
  type Family,
  HEADING_LEGITIMATE,
  HEADING_PLANT,
  hitsInProse,
  isSentenceHeading,
  plantedTsHits,
  proseOfMarkdown,
  proseOfXmlDoc,
  readingList,
  reportTable,
  scanForReview,
  siblingUplinksRoot,
  xmlDocUnits,
} from "./published-review-aid.scan";

/**
 * The review aid over what the reference site is generated from: doc comments
 * on published exports, widget descriptions and Uplink pages.
 *
 * Nothing here gates. The counts are printed per corpus and family as prompts
 * to read, and no result fails the build. `GONOGO_REVIEW_LIST=<path>` writes
 * the reading list, per corpus and file with the sentence and the reason.
 * What the tests hold is that the aid can find a planted example of each kind
 * and leaves the legitimate neighbours alone.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const RESULT = scanForReview(REPO_ROOT);

const unit = (text: string) => ({
  file: "plant.ts",
  line: 1,
  prose: proseOfMarkdown(text),
});

describe("review aid: published prose", () => {
  it("sees a planted hit in every family and none in the legitimate wording", () => {
    const blind: string[] = [];
    for (const [family, definition] of Object.entries(FAMILIES)) {
      const planted = hitsInProse(unit(definition.plant)).map((h) => h.family);
      if (!planted.includes(family as Family)) blind.push(`${family}: plant`);
      const legitimate = hitsInProse(unit(definition.legitimate)).map(
        (h) => h.family,
      );
      if (legitimate.includes(family as Family)) {
        blind.push(`${family}: picked legitimate wording`);
      }
    }
    expect(
      blind,
      "BLIND: a kind of prompt did not find its own plant, or picked wording it should leave alone",
    ).toEqual([]);
  });

  it("reads a sentence heading as a hit and a category as none", () => {
    expect(isSentenceHeading(HEADING_PLANT.replace(/^#+\s+/, ""))).toBe(true);
    expect(isSentenceHeading(HEADING_LEGITIMATE.replace(/^#+\s+/, ""))).toBe(
      false,
    );
    for (const heading of [
      "States",
      "Standard slots",
      "Band kinds",
      "What it returns",
    ]) {
      expect(isSentenceHeading(heading), heading).toBe(false);
    }
    expect(
      hitsInProse(unit(`Intro.\n\n${HEADING_PLANT}\n\nBody.`)).map(
        (h) => h.family,
      ),
    ).toEqual(["heading"]);
  });

  it("reads doc comments and not line comments, code or tags", () => {
    const source = [
      "// the legacy path, in a line comment",
      "/**",
      " * Draws a value.",
      " *",
      " * Calls `legacyDraw` and {@link legacy} and nothing else.",
      " *",
      " * ```ts",
      " * stale();",
      " * ```",
      " *",
      " * @example",
      " * ```ts",
      " * caveat();",
      " * ```",
      " *",
      " * @category Planted",
      " */",
      "export function draw(): void {}",
      "/**",
      " * Reads a value that went stale.",
      " * @category Planted",
      " */",
      "export function read(): void {}",
      "export interface Shape {",
      "  /** The legacy field. */",
      "  field: number;",
      "}",
    ].join("\n");
    const hits = plantedTsHits(source).map((h) => `${h.family}@${h.line}`);
    expect(hits).toEqual(["stale-word@19", "legacy@25"]);
  });

  it("drops <internal> and code from a contract doc and reads the rest", () => {
    const source = [
      "/// <summary>",
      "/// What the value is, <c>legacy</c> in code.",
      "/// <internal>",
      "/// Why: the stale mirror.",
      "/// </internal>",
      "/// </summary>",
      "public sealed class Planted {}",
      "/// <summary>A caveat here.</summary>",
      "internal sealed class Hidden {}",
      "/// <summary>A caveat there.</summary>",
      "public int Visible { get; }",
    ].join("\n");
    const found = xmlDocUnits(source, "Planted.cs").flatMap((u) =>
      hitsInProse(u),
    );
    expect(found.map((h) => h.family)).toEqual(["caveat"]);
    expect(proseOfXmlDoc("<internal>x</internal>kept")).toContain("kept");
    expect(proseOfMarkdown("```\nstale\n```\n`legacy` and prose")).not.toMatch(
      /stale|legacy/,
    );
  });

  it("narrows the reading list by corpus and by category and groups it by reason", () => {
    const list = readingList(RESULT, {
      corpus: "ui-kit",
      category: "Badge",
    });
    expect(list).toContain("# Sentences to re-read");
    expect(list).not.toContain("sitrep-sdk (");
    expect(list).not.toContain("Sitrep.Contract (");
    const all = readingList(RESULT);
    expect(all.length).toBeGreaterThan(list.length);
    expect(all).toMatch(/### a word a review called out: /);
  });

  it("reads the corpora", () => {
    const sizes = (corpora: Corpus[]) =>
      Object.fromEntries(corpora.map((c) => [c.name, c.units.length]));
    console.info(
      `[review-aid] corpus sizes ${JSON.stringify({
        docs: sizes(RESULT.docs),
        widgets: sizes(RESULT.widgets),
        uplinkPages: sizes(RESULT.uplinkPages),
        sibling: siblingUplinksRoot(REPO_ROOT) !== null,
      })}`,
    );
    const docs = sizes(RESULT.docs);
    expect(docs["@ksp-gonogo/sitrep-sdk"]).toBeGreaterThan(500);
    expect(docs["@ksp-gonogo/ui-kit"]).toBeGreaterThan(300);
    expect(docs["@ksp-gonogo/uplink-tools"]).toBeGreaterThan(30);
    expect(docs["Sitrep.Contract"]).toBeGreaterThan(1000);
    expect(sizes(RESULT.widgets)["core widgets"]).toBeGreaterThan(30);
  });

  it("prints how many sentences each corpus holds to re-read", () => {
    console.info(
      `[review-aid] sentences to re-read, not faults\n${reportTable(RESULT)}`,
    );
    const listPath = process.env.GONOGO_REVIEW_LIST;
    if (listPath) {
      writeFileSync(
        listPath,
        readingList(RESULT, {
          corpus: process.env.GONOGO_REVIEW_PACKAGE,
          category: process.env.GONOGO_REVIEW_CATEGORY,
        }),
      );
    }
    expect(Object.keys(countsByFamily([]))).toEqual([...FAMILY_KEYS]);
  });
});
