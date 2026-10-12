// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CheckUnableError } from "../program";
import { checkNodenext } from "./nodenext";

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const typescriptDir = dirname(
  createRequire(import.meta.url).resolve("typescript/package.json"),
);

/** A client with the repo's typescript installed, a nodenext config and one source file. */
function client(source: string, withConfig = true): string {
  const dir = mkdtempSync(join(tmpdir(), "uplink-nodenext-test-"));
  scratch.push(dir);
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(typescriptDir, join(dir, "node_modules", "typescript"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(dir, "src", "index.ts"), source);
  if (withConfig) {
    writeFileSync(
      join(dir, "tsconfig.nodenext.json"),
      JSON.stringify({
        compilerOptions: {
          module: "nodenext",
          moduleResolution: "nodenext",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ["src"],
      }),
    );
  }
  return dir;
}

describe("check --only nodenext", () => {
  it("is clean when the client typechecks under nodenext", () => {
    expect(
      checkNodenext(client('import { a } from "./a.js";\nexport { a };\n')),
    ).toEqual([]);
  }, 30_000);

  it("names a relative import with no extension, which only nodenext refuses", () => {
    const found = checkNodenext(
      client('import { a } from "./a";\nexport { a };\n'),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      rule: "nodenext/typecheck",
      severity: "error",
      line: 1,
    });
    expect(found[0].message).toMatch(/TS283[45]/);
  }, 30_000);

  it("reports a missing config as a finding naming the file", () => {
    const found = checkNodenext(client("export {};\n", false));
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("nodenext/config");
    expect(found[0].fix).toContain("tsconfig.nodenext.json");
  });

  it("cannot run without typescript installed, and says so rather than passing", () => {
    const dir = client("export {};\n");
    rmSync(join(dir, "node_modules"), { recursive: true, force: true });
    expect(() => checkNodenext(dir)).toThrow(CheckUnableError);
  });
});
