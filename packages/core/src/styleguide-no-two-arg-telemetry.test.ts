// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  scanTwoArgTelemetry,
  twoArgTelemetryIn,
  twoArgTelemetryVerdict,
} from "./two-arg-telemetry.scan";

/**
 * `useTelemetry` takes a `TopicId` and nothing else, held at zero with no debt
 * list. The planted sources are assembled at runtime so this file never
 * contains the call it forbids.
 */

const HOOK = ["use", "Telemetry"].join("");

const RESULT = scanTwoArgTelemetry();

const plantDir = mkdtempSync(join(tmpdir(), "two-arg-telemetry-plant-"));
afterAll(() => rmSync(plantDir, { recursive: true, force: true }));

describe("styleguide: useTelemetry takes one argument", () => {
  /** The instrument check: the files that define and forward the hook must be among what the scan read. */
  it("reads the hook's own declarations", () => {
    console.info(
      `[no-two-arg-telemetry] read ${RESULT.read.length} source files`,
    );
    for (const file of [
      "mod/sitrep-sdk/src/spine/use-telemetry.ts",
      "mod/sitrep-sdk/src/api/index.ts",
      "mod/sitrep-sdk/src/api/host.ts",
      "packages/app/src/uplinks/host.ts",
    ]) {
      expect(RESULT.read).toContain(file);
    }
    expect(RESULT.read.some((file) => file.endsWith(".tsx"))).toBe(true);

    // A second, independent listing: every tracked file naming the hook must be in what the scan read.
    const tracked = execFileSync(
      "git",
      ["grep", "-l", HOOK, "--", "*.ts", "*.tsx", ":!**/__generated__/**"],
      { cwd: join(import.meta.dirname, "..", "..", ".."), encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
    expect(tracked.length).toBeGreaterThan(100);
    const read = new Set(RESULT.read);
    for (const file of tracked) expect(read, file).toContain(file);
  });

  it("finds no two-arg call or declaration in the tree", () => {
    expect(twoArgTelemetryVerdict(RESULT)).toBeNull();
  });

  it("fails on a planted two-arg call and overload, through the same file walk", () => {
    writeFileSync(
      join(plantDir, "planted.tsx"),
      [
        `export function ${HOOK}(topic: string): unknown;`,
        `export function ${HOOK}(id: string, key: string): unknown;`,
        `export function ${HOOK}(a: string, b?: string) { return a ?? b; }`,
        "function Probe() {",
        `  const v = ${HOOK}<number>(`,
        `    "data",`,
        `    "vessel.control.throttle",`,
        "  );",
        "  return <div>{String(v)}</div>;",
        "}",
      ].join("\n"),
    );
    writeFileSync(
      join(plantDir, "clean.ts"),
      `const r = ${HOOK}("vessel.control");\n// ${HOOK}("data", "x")\nconst s = '${HOOK}("data", "x")';\n`,
    );
    const verdict = twoArgTelemetryVerdict(
      scanTwoArgTelemetry(["planted.tsx", "clean.ts"], plantDir),
    );
    expect(verdict).toContain("planted.tsx:2");
    expect(verdict).toContain("planted.tsx:3");
    expect(verdict).toContain("planted.tsx:5");
    expect(verdict).not.toContain("planted.tsx:1");
    expect(verdict).not.toContain("clean.ts");
  });

  it("catches the host interface member and a forwarding call", () => {
    expect(
      twoArgTelemetryIn(
        `interface H { ${HOOK}<T>(id: string, key: string): T; }`,
      ),
    ).toHaveLength(1);
    expect(
      twoArgTelemetryIn(
        `interface H { ${HOOK}: (id: string, key?: string) => unknown; }`,
      ),
    ).toHaveLength(1);
    expect(twoArgTelemetryIn(`getHost().${HOOK}(id, key);`)).toHaveLength(1);
    expect(twoArgTelemetryIn(`getHost().${HOOK}(topic);`)).toEqual([]);
  });

  it("fails as BLIND when it reads no files", () => {
    expect(twoArgTelemetryVerdict(scanTwoArgTelemetry([], plantDir))).toMatch(
      /^BLIND/,
    );
    expect(
      twoArgTelemetryVerdict(scanTwoArgTelemetry(["missing.ts"], plantDir)),
    ).toMatch(/^BLIND/);
  });
});
