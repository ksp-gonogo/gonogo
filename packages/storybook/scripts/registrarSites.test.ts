import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { Fingerprinter } from "./fingerprint";

const DIR = "packages/components/src/Thing";

const FILES: Record<string, string> = {
  "packages/components/src/client.ts": `export const CORE = defineUplinkClient({ id: "core" });\n`,
  [`${DIR}/inputs.ts`]: [
    `export function registerPlot(id: string, build: () => null): void {`,
    `  CORE.registerContribution({ id, contributes: "plots", compute: build });`,
    `}`,
    `export function registerNamed(build: () => null, name: string): void {`,
    `  CORE.registerContribution({ id: name, contributes: "plots", compute: build });`,
    `}`,
    ``,
  ].join("\n"),
  [`${DIR}/reticle.ts`]: `import { registerPlot } from "./inputs";\nregisterPlot("reticle", () => null);\n`,
  [`${DIR}/view.ts`]: `import { registerNamed } from "./inputs";\nregisterNamed(() => null, "view");\n`,
  [`${DIR}/computed.ts`]: `import { registerPlot } from "./inputs";\nregisterPlot(\`a\${1}\`, () => null);\n`,
};

let roots: string[] = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

function sourceOf(id: string): string | undefined {
  const root = mkdtempSync(join(tmpdir(), "registrar-sites-"));
  roots.push(root);
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const source = new Fingerprinter(root).sourceOf({
    kind: "extension",
    id,
    stories: [],
  });
  return "file" in source ? source.file.slice(root.length + 1) : undefined;
}

it("finds a registration made through a helper in the file that calls the helper", () => {
  expect(sourceOf("core:reticle")).toBe(`${DIR}/reticle.ts`);
});

it("follows the helper's parameter to the id wherever it sits in the argument list", () => {
  expect(sourceOf("core:view")).toBe(`${DIR}/view.ts`);
});

it("names no file for an id the helper's caller does not give as a literal", () => {
  expect(sourceOf("core:a1")).toBeUndefined();
});
