import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { add, addCommand, addToUplink } from "./add";
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

  describe("command", () => {
    const own = async () => {
      const repo = mkdtempSync(join(tmpdir(), "gonogo-add-"));
      scratch.push(repo);
      await newUplink(
        [
          "mine",
          "--yes",
          "--topics",
          "own",
          "--author",
          "T",
          "--no-repo",
          "--no-ksp",
          "--no-generate",
          "--no-install",
        ],
        repo,
      );
      return repo;
    };
    const at = (repo: string, path: string) =>
      readFileSync(join(repo, path), "utf8");

    it("declares the arguments, the handler and a test, and wires them together", async () => {
      const repo = await own();
      const result = addCommand(repo, "reset counter");

      expect(result.commandId).toBe("mine.resetCounter");
      expect(result.byHand).toEqual([]);
      const payloads = at(repo, "mod-contract/MinePayloads.cs");
      expect(payloads).toContain(
        '[SitrepCommand("mine.resetCounter", Delay = DelayRole.TrueNow)]',
      );
      expect(payloads).toContain("public sealed class MineResetCounterArgs");
      expect(at(repo, "mod-contract/MineRtConfig.cs")).toContain(
        "typeof(MineHeartbeat), typeof(MineResetCounterArgs) }",
      );
      const plugin = at(repo, "mod/MineUplink.cs");
      expect(plugin).toContain(
        'public const string ResetCounterCommand = "mine.resetCounter";',
      );
      expect(plugin).toContain(
        "new CommandDeclaration { Command = ResetCounterCommand },",
      );
      expect(plugin).toContain(
        "host.AddCommandHandler<MineResetCounterArgs, CommandResult>(ResetCounterCommand, ResetCounter);",
      );
      expect(plugin).toContain(
        "internal CommandResult ResetCounter(MineResetCounterArgs args)",
      );
      const tests = at(repo, "mod-tests/MineUplinkTests.cs");
      expect(tests).toContain("DeclaresResetCounterCommand");
      expect(tests).toContain("ResetCounterSucceeds");
    });

    it("takes a second command beside the first, and a delay", async () => {
      const repo = await own();
      addCommand(repo, "reset counter");
      addCommand(repo, "stop now", {
        delay: "delayed",
        subject: "vessel.flight",
      });

      const plugin = at(repo, "mod/MineUplink.cs");
      expect(plugin.match(/new CommandDeclaration/g)).toHaveLength(2);
      expect(plugin.match(/host\.AddCommandHandler/g)).toHaveLength(2);
      expect(at(repo, "mod-contract/MinePayloads.cs")).toContain(
        '[SitrepCommand("mine.stopNow")]',
      );
      expect(plugin).toContain(
        'new CommandDeclaration { Command = StopNowCommand, Subject = "vessel.flight" },',
      );
      expect(at(repo, "mod-contract/MineRtConfig.cs")).toContain(
        "typeof(MineResetCounterArgs), typeof(MineStopNowArgs) }",
      );
    });

    it("writes nothing, and says what to add, when a file no longer matches the scaffold", async () => {
      const repo = await own();
      const pluginPath = join(repo, "mod/MineUplink.cs");
      const edited = readFileSync(pluginPath, "utf8").replace(
        "public void Register(IUplinkHost host)",
        "public void Register(IUplinkHost h)",
      );
      writeFileSync(pluginPath, edited);
      const payloadsBefore = at(repo, "mod-contract/MinePayloads.cs");

      const result = addCommand(repo, "reset counter");

      expect(result.changed).toEqual([]);
      expect(result.byHand.join("\n")).toContain("mod/MineUplink.cs");
      expect(at(repo, "mod-contract/MinePayloads.cs")).toBe(payloadsBefore);
    });

    it("refuses an Uplink with no contract slice, a name that is taken and a delay it does not know", async () => {
      expect(() => addCommand(dir, "reset")).toThrow(/no codegen/);
      const repo = await own();
      addCommand(repo, "reset");
      expect(() => addCommand(repo, "reset")).toThrow(/already declares/);
      expect(() => addCommand(repo, "other", { delay: "soon" })).toThrow(
        /--delay/,
      );
    });
  });
});
