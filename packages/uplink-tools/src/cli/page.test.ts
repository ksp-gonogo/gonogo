// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "./page";

const scratch: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("page, run in a client whose test runner passes with no tests", () => {
  it("does not call the page current when the run matched no test file", () => {
    const dir = mkdtempSync(join(tmpdir(), "uplink-page-"));
    scratch.push(dir);
    mkdirSync(join(dir, "client", "src"), { recursive: true });
    writeFileSync(join(dir, "uplink.json"), JSON.stringify({ id: "x" }));
    writeFileSync(
      join(dir, "client", "package.json"),
      JSON.stringify({ name: "x", version: "0.0.1" }),
    );
    // The client's runner includes nothing, and is configured to call that a pass.
    writeFileSync(
      join(dir, "client", "vitest.config.mjs"),
      'export default { test: { passWithNoTests: true, include: ["nothing/**"] } };\n',
    );
    writeFileSync(
      join(dir, "client", "src", "uplink-page.test.ts"),
      'import { it } from "vitest";\nit("x", () => { expectUplinkPageCurrent(); });\n',
    );
    symlinkSync(
      join(import.meta.dirname, "..", "..", "node_modules"),
      join(dir, "client", "node_modules"),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    expect(() => page([], dir)).toThrow(/page was not written/);
    expect(log.mock.calls.flat().join("\n")).not.toContain("already match");
  });
});
