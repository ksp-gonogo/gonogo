// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { elseIfsIn, elseIfVerdict, scanElseIf } from "./else-if.scan";

/**
 * No `else if` anywhere in the TypeScript and JavaScript tree, held at zero
 * with no debt list.
 *
 * The planted chains are assembled at runtime so this file never contains the
 * construct it forbids, and so the scan reading this file is itself part of
 * the evidence that it looked.
 */

const ELSE_IF = ["else", "if"].join(" ");

const RESULT = scanElseIf();

const plantDir = mkdtempSync(join(tmpdir(), "else-if-plant-"));
afterAll(() => rmSync(plantDir, { recursive: true, force: true }));

describe("design-system: no else-if", () => {
  /**
   * The instrument check. Every scan module in this package is listed by a
   * second, independent `git ls-files`, and each must be in what the scan
   * read; a pathspec exclusion that swallowed a directory, or an extension the
   * glob list dropped, shows here rather than as a clean tree.
   */
  it("reads every source family, including this package's own scans", () => {
    console.info(
      `[no-else-if] read ${RESULT.read.length} tracked source files`,
    );
    const read = new Set(RESULT.read);
    const scans = execFileSync("git", ["ls-files", "--", "src/*.scan.ts"], {
      cwd: join(import.meta.dirname, ".."),
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
      .map((rel) => `packages/core/${rel}`);
    expect(scans.length).toBeGreaterThan(0);
    for (const scan of scans) expect(read, scan).toContain(scan);
    for (const ext of [".ts", ".tsx", ".mjs"]) {
      expect(
        RESULT.read.some((file) => file.endsWith(ext)),
        `no ${ext} file was read`,
      ).toBe(true);
    }
    expect(RESULT.read.some((file) => file.includes("/__generated__/"))).toBe(
      false,
    );
  });

  it("finds no else-if in the tree", () => {
    expect(elseIfVerdict(RESULT)).toBeNull();
  });

  it("fails on a planted else-if, through the same file walk", () => {
    writeFileSync(
      join(plantDir, "planted.ts"),
      [
        "let x = 0;",
        "if (a) {",
        "  x = 1;",
        `} ${ELSE_IF} (b) {`,
        "  x = 2;",
        "}",
      ].join("\n"),
    );
    writeFileSync(join(plantDir, "clean.mjs"), "export const y = 1;\n");
    const verdict = elseIfVerdict(
      scanElseIf(["planted.ts", "clean.mjs"], plantDir),
    );
    expect(verdict).toContain("planted.ts:4");
    expect(verdict).not.toContain("clean.mjs");
  });

  it("fails as BLIND when it reads no files", () => {
    expect(elseIfVerdict(scanElseIf([], plantDir))).toMatch(/^BLIND/);
    expect(elseIfVerdict(scanElseIf(["missing.ts"], plantDir))).toMatch(
      /^BLIND/,
    );
  });

  it("parses rather than greps, in every dialect", () => {
    const chain = `if (a) { f(); } ${ELSE_IF} (b) { g(); }`;
    expect(elseIfsIn(chain, "a.ts")).toHaveLength(1);
    expect(
      elseIfsIn(`const C = () => { ${chain} return <div />; };`, "a.tsx"),
    ).toHaveLength(1);
    expect(elseIfsIn(chain, "a.mjs")).toHaveLength(1);
    expect(elseIfsIn(`if (a) f();\n${ELSE_IF} (b) g();`, "a.js")).toEqual([
      { line: 2, text: `${ELSE_IF} (b) g();` },
    ]);
    // A nested `if` inside an `else` block is not a chain, and the words in a string or comment are not code.
    expect(
      elseIfsIn(`if (a) { f(); } else { if (b) g(); h(); }`, "a.ts"),
    ).toEqual([]);
    expect(
      elseIfsIn(`const s = "} ${ELSE_IF} (b) {";\n// ${ELSE_IF}`, "a.ts"),
    ).toEqual([]);
  });
});
