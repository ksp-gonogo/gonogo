import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { Fingerprinter } from "./fingerprint";

const STUBS = "packages/components/scripts/probe/slot-stubs";

const FILES: Record<string, string> = {
  [`${STUBS}/objectives.tsx`]: `plantSlot("objectives.source", () => null);\n`,
  [`${STUBS}/contributions.tsx`]: `plantContribution("comm-signal.hop-rates", { compute: () => null });\n`,
  [`${STUBS}/standard.tsx`]: `export function plantStandardSlots(ids: string[]) {\n  for (const id of ids) plantSlot(\`\${id}.sections\`);\n}\n`,
};

let roots: string[] = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

function sourceOf(id: string): string | undefined {
  const root = mkdtempSync(join(tmpdir(), "slot-stub-sites-"));
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

it("finds an augment stub by the slot it plants", () => {
  expect(sourceOf("planted-slot:objectives.source")).toBe(
    `${STUBS}/objectives.tsx`,
  );
});

it("finds a contribution stub by the slot it plants", () => {
  expect(sourceOf("planted-slot:comm-signal.hop-rates")).toBe(
    `${STUBS}/contributions.tsx`,
  );
});

it("finds a widget's standard point stub in the file that plants them all", () => {
  expect(sourceOf("planted-slot:twr.sections")).toBe(`${STUBS}/standard.tsx`);
});

it("names no file for a slot nothing plants", () => {
  expect(sourceOf("planted-slot:twr.nonsense")).toBeUndefined();
});
