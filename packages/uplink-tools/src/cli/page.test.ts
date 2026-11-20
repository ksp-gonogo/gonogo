// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENTLESS_README_DIFFERS, page } from "./page";

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

describe("page, run in an Uplink with no client package", () => {
  const declaration = {
    id: "demo",
    name: "Demo",
    description: "Shows the demo.",
    repo: "https://github.com/o/r",
    gamedata: "GonogoDemoUplink",
    mod: { name: "Demo Mod", builtAgainst: "1.2.3" },
  };
  const uplink = (json: object) => {
    const dir = mkdtempSync(join(tmpdir(), "uplink-page-"));
    scratch.push(dir);
    writeFileSync(join(dir, "uplink.json"), JSON.stringify(json));
    return dir;
  };

  it("writes the shared sections and no widget section, and nothing else", () => {
    const dir = uplink(declaration);
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(page([], dir)).toBe(0);
    const readme = readFileSync(join(dir, "README.md"), "utf8");
    expect(readme).toContain("# Demo\n\nShows the demo.\n");
    expect(readme).toContain("Built against Demo Mod 1.2.3.");
    expect(readme).toContain("Install the Demo Uplink with CKAN");
    expect(readme).toContain("Without CKAN, download `GonogoDemoUplink.zip`");
    expect(readme).not.toContain("## Widgets");
    expect(readme).not.toContain("## For developers");
    expect(readdirSync(dir).sort()).toEqual(["README.md", "uplink.json"]);
  });

  it("refuses an Uplink with no description, naming the field", () => {
    const dir = uplink({ ...declaration, description: undefined });
    expect(() => page([], dir)).toThrow(/`description` field/);
  });

  it("--check reports a missing and an out-of-date README and passes a current one", () => {
    const dir = uplink(declaration);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(page(["--check"], dir)).toBe(1);
    page([], dir);
    expect(page(["--check"], dir)).toBe(0);
    writeFileSync(
      join(dir, "uplink.json"),
      JSON.stringify({ ...declaration, description: "Changed." }),
    );
    expect(page(["--check"], dir)).toBe(1);
    expect(log.mock.calls.flat().join("\n")).toContain(
      CLIENTLESS_README_DIFFERS,
    );
  });

  it("leaves a hand-written README alone", () => {
    const dir = uplink(declaration);
    writeFileSync(join(dir, "README.md"), "# Mine\n");
    expect(() => page([], dir)).toThrow(/was not written by/);
  });
});
