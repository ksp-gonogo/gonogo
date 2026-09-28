// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  flatKeyReadsIn,
  flatKeyReadsVerdict,
  RETIRED_NAMES,
  scanFlatKeyReads,
} from "./flat-key-reads.scan";

/**
 * No read takes a data source id, and the hooks that chose between a
 * registered `DataSource` and the stream stay deleted. Held at zero with no
 * debt list. The planted sources are assembled at runtime so this file never
 * contains the call it forbids.
 */

const SERIES = ["use", "Data", "Series"].join("");
const MAP = ["map", "Topic"].join("");
const RESOLVE = ["resolve", "Value", "Topic"].join("");
const GET = ["get", "Value"].join("");
const STATUS = ["use", "Data", "Stream", "Status"].join("");

const RESULT = scanFlatKeyReads();

const plantDir = mkdtempSync(join(tmpdir(), "flat-key-reads-plant-"));
afterAll(() => rmSync(plantDir, { recursive: true, force: true }));

describe("styleguide: no read takes a data source id", () => {
  /** The instrument check: the files that define the reads must be among what the scan read. */
  it("reads the reads' own declarations", () => {
    console.info(`[no-flat-key-reads] read ${RESULT.read.length} source files`);
    for (const file of [
      "packages/data/src/hooks/useDataSeries.ts",
      "mod/sitrep-sdk/src/spine/map-topic.ts",
      "mod/sitrep-sdk/src/spine/context.tsx",
    ]) {
      expect(RESULT.read).toContain(file);
    }
    expect(RESULT.read.some((file) => file.endsWith(".tsx"))).toBe(true);

    // A second, independent listing: every tracked file naming a read must be in what the scan read.
    const tracked = execFileSync(
      "git",
      [
        "grep",
        "-l",
        "-e",
        SERIES,
        "-e",
        RESOLVE,
        "--",
        "*.ts",
        "*.tsx",
        ":!**/__generated__/**",
      ],
      { cwd: join(import.meta.dirname, "..", "..", ".."), encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
    expect(tracked.length).toBeGreaterThan(10);
    const read = new Set(RESULT.read);
    for (const file of tracked) expect(read, file).toContain(file);
  });

  it("finds no source-id argument and no retired name in the tree", () => {
    expect(flatKeyReadsVerdict(RESULT)).toBeNull();
  });

  it("fails on planted source-id calls and a retired hook, through the same file walk", () => {
    writeFileSync(
      join(plantDir, "planted.tsx"),
      [
        `const a = ${SERIES}("data", "vessel.orbit.sma", 60);`,
        `const b = ${MAP}("data", "vessel.partActions.12345");`,
        `const c = ${RESOLVE}("data", "vessel.flight.altitudeAsl");`,
        `const d = ${GET}("data", "vessel.flight.altitudeAsl");`,
        `const e = ${STATUS}("data", "science.archive");`,
        `export function ${RESOLVE}(id: string, key: string) { return id ?? key; }`,
      ].join("\n"),
    );
    writeFileSync(
      join(plantDir, "clean.ts"),
      [
        `const a = ${SERIES}("vessel.orbit.sma", 60);`,
        `const b = ${RESOLVE}("vessel.flight.altitudeAsl");`,
        `const c = client.${GET}("vessel.flight");`,
        `// ${SERIES}("data", "x", 60)`,
        `const s = '${STATUS}("data", "x")';`,
      ].join("\n"),
    );
    const verdict = flatKeyReadsVerdict(
      scanFlatKeyReads(["planted.tsx", "clean.ts"], plantDir),
    );
    for (const line of [1, 2, 3, 4, 5, 6]) {
      expect(verdict).toContain(`planted.tsx:${line}`);
    }
    expect(verdict).not.toContain("clean.ts");
  });

  it("catches every retired name as an import, a declaration and a reference", () => {
    for (const name of RETIRED_NAMES) {
      expect(flatKeyReadsIn(`import { ${name} } from "x";`), name).toHaveLength(
        1,
      );
      expect(flatKeyReadsIn(`export function ${name}() {}`), name).toHaveLength(
        1,
      );
      expect(flatKeyReadsIn(`host.${name}(cb);`), name).toHaveLength(1);
    }
  });

  it("fails as BLIND when it reads no files", () => {
    expect(flatKeyReadsVerdict(scanFlatKeyReads([], plantDir))).toMatch(
      /^BLIND/,
    );
    expect(
      flatKeyReadsVerdict(scanFlatKeyReads(["missing.ts"], plantDir)),
    ).toMatch(/^BLIND/);
  });
});
