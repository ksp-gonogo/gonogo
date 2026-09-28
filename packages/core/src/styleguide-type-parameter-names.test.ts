// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  scanTypeParameterNames,
  typeParameterHitsIn,
  typeParameterVerdict,
} from "./type-parameter-names.scan";

/**
 * No abbreviated type parameter in any published package's source, held at
 * zero with no debt list.
 *
 * The planted declarations are assembled at runtime, and this file lives in a
 * private package, so it never reads its own plants.
 */

const LETTER = String.fromCharCode(84);

const RESULT = scanTypeParameterNames();

const plantDir = mkdtempSync(join(tmpdir(), "type-parameter-plant-"));
afterAll(() => rmSync(plantDir, { recursive: true, force: true }));

describe("design-system: descriptive type parameter names", () => {
  /**
   * The instrument check. The three packages published today must be among
   * what discovery found, each must have been read, and so must the generated
   * contract, whose generics come from C# and are renamed on the way out.
   */
  it("reads every published package, the generated contract included", () => {
    console.info(
      `[type-parameter-names] read ${RESULT.read.length} files across ${RESULT.packages.join(", ")}`,
    );
    for (const dir of [
      "mod/sitrep-sdk",
      "packages/ui-kit",
      "packages/uplink-tools",
    ]) {
      expect(RESULT.packages).toContain(dir);
      expect(
        RESULT.read.some((file) => file.startsWith(`${dir}/src/`)),
        `nothing read under ${dir}/src`,
      ).toBe(true);
    }
    expect(RESULT.read).toContain(
      "mod/sitrep-sdk/src/__generated__/contract.ts",
    );
    const privateCore = execFileSync(
      "git",
      ["ls-files", "--", "packages/core/src/*.ts"],
      { cwd: join(import.meta.dirname, "..", "..", ".."), encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
    expect(privateCore.length).toBeGreaterThan(0);
    for (const file of privateCore) expect(RESULT.read).not.toContain(file);
  });

  it("finds no abbreviated type parameter in published source", () => {
    expect(typeParameterVerdict(RESULT)).toBeNull();
  });

  it("fails on planted abbreviations, through the same file walk", () => {
    writeFileSync(
      join(plantDir, "planted.ts"),
      [
        `export type Box<${LETTER}> = { value: ${LETTER} };`,
        `export function send<${LETTER}Args>(args: ${LETTER}Args) { return args; }`,
        `export type Keys<Shape> = { [K in keyof Shape]: Shape[K] };`,
        `export type Inner<Shape> = Shape extends Array<infer E> ? E : never;`,
      ].join("\n"),
    );
    writeFileSync(
      join(plantDir, "clean.tsx"),
      "export function Gauge<Unit extends string>(props: { unit: Unit }) { return <b>{props.unit}</b>; }\n",
    );
    const verdict = typeParameterVerdict(
      scanTypeParameterNames(["planted.ts", "clean.tsx"], plantDir),
    );
    expect(verdict).toContain("planted.ts:1");
    expect(verdict).toContain("planted.ts:2");
    expect(verdict).toContain("planted.ts:3");
    expect(verdict).toContain("planted.ts:4");
    expect(verdict).not.toContain("clean.tsx");
  });

  it("fails as BLIND when it reads no files", () => {
    expect(typeParameterVerdict(scanTypeParameterNames([], plantDir))).toMatch(
      /^BLIND/,
    );
    expect(
      typeParameterVerdict(scanTypeParameterNames(["missing.ts"], plantDir)),
    ).toMatch(/^BLIND/);
  });

  it("exempts only an interface merged into a third-party module", () => {
    const augmentation = (module: string) =>
      `declare module "${module}" {\n  interface Assertion<${LETTER}> { toShow(): ${LETTER}; }\n}\n`;
    expect(typeParameterHitsIn(augmentation("vitest"))).toEqual([]);
    expect(typeParameterHitsIn(augmentation("@ksp-gonogo/sitrep-sdk"))).toEqual(
      [
        {
          line: 2,
          name: LETTER,
          text: `interface Assertion<${LETTER}> { toShow(): ${LETTER}; }`,
        },
      ],
    );
  });
});
