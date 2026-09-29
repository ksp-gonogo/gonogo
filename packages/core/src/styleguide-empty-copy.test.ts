// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  emptyCopyIn,
  emptyCopyVerdict,
  scanEmptyCopy,
} from "./empty-copy.scan";

/**
 * Empty-state copy never ends in a full stop, held at zero with no debt list.
 * The plants are built from parts so no string in this file is itself a hit.
 */

const STOP = ".";
const RESULT = scanEmptyCopy();

const plantDir = mkdtempSync(join(tmpdir(), "empty-copy-plant-"));
afterAll(() => rmSync(plantDir, { recursive: true, force: true }));

describe("design-system: empty-state copy", () => {
  /**
   * The instrument check: every tracked non-test TSX file of the kit, as a
   * second independent `git ls-files` lists it, is among the files read.
   */
  it("reads every kit source", () => {
    const read = new Set(RESULT.read);
    const kit = execFileSync(
      "git",
      [
        "ls-files",
        "--",
        "packages/ui-kit/src/*.tsx",
        ":(exclude)packages/ui-kit/src/*.test*",
      ],
      { cwd: join(import.meta.dirname, "..", "..", ".."), encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
    expect(kit.length).toBeGreaterThan(50);
    for (const file of kit) expect(read, file).toContain(file);
  });

  it("finds no empty-state copy ending in a full stop", () => {
    expect(emptyCopyVerdict(RESULT)).toBeNull();
  });

  it("fails on every place empty copy is written, through the same file walk", () => {
    writeFileSync(
      join(plantDir, "planted.tsx"),
      [
        `const a = <EmptyState>No crew${STOP}</EmptyState>;`,
        `const b = <Menu emptyLabel="No actions${STOP}" />;`,
        "const c = <Graph emptyState={body ? `No atmosphere on $" +
          "{body}" +
          `${STOP}\` : "Waiting..."} />;`,
        `const d = <AutoEmptyState fallback={"Nothing here${STOP}"} />;`,
        `function E({ emptyText = "Nothing${STOP}" }) {}`,
        `const f = <Roster__Empty>No vessels${STOP}</Roster__Empty>;`,
      ].join("\n"),
    );
    writeFileSync(
      join(plantDir, "clean.tsx"),
      [
        "const a = <EmptyState>No crew</EmptyState>;",
        'const b = <Menu emptyLabel="Waiting for telemetry..." />;',
        `const c = <Note>A full sentence${STOP}</Note>;`,
      ].join("\n"),
    );
    const verdict = emptyCopyVerdict(
      scanEmptyCopy(["planted.tsx", "clean.tsx"], plantDir),
    );
    for (const line of [1, 2, 3, 4, 5, 6]) {
      expect(verdict).toContain(`planted.tsx:${line} `);
    }
    expect(verdict).not.toContain("clean.tsx");
  });

  it("fails as BLIND when it read nothing", () => {
    expect(emptyCopyVerdict({ read: [], hits: new Map() })).toContain("BLIND");
    expect(emptyCopyIn("const x = 1;")).toEqual([]);
  });
});
