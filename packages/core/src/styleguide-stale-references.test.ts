import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STALE_REFERENCE_DEBT } from "./stale-references.allowlist";
import {
  referenceResolver,
  type SourceFile,
  staleReferences,
} from "./stale-references.scan";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const TRACKED = execFileSync("git", ["ls-files"], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 1 << 27,
})
  .split("\n")
  .filter(Boolean);

const SOURCES: SourceFile[] = TRACKED.filter(
  (f) =>
    /^(packages|mod|scripts)\//.test(f) &&
    /\.(tsx?|mjs|js)$/.test(f) &&
    !/\/(dist|__generated__)\//.test(f),
).map((path) => ({ path, text: readFileSync(join(ROOT, path), "utf8") }));

const resolves = referenceResolver(TRACKED);

const key = (r: { file: string; reference: string }) =>
  `${r.file} -> ${r.reference}`;

function counted(refs: readonly { file: string; reference: string }[]) {
  const out = new Map<string, number>();
  for (const r of refs) out.set(key(r), (out.get(key(r)) ?? 0) + 1);
  return out;
}

const FOUND = counted(staleReferences(SOURCES, resolves));

describe("comments name only files the tree has", () => {
  it("reads the tree, so a clean answer means it looked", () => {
    expect(SOURCES.length).toBeGreaterThan(1000);
    expect(SOURCES.map((s) => s.path)).toContain(
      "packages/core/src/stale-references.scan.ts",
    );
  });

  it("names no missing test file or cited path beyond the recorded debt", () => {
    const fresh = [...FOUND]
      .filter(([k, n]) => n > (STALE_REFERENCE_DEBT[k] ?? 0))
      .map(([k]) => k)
      .sort();
    expect(
      fresh,
      `These comments name a file the tree does not have. A comment saying a test pins something is a promise the reader stops checking, so a missing test is worse than no comment. Point it at the file that exists, or delete the claim. Do NOT add to stale-references.allowlist.ts:\n  ${fresh.join("\n  ")}`,
    ).toEqual([]);
  });

  it("records no debt that is already paid", () => {
    const paid = Object.entries(STALE_REFERENCE_DEBT)
      .filter(([k, n]) => (FOUND.get(k) ?? 0) < n)
      .map(([k, n]) => `${k} (listed ${n}, found ${FOUND.get(k) ?? 0})`)
      .sort();
    expect(
      paid,
      `Lower or delete these entries in stale-references.allowlist.ts:\n  ${paid.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("the stale-reference scan sees what it is meant to", () => {
  /**
   * Planted into the real tree and run through the same resolver, so a scan
   * that stopped reading comments, or a resolver that stopped consulting
   * `git ls-files`, fails here rather than reporting a clean tree.
   */
  const PLANTED: SourceFile = {
    path: "packages/core/src/planted.ts",
    text: [
      "// `planted-nowhere.test.ts` asserts the topic string.",
      "/* see packages/core/src/planted-missing/index.tsx:12 */",
      "// `stale-references.scan.ts` and `turbo-input-coverage.test.ts` exist.",
      "// see packages/core/src/stale-references.scan.ts:40",
      'const s = "`quoted-only.test.ts` is a string, not a comment";',
    ].join("\n"),
  };

  const planted = staleReferences([...SOURCES, PLANTED], resolves).filter(
    (r) => r.file === PLANTED.path,
  );

  it("finds a missing test file and a citation of a missing path", () => {
    expect(planted.map((r) => r.reference).sort()).toEqual([
      "packages/core/src/planted-missing/index.tsx:12",
      "planted-nowhere.test.ts",
    ]);
  });

  it("passes files that exist, and never reads a string as a comment", () => {
    const references = planted.map((r) => r.reference);
    expect(references).not.toContain("turbo-input-coverage.test.ts");
    expect(references).not.toContain(
      "packages/core/src/stale-references.scan.ts:40",
    );
    expect(references).not.toContain("quoted-only.test.ts");
  });
});
