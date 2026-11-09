import {
  existsSync,
  mkdirSync,
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
import type { Prompter } from "./questions";

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
    addToUplink(dir, "contribution", "full cabin", {
      slot: "crew-status.badges",
    });
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
      addToUplink(dir, kind, `${name}${name}`, {
        slot:
          kind === "augment"
            ? "crew-status.actions"
            : kind === "contribution"
              ? "crew-status.badges"
              : undefined,
      });
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

  it("refuses a name it cannot use, a client that is not there, and a slot on the wrong kind", async () => {
    expect(() => addToUplink(dir, "widget", "9 lives")).toThrow(/not a name/);
    const bare = mkdtempSync(join(tmpdir(), "gonogo-add-"));
    scratch.push(bare);
    expect(() => addToUplink(bare, "widget", "x")).toThrow();
    await expect(
      add(["widget", "x", "crew-status.actions", "--uplink", dir], dir),
    ).rejects.toThrow(/slot is for/);
  });

  it("writes the page afterwards only when the client is installed", async () => {
    const pages: string[] = [];
    await add(["setting", "one", "--uplink", dir], dir, {
      runPage: (c) => pages.push(c),
    });
    expect(pages).toEqual([]);
    const said: string[] = [];
    vi.mocked(console.log).mockImplementation((l: string) => {
      said.push(String(l));
    });
    await add(["setting", "two", "--uplink", dir], dir);
    expect(said.join("\n")).toContain("npm install && npm run page");
  });

  describe("the slot an augment or a contribution joins", () => {
    /** A stand-in for the installed sdk's declarations, with the slots the tests name. */
    const installSdk = () => {
      const api = join(
        dir,
        "client/node_modules/@ksp-gonogo/sitrep-sdk/dist/api",
      );
      mkdirSync(api, { recursive: true });
      writeFileSync(
        join(api, "slots.d.ts"),
        `declare module "./types" {
  interface SlotRegistry {
    /** The {@link Avatar} of a kerbal. */
    "crew-status.avatar": Record<string, never>;
  }
}
declare module "./types" {
  interface ContributionRegistry {
    "ship-map.part-meters": { entry: PartMeterEntry };
  }
}
`,
      );
    };
    const noTerminal = { interactive: false };
    const answering = (yes: boolean): Prompter => ({
      text: async () => "",
      select: async () => "",
      confirm: async () => yes,
      isCancel: (v): v is symbol => typeof v === "symbol",
    });

    it("needs the slot, and a slot shaped as a widget id and a segment", async () => {
      await expect(add(["augment", "x", "--uplink", dir], dir)).rejects.toThrow(
        /joins a slot/,
      );
      await expect(
        add(["augment", "x", "Crew Status", "--uplink", dir], dir),
      ).rejects.toThrow(/not a slot id/);
      expect(existsSync(join(dir, "client/src/augments/x.tsx"))).toBe(false);
    });

    it("writes into a slot the sdk declares, and into a standard segment of a widget it knows", async () => {
      installSdk();
      await add(
        ["augment", "avatar mark", "crew-status.avatar", "--uplink", dir],
        dir,
        noTerminal,
      );
      await add(
        ["augment", "roster", "crew-status.actions", "--uplink", dir],
        dir,
        noTerminal,
      );
      await add(
        ["contribution", "meter", "ship-map.part-meters", "--uplink", dir],
        dir,
        noTerminal,
      );
      await add(
        ["contribution", "badge", "crew-status.badges", "--uplink", dir],
        dir,
        noTerminal,
      );
      expect(read("client/src/augments/avatar-mark.tsx")).toContain(
        'augments: "crew-status.avatar"',
      );
      expect(read("client/src/augments/avatar-mark.tsx")).toContain(
        "slot of the crew-status widget",
      );
      expect(existsSync(join(dir, "client/src/slots"))).toBe(false);
    });

    it("names an unknown slot, lists the known ones and writes nothing with no terminal", async () => {
      installSdk();
      const said: string[] = [];
      vi.spyOn(console, "error").mockImplementation((l: string) => {
        said.push(String(l));
      });
      await expect(
        add(
          ["augment", "x", "crew-status.cabin", "--uplink", dir],
          dir,
          noTerminal,
        ),
      ).rejects.toThrow(/--declare-slot/);
      await expect(
        add(
          ["augment", "x", "crew-status.cabin", "--uplink", dir],
          dir,
          noTerminal,
        ),
      ).rejects.toThrow(/crew-status\.avatar/);
      expect(existsSync(join(dir, "client/src/augments/x.tsx"))).toBe(false);
      expect(existsSync(join(dir, "client/src/slots"))).toBe(false);
    });

    it("writes the declaration beside the augment when --declare-slot says so", async () => {
      installSdk();
      await add(
        [
          "augment",
          "x",
          "otheruplink.panel",
          "--declare-slot",
          "--uplink",
          dir,
        ],
        dir,
        noTerminal,
      );
      const declaration = read("client/src/slots/otheruplink-panel.ts");
      expect(declaration).toContain("interface SlotRegistry");
      expect(declaration).toContain(
        '"otheruplink.panel": Record<string, unknown>;',
      );
      expect(read("client/src/index.ts")).toContain(
        'import "./slots/otheruplink-panel.js";',
      );
      expect(read("client/src/augments/x.tsx")).toContain(
        'augments: "otheruplink.panel"',
      );
    });

    it("declares a contribution's slot in the contribution registry", async () => {
      await add(
        [
          "contribution",
          "y",
          "otheruplink.rows",
          "--declare-slot",
          "--uplink",
          dir,
        ],
        dir,
        noTerminal,
      );
      expect(read("client/src/slots/otheruplink-rows.ts")).toContain(
        '"otheruplink.rows": { entry: Record<string, unknown> };',
      );
    });

    it("asks on a terminal, and writes the declaration only on a yes", async () => {
      installSdk();
      await add(["augment", "yes one", "otheruplink.a", "--uplink", dir], dir, {
        interactive: true,
        loadPrompter: async () => answering(true),
      });
      expect(existsSync(join(dir, "client/src/slots/otheruplink-a.ts"))).toBe(
        true,
      );

      const code = await add(
        ["augment", "no one", "otheruplink.b", "--uplink", dir],
        dir,
        {
          interactive: true,
          loadPrompter: async () => answering(false),
        },
      );
      expect(code).toBe(1);
      expect(existsSync(join(dir, "client/src/slots/otheruplink-b.ts"))).toBe(
        false,
      );
      expect(existsSync(join(dir, "client/src/augments/no-one.tsx"))).toBe(
        false,
      );
    });

    it("says when the sdk's declarations could not be read", async () => {
      await expect(
        add(
          ["augment", "x", "crew-status.actions", "--uplink", dir],
          dir,
          noTerminal,
        ),
      ).rejects.toThrow(/dependencies are not installed/);
    });
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
