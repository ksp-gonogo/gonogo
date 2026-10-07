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
import { afterEach, describe, expect, it, vi } from "vitest";
import { newUplink, renderSeed, validateUplinkId } from "./new";
import type { Prompter } from "./questions";

const scratch: string[] = [];
const workdir = () => {
  const dir = mkdtempSync(join(tmpdir(), "gonogo-new-"));
  scratch.push(dir);
  return dir;
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** Only the files, and every question answered by its default: the generators need the .NET SDK, npm and the network, and the scaffold probe is what runs them. */
const BARE = ["--yes", "--author", "Tester", "--no-generate", "--no-install"];

const seed = () =>
  renderSeed({
    id: "widgets",
    name: "Widgets",
    author: "me",
    repo: "https://elsewhere.test/r",
    clientUrl: "https://elsewhere.test/widgets.js",
    contractVersion: "4.5.6",
    topics: "own",
    dependencies: {},
    devDependencies: {},
  });

describe("uplink-tools new", () => {
  it("templates no generated file", () => {
    for (const path of seed().keys()) {
      expect(path).not.toMatch(/__generated__|\.g\.cs$|README\.md$|renders\//);
    }
  });

  it("derives every name from the id", () => {
    const files = seed();
    const declared = JSON.parse(files.get("uplink.json") ?? "");
    expect(declared.gamedata).toBe("GonogoWidgetsUplink");
    expect(declared.codegen.configurationMethod).toBe(
      "GonogoWidgetsUplink.WidgetsRtConfig.Configure",
    );
    expect(Object.keys(declared.codegen.emits)).toEqual([
      "SITREP_WIDGETS_TOPICMAP_OUT",
      "SITREP_WIDGETS_COMMANDMAP_OUT",
      "SITREP_WIDGETS_UNITMAP_OUT",
      "SITREP_WIDGETS_UNITJSON_OUT",
    ]);
    expect(files.get("mod/WidgetsUplink.cs")).toContain(
      'HeartbeatTopic = "widgets.heartbeat"',
    );
    expect(files.has("mod-tests/GonogoWidgetsUplink.Tests.csproj")).toBe(true);
    // The contract's C# attribute and the client's declare-module block must name the same topic.
    expect(files.get("mod-contract/WidgetsPayloads.cs")).toContain(
      '[SitrepTopic("widgets.heartbeat")]',
    );
    expect(files.get("client/src/topics.ts")).toContain(
      '"widgets.heartbeat": WidgetsHeartbeat;',
    );
    for (const [path, content] of files) {
      if (path.endsWith(".json"))
        expect(() => JSON.parse(content)).not.toThrow();
      // Nothing left over from an Uplink this seed was once copied from.
      expect(content).not.toMatch(/example[.-]|Example(Uplink|Heartbeat)/);
    }
  });

  it("emits a command map from the slice, so a command declared later reaches the page and the client", () => {
    const config = seed().get("mod-contract/WidgetsRtConfig.cs") ?? "";
    expect(config).toContain('"SITREP_WIDGETS_COMMANDMAP_OUT"');
    expect(config).toMatch(
      /EmitCommandMap\(\s+commandMapOut!,\s+typeof\(WidgetsRtConfig\)\.Assembly,\s+resultImportFrom: "@ksp-gonogo\/sitrep-sdk"\)/,
    );
  });

  it("carries no prose file, because the page opens with the client's own description", () => {
    const files = seed();
    expect([...files.keys()].filter((path) => path.endsWith(".md"))).toEqual(
      [],
    );
    expect(files.get("client/src/uplink.ts")).toContain("description:");
  });

  it("has the plugin announce its client, its author and one version, all from what bake writes", () => {
    const plugin = seed().get("mod/WidgetsUplink.cs") ?? "";
    for (const line of [
      "Version = Provenance.Version,",
      "Name = Provenance.Name,",
      "Author = Provenance.Author,",
      "Repo = Provenance.Repo,",
      "ClientSource = new UplinkClientSource",
      "Url = ClientSource.Url,",
    ]) {
      expect(plugin).toContain(line);
    }
    expect(plugin).toMatch(
      /ExpectedClientHash = string\.IsNullOrEmpty\(ExpectedClientHash\.Value\)\s+\? null/,
    );
    // A hand-typed version in the plugin is a second statement of the client's.
    expect(plugin).not.toMatch(/Version = "/);
  });

  it("stops both C# builds with the command to run when the baked files are absent", () => {
    const files = seed();
    for (const path of [
      "mod/GonogoWidgetsUplink.csproj",
      "mod-tests/GonogoWidgetsUplink.Tests.csproj",
    ]) {
      const project = files.get(path) ?? "";
      for (const file of [
        "Provenance.g.cs",
        "ClientSource.g.cs",
        "ExpectedClientHash.g.cs",
      ]) {
        expect(project, path).toContain(file);
      }
      expect(project, path).toContain("npx uplink-tools bake");
    }
    // The tests compile the plugin's sources in, so they need the baked ones too.
    expect(files.get("mod-tests/GonogoWidgetsUplink.Tests.csproj")).toContain(
      '<Compile Include="..\\mod\\*.cs" />',
    );
  });

  it("references Gonogo through the one NuGet package, pinned exactly, in every C# project", () => {
    const files = seed();
    const exact =
      '<PackageReference Include="KspGonogo.Sitrep.Contract" Version="[4.5.6]"';
    const plugin = files.get("mod/GonogoWidgetsUplink.csproj") ?? "";
    const slice =
      files.get("mod-contract/GonogoWidgetsUplink.Contract.csproj") ?? "";
    const tests = files.get("mod-tests/GonogoWidgetsUplink.Tests.csproj") ?? "";
    // Compiled against and never copied: GonogoCore provides the assembly in the game.
    for (const shipped of [plugin, slice]) {
      expect(shipped).toContain(
        `${exact} IncludeAssets="compile" PrivateAssets="all" />`,
      );
      expect(shipped).toContain("Microsoft.NETFramework.ReferenceAssemblies");
    }
    // The test project takes the whole package, which is where TestSupport comes from.
    expect(tests).toContain(`${exact} />`);
    for (const [path, content] of files) {
      expect(content, path).not.toMatch(
        /GonogoContract|GonogoDevkit|HintPath>\$\(Gonogo(?!Codegen)/,
      );
    }
  });

  it("leaves the codegen twin to the codegen command, and says so when it is built any other way", () => {
    const twin =
      seed().get(
        "mod-contract-codegen/GonogoWidgetsUplink.Contract.Codegen.csproj",
      ) ?? "";
    expect(twin).toContain("$(GonogoCodegen)\\CodegenTwin.props");
    expect(twin).toContain("$(GonogoCodegen)\\Sitrep.Contract.dll");
    expect(twin).toContain("npx uplink-tools codegen");
    expect(twin).not.toContain("PackageReference");
  });

  it("offers every step as a script of the client, and no build script that builds nothing", () => {
    const scripts = JSON.parse(seed().get("client/package.json") ?? "").scripts;
    expect(scripts).toMatchObject({
      codegen: "uplink-tools codegen",
      "codegen:check": "uplink-tools codegen --check",
      bundle: "uplink-tools bundle",
      bake: "uplink-tools bake --bundle dist/widgets/widgets.client.js",
      release: "uplink-tools release",
      page: "uplink-tools page",
    });
    expect(scripts.build).toBeUndefined();
  });

  it("refuses an id that cannot name a namespace", () => {
    expect(validateUplinkId("my-uplink")).toMatch(/not a usable/);
    expect(validateUplinkId("1abc")).toMatch(/not a usable/);
    expect(validateUplinkId("ok2")).toBeUndefined();
  });

  it("writes the seed, inherits a sibling's pins and never overwrites", async () => {
    const root = workdir();
    const uplinks = join(root, "uplinks");
    mkdirSync(join(uplinks, "sib", "client"), { recursive: true });
    writeFileSync(
      join(uplinks, "sib", "uplink.json"),
      JSON.stringify({
        id: "sib",
        author: "a",
        repo: "https://r",
        client: { url: "https://cdn/sib/0.0.1/sib.client.js" },
      }),
    );
    writeFileSync(
      join(uplinks, "sib", "client", "package.json"),
      JSON.stringify({
        dependencies: { "@ksp-gonogo/ui-kit": "file:../../../vendor/kit.tgz" },
        devDependencies: {},
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});

    await newUplink(["fresh", "--dir", uplinks, ...BARE]);

    const pkg = JSON.parse(
      readFileSync(join(uplinks, "fresh", "client", "package.json"), "utf8"),
    );
    expect(pkg.dependencies["@ksp-gonogo/ui-kit"]).toBe(
      "file:../../../vendor/kit.tgz",
    );
    const declared = JSON.parse(
      readFileSync(join(uplinks, "fresh", "uplink.json"), "utf8"),
    );
    expect(declared.client.url).toBe("https://cdn/fresh/0.0.1/fresh.client.js");
    expect(existsSync(join(uplinks, "fresh", "mod", "FreshUplink.cs"))).toBe(
      true,
    );
    await expect(
      newUplink(["fresh", "--dir", uplinks, ...BARE]),
    ).rejects.toThrow(/already exists/);
  });
  it("pins every published sibling to this package's own version when there is no sibling Uplink to inherit from", async () => {
    const uplinks = join(workdir(), "uplinks");
    vi.spyOn(console, "log").mockImplementation(() => {});

    await newUplink(["fresh", "--dir", uplinks, ...BARE]);

    const own = JSON.parse(
      readFileSync(
        join(import.meta.dirname, "..", "..", "package.json"),
        "utf8",
      ),
    ).version;
    const pkg = JSON.parse(
      readFileSync(join(uplinks, "fresh", "client", "package.json"), "utf8"),
    );
    const scoped = Object.fromEntries(
      Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(
        ([name]) => name.startsWith("@ksp-gonogo/"),
      ),
    );
    expect(scoped).toEqual({
      "@ksp-gonogo/sitrep-sdk": own,
      "@ksp-gonogo/ui-kit": own,
      "@ksp-gonogo/uplink-tools": own,
    });
  });

  it("makes an empty directory the Uplink's own repo when there is no uplinks folder", async () => {
    const repo = workdir();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await newUplink(["solo", ...BARE], repo);

    for (const path of [
      "uplink.json",
      ".gitignore",
      "client/package.json",
      "client/src/index.ts",
      "mod/SoloUplink.cs",
      "mod-contract/GonogoSoloUplink.Contract.csproj",
      "mod-tests/GonogoSoloUplink.Tests.csproj",
    ]) {
      expect(existsSync(join(repo, path)), path).toBe(true);
    }
    expect(existsSync(join(repo, "uplinks"))).toBe(false);
    // Baked once by new, so the plugin compiles at once, and kept out of git.
    const provenance = readFileSync(
      join(repo, "mod", "Provenance.g.cs"),
      "utf8",
    );
    expect(provenance).toContain("namespace GonogoSoloUplink");
    expect(provenance).toContain('Version = "0.0.1";');
    expect(
      readFileSync(join(repo, "mod", "ClientSource.g.cs"), "utf8"),
    ).toContain("solo.client.js");
    expect(
      readFileSync(join(repo, "mod", "ExpectedClientHash.g.cs"), "utf8"),
    ).toContain('Value = "";');
    expect(readFileSync(join(repo, ".gitignore"), "utf8")).toContain("*.g.cs");
    const declared = JSON.parse(
      readFileSync(join(repo, "uplink.json"), "utf8"),
    );
    expect(declared.repo).toBe("https://github.com/you/solo");
    const scripts = JSON.parse(
      readFileSync(join(repo, "client", "package.json"), "utf8"),
    ).scripts;
    expect(scripts.bundle).toBe("uplink-tools bundle");
    expect(scripts.docs).toBe("uplink-tools docs");

    await expect(newUplink(["solo", ...BARE], repo)).rejects.toThrow(
      /never overwrites/,
    );
  });

  it("takes the repository it will be published from, and derives where the client is fetched", async () => {
    const repo = workdir();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await newUplink(["solo", "--repo", "kerbal/solo-uplink", ...BARE], repo);

    const declared = JSON.parse(
      readFileSync(join(repo, "uplink.json"), "utf8"),
    );
    expect(declared.repo).toBe("https://github.com/kerbal/solo-uplink");
    expect(declared.client.url).toBe(
      "https://cdn.jsdelivr.net/gh/kerbal/solo-uplink@releases/releases/solo/0.0.1/solo.client.js",
    );
    await expect(
      newUplink(["other", "--repo", "not a repo", ...BARE], workdir()),
    ).rejects.toThrow(/not a GitHub repository/);
  });

  it("says where the game is found, for a lone repo, and asks only a project that references it", async () => {
    const repo = workdir();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await newUplink(["solo", ...BARE], repo);

    const props = readFileSync(join(repo, "Directory.Build.props"), "utf8");
    expect(props).toContain("$(KSP_ROOT)");
    expect(props).toContain("ksp.local.props");
    expect(
      readFileSync(join(repo, "Directory.Build.targets"), "utf8"),
    ).toContain("Set the KSP_ROOT environment variable");
    expect(readFileSync(join(repo, ".gitignore"), "utf8")).toContain(
      "ksp.local.props",
    );
  });

  it("ends by saying what was skipped and what is the author's, naming commands that exist", async () => {
    const repo = workdir();
    const said: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      said.push(line);
    });

    expect(await newUplink(["solo", ...BARE], repo)).toBe(0);

    const out = said.join("\n");
    expect(out).toContain("npx uplink-tools codegen");
    expect(out).toContain("npm install");
    // The first write goes through the generator. The test run's update switch is refused under CI, and a scaffold is often made there.
    expect(out).toContain("npm run page");
    expect(out).not.toContain("GONOGO_UPLINK_PAGE_UPDATE");
    expect(out).toContain("npm run release");
    expect(out).toContain("release refuses the placeholder");
    // Nothing an outside author cannot run: no repo-only script, no property to point at a reference set.
    expect(out).not.toMatch(/tooling\/|GonogoContract|pnpm /);
  });

  it("goes into an uplinks folder that is already there, beside its siblings", async () => {
    const repo = workdir();
    mkdirSync(join(repo, "uplinks"));
    vi.spyOn(console, "log").mockImplementation(() => {});

    await newUplink(["second", ...BARE], repo);

    expect(existsSync(join(repo, "uplinks", "second", "uplink.json"))).toBe(
      true,
    );
    expect(existsSync(join(repo, "uplink.json"))).toBe(false);
    expect(existsSync(join(repo, "uplinks", "second", ".gitignore"))).toBe(
      false,
    );
  });

  it("with no terminal and a question unanswered, writes nothing and names every missing flag at once", async () => {
    const repo = workdir();
    const said: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => {
      said.push(line);
    });

    const code = await newUplink(
      ["solo", "--name", "Solo", "--no-generate", "--no-install"],
      repo,
      { interactive: false },
    );

    expect(code).toBe(2);
    expect(existsSync(join(repo, "uplink.json"))).toBe(false);
    const message = said.join("\n");
    expect(message).toContain("stdin is not a terminal");
    for (const flag of [
      "--author <name>",
      "--repo <owner>/<name> | --no-repo",
      "--topics own | core",
      "--workflows | --no-workflows",
      "--ksp <path> | --no-ksp",
    ]) {
      expect(message).toContain(flag);
    }
    // Answered on the command line, so not asked for again.
    expect(message).not.toContain("--name");
    expect(message).toContain("--yes");
  });

  it("asks nothing, and loads no prompt library, when every question is a flag", async () => {
    const repo = workdir();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const loadPrompter = vi.fn<() => Promise<Prompter>>();

    const code = await newUplink(
      [
        "solo",
        "--name",
        "Solo",
        "--author",
        "Tester",
        "--no-repo",
        "--topics",
        "own",
        "--no-workflows",
        "--no-ksp",
        "--no-generate",
        "--no-install",
      ],
      repo,
      { interactive: true, loadPrompter },
    );

    expect(code).toBe(0);
    expect(loadPrompter).not.toHaveBeenCalled();
  });

  it("on a terminal, asks only what the flags left open and writes what was answered", async () => {
    const repo = workdir();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const asked: string[] = [];
    const prompter: Prompter = {
      text: async ({ message }) => {
        asked.push(message);
        if (message.startsWith("Author")) return "Val Kerman";
        if (message.startsWith("GitHub repository")) return "val/solo";
        return "";
      },
      select: async ({ message }) => {
        asked.push(message);
        return "core";
      },
      confirm: async ({ message }) => {
        asked.push(message);
        return true;
      },
      isCancel: (value): value is symbol => typeof value === "symbol",
    };

    const code = await newUplink(
      ["solo", "--name", "Solo", "--no-generate", "--no-install"],
      repo,
      { interactive: true, loadPrompter: async () => prompter },
    );

    expect(code).toBe(0);
    // The id and the name came from the command line.
    expect(asked).toHaveLength(5);
    const declared = JSON.parse(
      readFileSync(join(repo, "uplink.json"), "utf8"),
    );
    expect(declared.author).toBe("Val Kerman");
    expect(declared.repo).toBe("https://github.com/val/solo");
    expect(declared.codegen).toBeUndefined();
    expect(existsSync(join(repo, ".github", "workflows", "ci.yml"))).toBe(true);
    expect(existsSync(join(repo, "ksp.local.props"))).toBe(false);
  });

  it("writes nothing when a prompt is cancelled", async () => {
    const repo = workdir();
    const cancelled = Symbol("cancel");
    const prompter: Prompter = {
      text: async () => cancelled,
      select: async () => cancelled,
      confirm: async () => cancelled,
      isCancel: (value): value is symbol => value === cancelled,
    };

    await expect(
      newUplink(["solo", "--no-generate", "--no-install"], repo, {
        interactive: true,
        loadPrompter: async () => prompter,
      }),
    ).rejects.toThrow(/Nothing was written/);
    expect(existsSync(join(repo, "uplink.json"))).toBe(false);
  });

  it("scaffolds an Uplink with no Topics of its own: no contract slice, a plugin that only announces the client, a widget on a core Topic", async () => {
    const repo = workdir();
    vi.spyOn(console, "log").mockImplementation(() => {});

    expect(await newUplink(["solo", "--topics", "core", ...BARE], repo)).toBe(
      0,
    );

    for (const absent of [
      "mod-contract",
      "mod-contract-codegen",
      "client/src/topics.ts",
      "client/src/Heartbeat",
    ]) {
      expect(existsSync(join(repo, absent)), absent).toBe(false);
    }
    const read = (path: string) => readFileSync(join(repo, path), "utf8");
    const declared = JSON.parse(read("uplink.json"));
    expect(declared.codegen).toBeUndefined();
    expect(
      JSON.parse(read("client/package.json")).scripts.codegen,
    ).toBeUndefined();
    expect(read("mod/SoloUplink.cs")).not.toContain("Channels =");
    expect(read("mod/SoloUplink.cs")).toContain(
      "ClientSource = new UplinkClientSource",
    );
    expect(read("mod/GonogoSoloUplink.csproj")).not.toContain("mod-contract");
    expect(read("mod-tests/GonogoSoloUplink.Tests.csproj")).not.toContain(
      "mod-contract",
    );
    expect(read("client/src/Vessel/index.tsx")).toContain(
      'channels: ["vessel.identity"]',
    );
    expect(read("client/src/index.ts")).not.toContain("topics");
  });

  it("writes a CI workflow for a lone repo when asked, checking generated types only where there are some", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const own = workdir();
    const core = workdir();

    await newUplink(["solo", "--workflows", ...BARE], own);
    await newUplink(["solo", "--workflows", "--topics", "core", ...BARE], core);
    const plain = workdir();
    await newUplink(["solo", ...BARE], plain);

    const workflow = (repo: string) =>
      readFileSync(join(repo, ".github", "workflows", "ci.yml"), "utf8");
    expect(workflow(own)).toContain("npm run codegen:check");
    expect(workflow(own)).toContain("dotnet test mod-tests");
    expect(workflow(own)).toContain("npm run release");
    expect(workflow(core)).not.toContain("codegen");
    // Off unless asked for.
    expect(existsSync(join(plain, ".github"))).toBe(false);
  });

  it("records where KSP is, out of git, and refuses a folder that is not an install", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const install = workdir();
    mkdirSync(join(install, "KSP_Data", "Managed"), { recursive: true });
    writeFileSync(
      join(install, "KSP_Data", "Managed", "Assembly-CSharp.dll"),
      "",
    );
    const repo = workdir();

    await newUplink(["solo", "--ksp", install, ...BARE], repo);

    expect(readFileSync(join(repo, "ksp.local.props"), "utf8")).toContain(
      `<KspRoot>${install}</KspRoot>`,
    );
    expect(readFileSync(join(repo, ".gitignore"), "utf8")).toContain(
      "ksp.local.props",
    );
    await expect(
      newUplink(["other", "--ksp", workdir(), ...BARE], workdir()),
    ).rejects.toThrow(/not a KSP install/);
  });
});
