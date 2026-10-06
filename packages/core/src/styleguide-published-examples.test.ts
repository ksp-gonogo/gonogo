// @vitest-environment node
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fencedBlocks,
  gradePlant,
  scanPublishedExamples,
} from "./published-examples.scan";

/**
 * Every `@example` on a published export typechecks against the published
 * entry points, so an example cannot outlive the signature it shows.
 *
 * There is no debt list: an example that does not compile is edited, or its
 * context is left as a free lowercase name, which the check types `any`.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const RESULT = scanPublishedExamples(REPO_ROOT);

describe("design-system: published @example blocks typecheck", () => {
  it("splits an example's text into its fenced blocks", () => {
    expect(fencedBlocks("Caption\n```tsx\nA\n```\n```ts\nB\n```")).toEqual([
      "A",
      "B",
    ]);
    expect(fencedBlocks("```bash\nnpm i\n```")).toEqual([]);
    expect(fencedBlocks("A caption {@link X}```tsx\n<X />\n```")).toEqual([
      "<X />",
    ]);
  });

  it("checks the planted examples before the tree", () => {
    const graded = gradePlant(RESULT, RESULT.entries, REPO_ROOT);
    const wrong = [...graded]
      .filter(([name, faulted]) => faulted !== !name.startsWith("sound"))
      .map(([name]) => name);
    expect(
      wrong,
      "BLIND: a sound plant faulted, or a broken one passed, so the check cannot tell a good example from a bad one",
    ).toEqual([]);
  });

  it("reads examples from every published package that carries one", () => {
    console.info(
      `[examples] ${RESULT.examples.length} @example blocks across ${RESULT.entries.length} entry points`,
    );
    const packages = new Set(RESULT.examples.map((e) => e.pkg));
    expect(packages).toContain("@ksp-gonogo/sitrep-sdk");
    expect(packages).toContain("@ksp-gonogo/ui-kit");
    expect(RESULT.examples.length).toBeGreaterThan(40);
  });

  it("finds no example that fails to typecheck", () => {
    const lines = RESULT.faults.map(
      (f) => `  ${f.example.pkg} ${f.example.owner}: ${f.message}`,
    );
    expect(
      lines,
      `${lines.length} @example block(s) do not typecheck against the published entry points:\n${lines.join("\n")}`,
    ).toEqual([]);
  });
});
