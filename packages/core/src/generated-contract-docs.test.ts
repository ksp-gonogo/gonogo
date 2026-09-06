// @vitest-environment node
//
// Node realm rather than the package's jsdom default: this walks the tree and touches no DOM.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The generated wire contracts carry the C# prose they were generated from.
 *
 * `mod/codegen.sh` used to emit 1,906 lines of field names with no doc comment
 * characters at all, from C# carrying 10,265 `///` lines. Two things restore it
 * and either can be undone without breaking a build: the codegen twins emit an
 * XMLDOC file (`mod/CodegenTwin.props`) and `RtDocVisitor` translates it. CI
 * already diffs the committed SDK against a fresh run, so a generator that
 * stopped carrying prose would be caught for the core file. Nothing covered the
 * ten Uplink slices, which CI's diff does not look at.
 *
 * The leak half is the other failure. What Reinforced.Typings hands the writer
 * is the summary's RAW XML, so the way this breaks is not an empty file but a
 * `/** <para><b>Typing-only mirror.</b>` on the published surface.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

const generatedContracts = () =>
  execFileSync("git", ["ls-files", "mod"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => f.endsWith("/__generated__/contract.ts"));

/**
 * The contract slice a generated file was generated from. `sitrep-sdk` is the
 * one that does not follow the Uplink shape, because it is core's own output.
 */
function contractDir(generated: string): string {
  if (generated.startsWith("mod/sitrep-sdk/")) return "mod/Sitrep.Contract";
  const uplink = generated.split("/")[1];
  return `mod/${uplink}.Contract`;
}

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

/** `///` lines in the C# a slice is generated from. */
function docLines(dir: string): number {
  const files = execFileSync("git", ["ls-files", dir], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => f.endsWith(".cs"));
  let total = 0;
  for (const file of files) {
    total += read(file)
      .split("\n")
      .filter((l) => l.trim().startsWith("///")).length;
  }
  return total;
}

/**
 * XMLDoc markup that means the translation did not happen. Entities are here
 * too: `&lt;` reaching an editor is the same bug one layer down, and it is the
 * form the leak took for every summary quoting a `Dictionary<string, T>`.
 */
const MARKUP =
  /<\/?(?:summary|para|remarks|c|b|i|list|item|description|see|seealso|paramref|typeparamref)\b|cref\s*=|&lt;|&gt;|&amp;|&quot;/;

/** Doc blocks only: the generated code itself contains `<` and `>` legally. */
function docBlocks(source: string): string[] {
  return source.match(/\/\*\*[\s\S]*?\*\//g) ?? [];
}

describe("generated contract docs", () => {
  const contracts = generatedContracts();

  it("finds every generated contract", () => {
    // A walk that matched nothing would pass every assertion below. Nine since
    /*
     * A walk that matched nothing would pass every assertion below. Seven since
     * three Uplinks left for the gonogo-uplinks repo on 2026-09-06 and took
     * their contract slices with them; a floor guards against the walk
     * breaking, so it tracks what is here.
     */
    expect(contracts.length).toBeGreaterThanOrEqual(7);
  });

  it("sees markup it is meant to reject", () => {
    // Planted against rather than trusted: a pattern that matches nothing reports a clean tree.
    expect(MARKUP.test("/** <para><b>Typing-only mirror.</b> */")).toBe(true);
    expect(MARKUP.test('/** <see cref="T:Sitrep.Contract.Meta" /> */')).toBe(
      true,
    );
    expect(MARKUP.test("/** The `career.status` channel payload. */")).toBe(
      false,
    );
  });

  it.each(contracts)("%s carries its slice's prose", (generated) => {
    const source = read(generated);
    const blocks = docBlocks(source);
    const slice = contractDir(generated);
    // Judged against the C# rather than a number written down here: a hand-kept floor goes stale.
    if (docLines(slice) === 0) return;
    expect(blocks.length).toBeGreaterThan(0);
  });

  it.each(contracts)("%s carries no raw XMLDoc markup", (generated) => {
    const leaked = docBlocks(read(generated)).filter((b) => MARKUP.test(b));
    expect(leaked).toEqual([]);
  });
});
