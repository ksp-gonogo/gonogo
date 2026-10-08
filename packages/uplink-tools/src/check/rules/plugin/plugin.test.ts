import { describe, expect, it } from "vitest";
import { UPLINK_JSON, uplinkOn } from "../fixture";
import { pluginRule, referencesOf } from "./index";

const ctx = (clientDir: string) => ({
  clientDir,
  scan: undefined as never,
  dynamicPrefixes: [],
});

const SCAFFOLD = `<Project Sdk="Microsoft.NET.Sdk">
  <!-- An Uplink that needs a live API adds a HintPath C:\\elsewhere\\x.dll here. -->
  <ItemGroup>
    <PackageReference Include="KspGonogo.Sitrep.Contract" Version="[1.0.0]" IncludeAssets="compile" />
    <PackageReference Include="Microsoft.NETFramework.ReferenceAssemblies" Version="1.0.3" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="..\\mod-contract\\GonogoDemoUplink.Contract.csproj" />
    <Reference Include="Assembly-CSharp">
      <HintPath>$(KspManaged)/Assembly-CSharp.dll</HintPath>
      <Private>false</Private>
    </Reference>
    <Reference Include="Gonogo">
      <HintPath>$(KspGameData)/Gonogo/Plugins/Sitrep.Contract.dll</HintPath>
    </Reference>
    <Reference Include="System.Xml" />
  </ItemGroup>
</Project>`;

const uplinkWith = (project: string) =>
  uplinkOn({
    "uplink.json": UPLINK_JSON(),
    "client/package.json": "{}",
    "mod/GonogoDemoUplink.csproj": project,
    "mod-contract/GonogoDemoUplink.Contract.csproj": "<Project />",
  });

describe("plugin/references", () => {
  it("passes what the scaffold writes, a comment naming a HintPath included", () => {
    expect(pluginRule.check(ctx(uplinkWith(SCAFFOLD).clientDir))).toEqual([]);
  });

  it("warns about a project reference that leaves the Uplink", () => {
    const project = SCAFFOLD.replace(
      "</Project>",
      `<ItemGroup><ProjectReference Include="..\\..\\Sitrep.Core\\Sitrep.Core.csproj" /></ItemGroup></Project>`,
    );
    const [finding] = pluginRule.check(ctx(uplinkWith(project).clientDir));
    expect(finding.rule).toBe("plugin/references");
    expect(finding.severity).toBe("warning");
    expect(finding.message).toContain("Sitrep.Core.csproj");
    expect(finding.line).toBe(18);
  });

  it("warns about a package that is not the contract, the reference assemblies or the test SDK", () => {
    const project = SCAFFOLD.replace(
      "</Project>",
      `<ItemGroup><PackageReference Include="Newtonsoft.Json" Version="13.0.1" /></ItemGroup></Project>`,
    );
    const [finding] = pluginRule.check(ctx(uplinkWith(project).clientDir));
    expect(finding.message).toContain("Newtonsoft.Json");
  });

  it("warns about an assembly read from outside the game and the parent mod", () => {
    const project = SCAFFOLD.replace(
      "</Project>",
      `<ItemGroup><Reference Include="Sitrep.Core"><HintPath>..\\..\\Sitrep.Core\\bin\\Sitrep.Core.dll</HintPath></Reference></ItemGroup></Project>`,
    );
    const [finding] = pluginRule.check(ctx(uplinkWith(project).clientDir));
    expect(finding.message).toContain("Sitrep.Core.dll");
  });

  it("also reads the slice's and the tests' projects", () => {
    const { clientDir } = uplinkOn({
      "uplink.json": UPLINK_JSON(),
      "client/package.json": "{}",
      "mod-tests/GonogoDemoUplink.Tests.csproj":
        '<Project><ItemGroup><ProjectReference Include="../../../mod/Sitrep.Core/Sitrep.Core.csproj" /></ItemGroup></Project>',
    });
    expect(pluginRule.check(ctx(clientDir))).toHaveLength(1);
  });

  it("is absent for a client with no plugin beside it", () => {
    const { clientDir } = uplinkOn({
      "uplink.json": UPLINK_JSON(),
      "client/package.json": "{}",
    });
    expect(pluginRule.check(ctx(clientDir))).toEqual([]);
  });

  it("reads a Reference's HintPath whether it is an element or an attribute", () => {
    const found = referencesOf(
      `<Reference Include="A" HintPath="x.dll" /><Reference Include="B"><HintPath>y.dll</HintPath></Reference>`,
    );
    expect(found.map((r) => r.hintPath)).toEqual(["x.dll", "y.dll"]);
  });
});
