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

/** Only the files: the generators need the .NET SDK, npm and the network, and the scaffold probe is what runs them. */
const BARE = ["--no-generate", "--no-install"];

const seed = () =>
  renderSeed({
    id: "widgets",
    name: "Widgets",
    author: "me",
    repo: "https://elsewhere.test/r",
    clientUrl: "https://elsewhere.test/widgets.js",
    contractVersion: "4.5.6",
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
      expect(content).not.toContain("example");
    }
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

  it("writes the seed, inherits a sibling's pins and never overwrites", () => {
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

    newUplink(["fresh", "--dir", uplinks, ...BARE]);

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
    expect(() => newUplink(["fresh", "--dir", uplinks, ...BARE])).toThrow(
      /already exists/,
    );
  });
  it("pins every published sibling to this package's own version when there is no sibling Uplink to inherit from", () => {
    const uplinks = join(workdir(), "uplinks");
    vi.spyOn(console, "log").mockImplementation(() => {});

    newUplink(["fresh", "--dir", uplinks, ...BARE]);

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

  it("makes an empty directory the Uplink's own repo when there is no uplinks folder", () => {
    const repo = workdir();
    vi.spyOn(console, "log").mockImplementation(() => {});

    newUplink(["solo", ...BARE], repo);

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

    expect(() => newUplink(["solo", ...BARE], repo)).toThrow(
      /never overwrites/,
    );
  });

  it("takes the repository it will be published from, and derives where the client is fetched", () => {
    const repo = workdir();
    vi.spyOn(console, "log").mockImplementation(() => {});

    newUplink(["solo", "--repo", "kerbal/solo-uplink", ...BARE], repo);

    const declared = JSON.parse(
      readFileSync(join(repo, "uplink.json"), "utf8"),
    );
    expect(declared.repo).toBe("https://github.com/kerbal/solo-uplink");
    expect(declared.client.url).toBe(
      "https://cdn.jsdelivr.net/gh/kerbal/solo-uplink@releases/releases/solo/0.0.1/solo.client.js",
    );
    expect(() =>
      newUplink(["other", "--repo", "not a repo", ...BARE], workdir()),
    ).toThrow(/not a GitHub repository/);
  });

  it("says where the game is found, for a lone repo, and asks only a project that references it", () => {
    const repo = workdir();
    vi.spyOn(console, "log").mockImplementation(() => {});

    newUplink(["solo", ...BARE], repo);

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

  it("ends by saying what was skipped and what is the author's, naming commands that exist", () => {
    const repo = workdir();
    const said: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      said.push(line);
    });

    expect(newUplink(["solo", ...BARE], repo)).toBe(0);

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

  it("goes into an uplinks folder that is already there, beside its siblings", () => {
    const repo = workdir();
    mkdirSync(join(repo, "uplinks"));
    vi.spyOn(console, "log").mockImplementation(() => {});

    newUplink(["second", ...BARE], repo);

    expect(existsSync(join(repo, "uplinks", "second", "uplink.json"))).toBe(
      true,
    );
    expect(existsSync(join(repo, "uplink.json"))).toBe(false);
    expect(existsSync(join(repo, "uplinks", "second", ".gitignore"))).toBe(
      false,
    );
  });
});
