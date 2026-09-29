// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  HELD_WORD_MAPPING,
  heldVocabularyIn,
  heldVocabularyVerdict,
  isProductSource,
  scanHeldVocabulary,
} from "./held-vocabulary.scan";

/**
 * A value that stopped updating has one vocabulary: the Reading state
 * `"held"`, a `HeldGrade`, and the operator's word from the kit's single
 * mapping. Held at zero with no debt list.
 *
 * The planted words are assembled at runtime so this file never contains what
 * it forbids.
 */

const WORD = ["HE", "LD"].join("");
const OLD_WORD = ["ST", "ALE"].join("");
const OLD_STATE = ["st", "ale"].join("");
const OLD_GRADE = ["held", OLD_STATE].join("-");
const OLD_TYPE = ["Stale", "Grade"].join("");
const OLD_MEMBER = ["Held", "Stale"].join("");

const RESULT = scanHeldVocabulary();

const plantDir = mkdtempSync(join(tmpdir(), "held-vocabulary-plant-"));
afterAll(() => rmSync(plantDir, { recursive: true, force: true }));

function plant(file: string, source: string): void {
  const path = join(plantDir, file);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, source);
}

describe("design-system: held vocabulary", () => {
  /**
   * The instrument check: a second, independent `git ls-files` of the kit, and
   * every source file it lists must be in what the scan read.
   */
  it("reads product source, tests and the kit's mapping", () => {
    console.info(
      `[held-vocabulary] read ${RESULT.read.length} tracked source files`,
    );
    const read = new Set(RESULT.read);
    const kit = execFileSync("git", ["ls-files", "--", "src"], {
      cwd: join(import.meta.dirname, "..", "..", "ui-kit"),
      encoding: "utf8",
    })
      .split("\n")
      .filter((rel) => /\.tsx?$/.test(rel) && !rel.includes("/__generated__/"))
      .map((rel) => `packages/ui-kit/${rel}`);
    expect(kit).toContain(HELD_WORD_MAPPING);
    for (const file of kit) expect(read, file).toContain(file);
    expect(
      RESULT.read.some((file) => file.startsWith("mod/sitrep-sdk/src/")),
    ).toBe(true);
    expect(RESULT.read.some((file) => file.endsWith(".test.tsx"))).toBe(true);
  });

  it("finds no hand-written held word and no retired state spelling", () => {
    expect(heldVocabularyVerdict(RESULT)).toBeNull();
  });

  it("fails on a planted label and a planted state, through the same file walk", () => {
    plant(
      "packages/components/src/Planted/index.tsx",
      [
        `export const a = "${OLD_WORD}";`,
        `export const B = () => <span>${WORD}</span>;`,
        `export const c = \`board \${1} ${WORD}\`;`,
        `export const d = (r: { state: string }) => r.state === "${OLD_STATE}";`,
      ].join("\n"),
    );
    plant(
      "packages/components/src/Planted/index.test.tsx",
      [
        `expect(label).toBe("${WORD}");`,
        `const grade: ${OLD_TYPE} = "${OLD_GRADE}";`,
        `const meta = { staleness: Staleness.${OLD_MEMBER} };`,
      ].join("\n"),
    );
    plant("packages/components/src/Planted/clean.ts", "export const y = 1;\n");
    const verdict = heldVocabularyVerdict(
      scanHeldVocabulary(
        [
          "packages/components/src/Planted/index.tsx",
          "packages/components/src/Planted/index.test.tsx",
          "packages/components/src/Planted/clean.ts",
        ],
        plantDir,
      ),
    );
    expect(verdict).toContain(
      "[label] packages/components/src/Planted/index.tsx:1",
    );
    expect(verdict).toContain(
      "[label] packages/components/src/Planted/index.tsx:2",
    );
    expect(verdict).toContain(
      "[label] packages/components/src/Planted/index.tsx:3",
    );
    expect(verdict).toContain(
      "[state] packages/components/src/Planted/index.tsx:4",
    );
    expect(verdict).toContain(
      "[state] packages/components/src/Planted/index.test.tsx:2",
    );
    expect(verdict).toContain(
      "[state] packages/components/src/Planted/index.test.tsx:3",
    );
    // A test asserting the word the kit prints is not writing a label.
    expect(verdict).not.toContain(
      "[label] packages/components/src/Planted/index.test.tsx:1",
    );
    expect(verdict).not.toContain("clean.ts");
  });

  it("lets the kit's mapping spell the word", () => {
    expect(
      heldVocabularyIn(`const W = { held: "${WORD}" };`, HELD_WORD_MAPPING),
    ).toEqual([]);
  });

  it("does not read a comment, a lowercase sentence or a key lookup as a hit", () => {
    const file = "packages/ui-kit/src/Planted.tsx";
    expect(
      heldVocabularyIn(
        [
          `// ${WORD} and ${OLD_WORD} in a comment`,
          `const s = "the figure is held";`,
          `type K = Verdict["${OLD_STATE}"];`,
          `const k = verdict["${OLD_STATE}"];`,
        ].join("\n"),
        file,
      ),
    ).toEqual([]);
  });

  it("tells product source from tests, scripts and fixtures", () => {
    expect(isProductSource("packages/components/src/A/index.tsx")).toBe(true);
    expect(isProductSource("mod/GonogoXUplink/client/src/A.tsx")).toBe(true);
    expect(isProductSource("packages/components/src/A/index.test.tsx")).toBe(
      false,
    );
    expect(isProductSource("packages/components/src/test/scene.ts")).toBe(
      false,
    );
    expect(isProductSource("packages/ui-kit/scripts/render.entry.tsx")).toBe(
      false,
    );
  });

  it("fails as BLIND when it reads no files", () => {
    expect(heldVocabularyVerdict(scanHeldVocabulary([], plantDir))).toMatch(
      /^BLIND/,
    );
    expect(
      heldVocabularyVerdict(scanHeldVocabulary(["missing.ts"], plantDir)),
    ).toMatch(/^BLIND/);
  });
});
