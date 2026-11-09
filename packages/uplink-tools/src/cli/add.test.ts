import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { add, addToUplink } from "./add";
import { newUplink } from "./new";

const scratch: string[] = [];
let dir = "";

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "gonogo-add-"));
  scratch.push(dir);
  vi.spyOn(console, "log").mockImplementation(() => {});
  await newUplink(
    [
      "solo",
      "--yes",
      "--topics",
      "core",
      "--author",
      "T",
      "--no-repo",
      "--no-ksp",
      "--no-generate",
      "--no-install",
    ],
    dir,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const d of scratch.splice(0))
    rmSync(d, { recursive: true, force: true });
});

const read = (path: string) => readFileSync(join(dir, path), "utf8");

describe("uplink-tools add", () => {
  it("adds a widget with its test and fixture, renamed from the scaffold's, and imports it", () => {
    const written = addToUplink(dir, "widget", "fuel gauge");

    expect(written).toEqual([
      "client/src/FuelGauge/index.tsx",
      "client/src/FuelGauge/index.test.tsx",
      "client/src/FuelGauge/__fixtures__/fuel-gauge.json",
      "client/src/index.ts",
    ]);
    expect(read("client/src/FuelGauge/index.tsx")).toContain(
      'id: "solo-fuel-gauge"',
    );
    expect(read("client/src/FuelGauge/index.tsx")).toContain(
      'panelTitle="Fuel Gauge"',
    );
    expect(read("client/src/FuelGauge/index.tsx")).not.toContain(
      "VesselWidget",
    );
    expect(read("client/src/FuelGauge/index.test.tsx")).toContain(
      "FuelGaugeWidget",
    );
    expect(read("client/src/FuelGauge/__fixtures__/fuel-gauge.json")).toContain(
      '"widget": "solo-fuel-gauge"',
    );
    expect(read("client/src/index.ts")).toContain(
      'import "./FuelGauge/index.js";',
    );
    expect(read("client/src/index.ts")).toContain(
      'export { FuelGaugeWidget } from "./FuelGauge/index.js";',
    );
  });

  it("takes the same name as words, kebab-case or PascalCase", () => {
    addToUplink(dir, "setting", "FuelGauge");
    expect(existsSync(join(dir, "client/src/settings/fuel-gauge.ts"))).toBe(
      true,
    );
    expect(() => addToUplink(dir, "setting", "fuel-gauge")).toThrow(
      /never overwrites/,
    );
  });

  it("adds an augment on the slot it is given, owned by the Uplink", () => {
    addToUplink(dir, "augment", "open roster", { slot: "crew-status.actions" });
    const augment = read("client/src/augments/open-roster.tsx");
    expect(augment).toContain('augments: "crew-status.actions"');
    expect(augment).toContain("owner: SOLO");
    expect(read("client/src/index.ts")).toContain(
      'import "./augments/open-roster.js";',
    );
    expect(
      existsSync(join(dir, "client/src/augments/open-roster.test.tsx")),
    ).toBe(true);
  });

  it("adds a contribution through the Uplink's own handle", () => {
    addToUplink(dir, "contribution", "full cabin");
    const text = read("client/src/contributions/full-cabin.ts");
    expect(text).toContain("SOLO.registerContribution({");
    expect(text).toContain('contributes: "crew-status.badges"');
  });

  it("adds a processor on the Uplink's handle, with a test that reads it as a widget does", () => {
    addToUplink(dir, "processor", "descent rate");
    const text = read("client/src/processors/descent-rate.ts");
    expect(text).toContain(
      "export const DESCENT_RATE = SOLO.registerProcessor({",
    );
    expect(text).toContain('id: "descent-rate"');
    expect(read("client/src/processors/descent-rate.test.tsx")).toContain(
      "useProcessor(DESCENT_RATE)",
    );
    expect(read("client/src/index.ts")).toContain(
      'import "./processors/descent-rate.js";',
    );
  });

  it("adds a unit with its declaration", () => {
    addToUplink(dir, "unit", "snack crate");
    const text = read("client/src/units/snack-crate.ts");
    expect(text).toContain('"solo:snack-crate"');
    expect(text).toContain("registerUnit({");
  });

  it("imports only what an outside author can resolve", () => {
    for (const [kind, name] of [
      ["widget", "a"],
      ["augment", "b"],
      ["contribution", "c"],
      ["setting", "d"],
      ["unit", "e"],
      ["processor", "f"],
    ] as const) {
      addToUplink(dir, kind, `${name}${name}`);
    }
    const sources = [
      "client/src/Aa/index.tsx",
      "client/src/augments/bb.tsx",
      "client/src/contributions/cc.ts",
      "client/src/settings/dd.ts",
      "client/src/units/ee.ts",
      "client/src/processors/ff.ts",
      "client/src/processors/ff.test.tsx",
    ].map(read);
    for (const text of sources) {
      for (const [, specifier] of text.matchAll(/from "([^".][^"]*)"/g)) {
        expect(specifier).toMatch(
          /^(@ksp-gonogo\/sitrep-sdk(\/testing)?|@ksp-gonogo\/ui-kit|react|vitest)$/,
        );
      }
    }
  });

  it("refuses a name it cannot use, a client that is not there, and a slot on the wrong kind", () => {
    expect(() => addToUplink(dir, "widget", "9 lives")).toThrow(/not a name/);
    const bare = mkdtempSync(join(tmpdir(), "gonogo-add-"));
    scratch.push(bare);
    expect(() => addToUplink(bare, "widget", "x")).toThrow();
    expect(() =>
      add(["widget", "x", "--slot", "a.b", "--uplink", dir], dir),
    ).toThrow(/--slot is for/);
  });

  it("writes the page afterwards only when the client is installed", () => {
    const pages: string[] = [];
    add(["setting", "one", "--uplink", dir], dir, (c) => pages.push(c));
    expect(pages).toEqual([]);
    const said: string[] = [];
    vi.mocked(console.log).mockImplementation((l: string) => {
      said.push(String(l));
    });
    add(["setting", "two", "--uplink", dir], dir);
    expect(said.join("\n")).toContain("npm install && npm run page");
  });
});
