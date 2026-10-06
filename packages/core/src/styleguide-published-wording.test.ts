// @vitest-environment node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
  reportTable,
  scanPublishedWording,
  siblingUplinksRoot,
  type WordingHit,
  xmlDocUnits,
} from "./published-wording.scan";

/**
 * The wording of what the reference site is generated from: doc comments on
 * published exports, widget descriptions and Uplink pages.
 *
 * Report-only. The counts are printed per corpus and family and nothing here
 * fails on them. `published-wording.debt.json` is the switch: while it is
 * absent the scan reports, and once it is committed the scan holds each
 * `corpus|family|file` at or below its recorded count. Seed it with
 * `GONOGO_WORDING_SEED=1`, and list every hit with `GONOGO_WORDING_LIST=1`.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const DEBT_PATH = join(
  REPO_ROOT,
  "packages/core/src/published-wording.debt.json",
);
const RESULT = scanPublishedWording(REPO_ROOT);

const unit = (text: string) => ({
  file: "plant.ts",
  line: 1,
  prose: proseOfMarkdown(text),
});

/** Hits under the corpora that the gate would hold: doc comments only. */
function debtKeys(hits: Map<string, WordingHit[]>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const corpus of RESULT.docs) {
    for (const hit of hits.get(corpus.name) ?? []) {
      const key = `${corpus.name}|${hit.family}|${hit.file}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
  );
}

describe("design-system: published wording", () => {
  it("sees a planted hit in every family and none in the legitimate wording", () => {
    const blind: string[] = [];
    for (const [family, definition] of Object.entries(FAMILIES)) {
      const planted = hitsInProse(unit(definition.plant)).map((h) => h.family);
      if (!planted.includes(family as Family)) blind.push(`${family}: plant`);
      const legitimate = hitsInProse(unit(definition.legitimate)).map(
        (h) => h.family,
      );
      if (legitimate.includes(family as Family)) {
        blind.push(`${family}: legitimate wording hit`);
      }
    }
    expect(
      blind,
      "BLIND: a family did not see its own plant, or hit wording it must leave alone",
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

  it("reads the corpora", () => {
    const sizes = (corpora: Corpus[]) =>
      Object.fromEntries(corpora.map((c) => [c.name, c.units.length]));
    console.info(
      `[wording] corpus sizes ${JSON.stringify({
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

  it("reports the counts per corpus and family", () => {
    console.info(`[wording] counts, report only\n${reportTable(RESULT)}`);
    if (process.env.GONOGO_WORDING_LIST) {
      for (const [name, hits] of RESULT.hits) {
        for (const hit of hits) {
          console.info(
            `[wording] ${name} ${hit.family} ${hit.file}:${hit.line} ${hit.text}`,
          );
        }
      }
    }
    const total = [...RESULT.hits.values()].reduce((n, h) => n + h.length, 0);
    expect(total).toBeGreaterThanOrEqual(0);
    expect(Object.keys(countsByFamily([]))).toEqual([...FAMILY_KEYS]);
  });

  it("holds doc comments at the seeded counts once a debt file is committed", () => {
    const current = debtKeys(RESULT.hits);
    if (process.env.GONOGO_WORDING_SEED) {
      const before: Record<string, number> = existsSync(DEBT_PATH)
        ? JSON.parse(readFileSync(DEBT_PATH, "utf8"))
        : {};
      const raised = Object.entries(current).filter(
        ([key, n]) => key in before && n > before[key],
      );
      if (raised.length > 0) {
        throw new Error(`refusing to raise ${raised.length} recorded count(s)`);
      }
      writeFileSync(DEBT_PATH, `${JSON.stringify(current, null, 2)}\n`);
      console.info(`[wording] seeded ${Object.keys(current).length} entries`);
      return;
    }
    if (!existsSync(DEBT_PATH)) return;
    const seeded: Record<string, number> = JSON.parse(
      readFileSync(DEBT_PATH, "utf8"),
    );
    const over = Object.entries(current)
      .filter(([key, n]) => n > (seeded[key] ?? 0))
      .map(([key, n]) => `  ${key}: ${seeded[key] ?? 0} -> ${n}`);
    const under = Object.entries(seeded)
      .filter(([key, n]) => (current[key] ?? 0) < n)
      .map(([key, n]) => `  ${key}: ${n} -> ${current[key] ?? 0}`);
    expect(over, `wording hits rose:\n${over.join("\n")}`).toEqual([]);
    expect(
      under,
      `wording hits fell: tighten published-wording.debt.json with GONOGO_WORDING_SEED=1:\n${under.join("\n")}`,
    ).toEqual([]);
  });
});
