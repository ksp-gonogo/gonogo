/**
 * `uplink-tools new <id>`: the hand-written seed of a fresh Uplink, and then its
 * generators, so the directory it leaves builds and tests.
 *
 * It writes only what an author writes. Everything a generator owns is left to
 * that generator, so the scaffold cannot drift from the toolchain: the contract,
 * topic map and unit map come from `codegen`, the page from the page check, and
 * the three `.g.cs` files the plugin announces its client with from `bake`.
 *
 * The C# half reaches Gonogo through one NuGet package,
 * `KspGonogo.Sitrep.Contract`, pinned to exactly this package's own version as
 * the npm packages are: every published package carries the one release
 * version.
 *
 * The widget is deliberately minimal. Copying a finished Uplink hands an author
 * someone else's demo to delete; an empty one that builds is a better start.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bakeUplink, describeBake } from "./bake";
import { generate } from "./codegen";
import { parseFlags } from "./flags";
import {
  type Answers,
  MissingAnswers,
  type Prompter,
  pascal,
  QUESTION_SWITCHES,
  QUESTION_VALUES,
  questionHelp,
  resolveAnswers,
} from "./questions";
import { PLACEHOLDER_OWNER } from "./release";

export { validateUplinkId } from "./questions";

export interface SeedOptions {
  id: string;
  name: string;
  author: string;
  repo: string;
  clientUrl: string;
  /** The version of the `KspGonogo.Sitrep.Contract` NuGet package every C# project references. */
  contractVersion: string;
  /** `own`: a contract slice, generated client types and a Topic the plugin publishes. `core`: none of those, and a widget that reads a Topic Gonogo already publishes. */
  topics: Answers["topics"];
  dependencies: Readonly<Record<string, string>>;
  devDependencies: Readonly<Record<string, string>>;
}

/** The seed's files keyed by path relative to the Uplink's directory. */
export function renderSeed(o: SeedOptions): Map<string, string> {
  const id = o.id;
  const Id = pascal(id);
  const ns = `Gonogo${Id}Uplink`;
  const upper = id.toUpperCase();
  const widgetId = `${id}-heartbeat`;
  const topic = `${id}.heartbeat`;
  const json = (value: unknown): string =>
    `${JSON.stringify(value, null, 2)}\n`;
  const files = new Map<string, string>();
  // Exact, in NuGet's range syntax: a bare version there means "this or anything newer".
  const contractPackage = (attributes: string): string =>
    `<PackageReference Include="KspGonogo.Sitrep.Contract" Version="[${o.contractVersion}]"${attributes} />`;
  const referenceAssemblies = `<!-- The .NET Framework reference assemblies, so net48 compiles on macOS and Linux. -->
    <PackageReference Include="Microsoft.NETFramework.ReferenceAssemblies" Version="1.0.3" PrivateAssets="all" />`;

  files.set(
    "uplink.json",
    json({
      id,
      name: o.name,
      author: o.author,
      repo: o.repo,
      gamedata: ns,
      dll: `${ns}.dll`,
      minAppVersion: "0.0.0",
      mod: null,
      codegen: {
        assembly: `${ns}.Contract`,
        configurationMethod: `${ns}.${Id}RtConfig.Configure`,
        emits: {
          [`SITREP_${upper}_TOPICMAP_OUT`]: "topic-map.ts",
          [`SITREP_${upper}_COMMANDMAP_OUT`]: "command-map.ts",
          [`SITREP_${upper}_UNITMAP_OUT`]: "units.ts",
          [`SITREP_${upper}_UNITJSON_OUT`]: "units.json",
        },
      },
      csharpNamespace: ns,
      client: { url: o.clientUrl },
    }),
  );

  files.set(
    "client/package.json",
    json({
      name: `@ksp-gonogo/gonogo-${id}-uplink`,
      license: "MIT",
      version: "0.0.1",
      type: "module",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      exports: {
        ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      },
      scripts: {
        test: "vitest run",
        typecheck:
          "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.nodenext.json",
        codegen: "uplink-tools codegen",
        "codegen:check": "uplink-tools codegen --check",
        bundle: "uplink-tools bundle",
        bake: `uplink-tools bake --bundle dist/${id}/${id}.client.js`,
        release: "uplink-tools release",
        render: "uplink-tools render",
        page: "uplink-tools page",
        docs: "uplink-tools docs",
        "docs:check": "uplink-tools docs --check",
      },
      dependencies: o.dependencies,
      devDependencies: o.devDependencies,
      peerDependencies: { react: "^18.0.0" },
    }),
  );

  files.set(
    "client/tsconfig.json",
    json({
      extends: "@ksp-gonogo/sitrep-sdk/tsconfig.base.json",
      compilerOptions: { noEmit: true },
      include: ["src"],
    }),
  );
  files.set(
    "client/tsconfig.nodenext.json",
    json({
      extends: "@ksp-gonogo/sitrep-sdk/tsconfig.base.json",
      compilerOptions: {
        noEmit: true,
        module: "nodenext",
        moduleResolution: "nodenext",
      },
      include: ["src"],
    }),
  );

  files.set(
    "client/vitest.config.ts",
    `import { defineConfig } from "vitest/config";

// No @ksp-gonogo aliases: this client imports only published packages, so a test cannot reach API that was never published.
export default defineConfig({
  test: {
    name: "${id}",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["dist/**", "**/node_modules/**"],
    server: {
      deps: {
        inline: [
          "@ksp-gonogo/ui-kit",
          "@ksp-gonogo/sitrep-sdk",
          "@ksp-gonogo/uplink-tools",
        ],
      },
    },
  },
});
`,
  );

  files.set(
    "client/src/test/setup.ts",
    `import "@testing-library/jest-dom/vitest";
import { PerfBudget } from "@ksp-gonogo/sitrep-sdk";
import {
  installDomStubs,
  installRealTestHost,
} from "@ksp-gonogo/sitrep-sdk/testing";
import {
  AugmentSlot,
  clearAugments,
  getAugmentsForSlot,
  registerAugment,
  setQuantityLocale,
} from "@ksp-gonogo/ui-kit";

installDomStubs();
PerfBudget.installTestGate();

// Installed here and not in a beforeEach: registerComponent runs at module scope, which is before any hook.
installRealTestHost({
  AugmentSlot,
  clearAugments,
  getAugmentsForSlot,
  registerAugment,
});

setQuantityLocale("en-GB");
`,
  );

  files.set(
    "client/src/uplink.ts",
    `import { defineUplinkClient } from "@ksp-gonogo/sitrep-sdk";

/** Must equal package.json's version: gonogo-uplink.json is generated from this. */
const UPLINK_VERSION = "0.0.1";

/**
 * This Uplink's client, as the dashboard lists it. Every widget names it as its
 * \`owner\`. The description opens the generated page, so it says what the Uplink
 * is for in a sentence someone deciding whether to install it can use.
 */
export const ${upper} = defineUplinkClient({
  id: "${id}",
  version: UPLINK_VERSION,
  name: ${JSON.stringify(o.name)},
  description: "Shows that the ${o.name} Uplink is installed and publishing: a count of its samples and the game time of the latest.",
});
`,
  );

  files.set(
    "client/src/index.ts",
    `import "./topics.js";
import "./Heartbeat/index.js";

export { ${upper} } from "./uplink.js";
export { HeartbeatWidget } from "./Heartbeat/index.js";
export type { ${Id}Heartbeat } from "./topics.js";
`,
  );

  files.set(
    "client/src/topics.ts",
    `import { registerTopicUnits, registerTypeUnits } from "@ksp-gonogo/sitrep-sdk";
import type { ${Id}Heartbeat } from "./__generated__/contract.js";
import {
  GENERATED_TOPIC_SHAPES,
  GENERATED_TOPIC_UNITS,
  GENERATED_TYPE_SHAPES,
  GENERATED_TYPE_UNITS,
} from "./__generated__/units.js";

// Tells the sdk what each of this Uplink's Topics carries, so useTelemetry("${topic}") is typed. Add a line for every Topic the contract slice declares.
declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    "${topic}": ${Id}Heartbeat;
  }
}

// The unit of each field, from the [SitrepUnit] attributes in the contract slice. It is what lets <Unit> write a value with its unit.
for (const [topic, units] of Object.entries(GENERATED_TOPIC_UNITS)) {
  registerTopicUnits(topic, units, GENERATED_TOPIC_SHAPES[topic] ?? {});
}
for (const [typeName, units] of Object.entries(GENERATED_TYPE_UNITS)) {
  registerTypeUnits(typeName, units, GENERATED_TYPE_SHAPES[typeName] ?? {});
}

/**
 * What \`${topic}\` carries. The fields and their descriptions are generated
 * from the C# type of the same name in \`mod-contract/\`, which is the one place
 * to change them.
 *
 * @example
 * \`\`\`tsx
 * function Ticks() {
 *   const heartbeat = useTelemetry("${topic}");
 *   if (heartbeat.state !== "observed") return null;
 *   return <Unit value={heartbeat.value.ticks} />;
 * }
 * \`\`\`
 */
export type { ${Id}Heartbeat };
`,
  );

  files.set(
    "client/src/Heartbeat/index.tsx",
    `import { registerComponent, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import { EmptyState, Panel, Section, Text, Unit } from "@ksp-gonogo/ui-kit";
import { ${upper} } from "../uplink.js";

/** Why there is no count to draw. Each is a different thing for an operator to do something about, so each has its own words. */
const NO_VALUE = {
  pending: "Waiting for the ${id} Uplink",
  absent: "The ${id} Uplink reports no heartbeat",
  unowned: "The ${id} Uplink is not installed",
};

/**
 * How many samples the ${o.name} Uplink has published, and the game time of the
 * latest. With no sample it says why there is none, since a zero would read as
 * a count. When samples stop arriving it keeps the last count and marks it as
 * held, since a stale number that looks current is worse than no number.
 */
function HeartbeatWidget() {
  const heartbeat = useTelemetry("${topic}");

  if (heartbeat.state !== "observed" && heartbeat.state !== "held") {
    return (
      <Panel
        panelTitle="Heartbeat"
        sections={
          <Section>
            <EmptyState>{NO_VALUE[heartbeat.state]}</EmptyState>
          </Section>
        }
      />
    );
  }

  // heartbeat.ticks and heartbeat.ut are readings of one field each, and <Unit> marks a held one. heartbeat.value.ticks is the bare number: the same figure with nothing to say it has gone stale.
  return (
    <Panel
      panelTitle="Heartbeat"
      sections={
        <Section>
          <Text>
            Ticks <Unit value={heartbeat.ticks} />
          </Text>
          <Text>
            UT <Unit value={heartbeat.ut} />
          </Text>
        </Section>
      }
    />
  );
}

registerComponent({
  id: "${widgetId}",
  name: "Heartbeat",
  // Shown in the widget picker and on the generated page: what it shows and what an operator can do with it, in plain words.
  description: "How many samples the ${o.name} Uplink has published, and the game time of the latest one. It has no controls.",
  tags: ["${id}"],
  // In grid units. The smallest size is the smallest at which the title and both lines can still be read, which \`uplink-tools docs\` checks in a real browser.
  defaultSize: { w: 6, h: 4 },
  minSize: { w: 5, h: 4 },
  component: HeartbeatWidget,
  // The Topics it needs. When the Uplink serving one is unavailable, the dashboard says why in the widget's place.
  channels: ["${topic}"],
  defaultConfig: {},
  actions: [],
  owner: ${upper},
});

export { HeartbeatWidget };
`,
  );

  files.set(
    "client/src/Heartbeat/index.test.tsx",
    `import {
  render,
  screen,
  setupStreamFixture,
  stopArriving,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { act } from "react";
import { describe, expect, it } from "vitest";
import "../index.js";
import { HeartbeatWidget } from "./index.js";

/** The widget on a stream the test feeds by hand, pinned at the game time of the sample it sends. */
function mounted() {
  const stream = setupStreamFixture({ pinnedUt: 110 });
  const view = render(
    <stream.Provider>
      <HeartbeatWidget />
    </stream.Provider>,
  );
  return { stream, ...view };
}

/** The figures <Unit> has marked as held, which is how a stale number is told from a current one. */
const heldFigures = (container: HTMLElement) =>
  container.querySelectorAll("[data-held]").length;

describe("HeartbeatWidget", () => {
  it("says it is waiting before the first sample, rather than drawing a zero", () => {
    mounted();

    expect(screen.getByText(/waiting for the ${id} uplink/i)).toBeVisible();
  });

  it("draws a sample that has just arrived, with no mark on it", async () => {
    const { stream, container } = mounted();

    await act(async () => {
      stream.emit("${topic}", { ut: 110, ticks: 20 }, { validAt: 110 });
      stream.store.beginFrame();
    });

    expect(await screen.findByText(/Ticks/)).toHaveTextContent("20");
    expect(heldFigures(container)).toBe(0);
  });

  it("keeps the last count when samples stop arriving, and marks it as held", async () => {
    const { stream, container } = mounted();

    await act(async () => {
      stream.emit("${topic}", { ut: 110, ticks: 20 }, { validAt: 110 });
      stream.store.beginFrame();
      stopArriving(stream);
    });

    expect(await screen.findByText(/Ticks/)).toHaveTextContent("20");
    expect(screen.queryByText(/waiting/i)).toBeNull();
    // Both figures come from the same sample, so both are held.
    expect(heldFigures(container)).toBe(2);
  });

  it("says the Uplink reports no heartbeat when the game confirms there is none", async () => {
    const { stream } = mounted();

    await act(async () => {
      stream.emit("${topic}", null, { validAt: 110 });
      stream.store.beginFrame();
    });

    expect(await screen.findByText(/reports no heartbeat/i)).toBeVisible();
  });

  it("says the Uplink is not installed when nothing will ever publish the Topic", async () => {
    const { stream } = mounted();

    await act(async () => {
      stream.store.markTopicUnowned("${topic}");
    });

    expect(await screen.findByText(/is not installed/i)).toBeVisible();
    expect(screen.queryByText(/waiting/i)).toBeNull();
  });
});
`,
  );

  files.set(
    "client/src/Heartbeat/__fixtures__/beating.json",
    json({
      _meta: {
        notes:
          "A fixture is a scene the render harness mounts the widget in. Everything the widget reads has to be emitted in _stream, because the harness feeds it nothing by default.",
      },
      _scene: {
        widget: widgetId,
        hero: true,
        caption: `The ${o.name} Uplink publishing: 42 ticks since load, at UT 1,000,000`,
        modes: ["default", "min"],
      },
      _stream: {
        pinnedUt: 1000000,
        emits: [{ topic, payload: { ut: 1000000, ticks: 42 } }],
      },
    }),
  );

  files.set(
    "client/src/uplink-page.test.ts",
    `import { expectUplinkPageCurrent } from "@ksp-gonogo/uplink-tools/page-check";
import { describe, it } from "vitest";
import "./index.js";

describe("the generated Uplink page", () => {
  it("still describes what this Uplink registers", () => {
    expectUplinkPageCurrent();
  });
});
`,
  );

  files.set(
    `mod-contract/${ns}.Contract.csproj`,
    `<Project Sdk="Microsoft.NET.Sdk">
  <!-- This Uplink's own wire types. net48 ships into GameData beside the plugin and
       netstandard2.0 is what the net10.0 test project references. -->
  <PropertyGroup>
    <TargetFrameworks>netstandard2.0;net48</TargetFrameworks>
    <Nullable>enable</Nullable>
    <LangVersion>latest</LangVersion>
    <AssemblyName>${ns}.Contract</AssemblyName>
    <RootNamespace>${ns}</RootNamespace>
  </PropertyGroup>

  <!-- IncludeAssets="compile": GonogoCore provides Sitrep.Contract.dll at runtime, and two
       copies of one assembly identity are two sets of types that do not compare equal. -->
  <ItemGroup>
    ${contractPackage(' IncludeAssets="compile" PrivateAssets="all"')}
    ${referenceAssemblies}
  </ItemGroup>
</Project>
`,
  );

  files.set(
    `mod-contract/${Id}Payloads.cs`,
    `#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using Sitrep.Contract;

namespace ${ns};

/// <summary>
/// What <c>${topic}</c> carries: a count of the samples this Uplink has
/// published and the game time of the latest. Nothing is published until a save
/// is loaded.
/// <internal>
/// The wire is written from the dictionary ${Id}Uplink.Sample returns, and this
/// type is what the client's TypeScript is generated from, so the two are kept
/// in step by hand. Prose inside this element stays in the C# and never reaches
/// the generated types.
/// </internal>
/// </summary>
[SitrepContract]
[SitrepTopic("${topic}")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class ${Id}Heartbeat
{
    /// <summary>The game's universal time when the sample was taken. Never null in a published sample.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? Ut { get; set; }

    /// <summary>How many samples this Uplink has published since the game started, this one included. It starts again from 1 when the game restarts.</summary>
    [SitrepUnit(Units.Count)]
    public double? Ticks { get; set; }
}
`,
  );

  files.set(
    `mod-contract/${Id}RtConfig.cs`,
    `#if SITREP_CODEGEN
using System;
using Reinforced.Typings.Fluent;

namespace ${ns};

/// <summary>
/// This Uplink's codegen configuration. It lives behind <c>SITREP_CODEGEN</c> so
/// the Reinforced.Typings attributes exist only in the codegen twin, never in the
/// shipped assembly.
/// </summary>
public static class ${Id}RtConfig
{
    public static void Configure(ConfigurationBuilder builder)
    {
        // The last two carry the doc comments on the wire types into the generated TypeScript, without anything inside an <internal> element.
        builder.Global(g => g
            .CamelCaseForProperties()
            .UseModules(true)
            .AutoOptionalProperties()
            .GenerateDocumentation()
            .UseVisitor<Sitrep.Contract.RtDocVisitor>());

        var wireTypes = new[] { typeof(${Id}Heartbeat) };

        builder.ExportAsInterfaces(wireTypes, c => c.AutoI(false).WithPublicProperties());
        Sitrep.Contract.RtConfig.ApplyUnitValueTypes(
            builder, wireTypes, valueImportFrom: "@ksp-gonogo/sitrep-sdk");

        var topicMapOut = Environment.GetEnvironmentVariable("SITREP_${upper}_TOPICMAP_OUT");
        if (!string.IsNullOrEmpty(topicMapOut))
        {
            Sitrep.Contract.RtConfig.EmitTopicMap(topicMapOut!, typeof(${Id}RtConfig).Assembly);
        }

        // One row for every [SitrepCommand] in this slice, which is where the generated page and registerUplinkCommand's rail both read your commands from. It is empty until you declare one.
        var commandMapOut = Environment.GetEnvironmentVariable("SITREP_${upper}_COMMANDMAP_OUT");
        if (!string.IsNullOrEmpty(commandMapOut))
        {
            Sitrep.Contract.RtConfig.EmitCommandMap(
                commandMapOut!,
                typeof(${Id}RtConfig).Assembly,
                resultImportFrom: "@ksp-gonogo/sitrep-sdk");
        }

        var unitMapOut = Environment.GetEnvironmentVariable("SITREP_${upper}_UNITMAP_OUT");
        if (!string.IsNullOrEmpty(unitMapOut))
        {
            Sitrep.Contract.RtConfig.EmitUnitMap(
                unitMapOut!,
                Environment.GetEnvironmentVariable("SITREP_${upper}_UNITJSON_OUT"),
                typeof(${Id}RtConfig).Assembly);
        }
    }
}
#endif
`,
  );

  files.set(
    `mod-contract-codegen/${ns}.Contract.Codegen.csproj`,
    `<Project Sdk="Microsoft.NET.Sdk">
  <!-- Codegen-only twin of the contract slice: the same sources recompiled with
       SITREP_CODEGEN defined. Nothing references it and nothing ships it.

       It is built only by \`uplink-tools codegen\`, which passes GonogoCodegen: the
       folder of the KspGonogo.Sitrep.Contract package holding the contract's own
       twin and the props every twin takes its shape from. -->
  <PropertyGroup>
    <CodegenTwinSource>..\\mod-contract</CodegenTwinSource>
    <AssemblyName>${ns}.Contract</AssemblyName>
    <RootNamespace>${ns}</RootNamespace>
    <TargetFramework Condition="'$(GonogoCodegen)' == ''">netstandard2.0</TargetFramework>
  </PropertyGroup>
  <Import Project="$(GonogoCodegen)\\CodegenTwin.props" Condition="'$(GonogoCodegen)' != ''" />

  <ItemGroup Condition="'$(GonogoCodegen)' != ''">
    <Reference Include="Sitrep.Contract">
      <HintPath>$(GonogoCodegen)\\Sitrep.Contract.dll</HintPath>
    </Reference>
  </ItemGroup>

  <Target Name="RequireCodegenCommand" BeforeTargets="CoreCompile" Condition="'$(GonogoCodegen)' == ''">
    <Error Text="This project is the contract slice's codegen twin, and only one command builds it: npx uplink-tools codegen" />
  </Target>
</Project>
`,
  );

  files.set(
    `mod/${ns}.csproj`,
    `<Project Sdk="Microsoft.NET.Sdk">
  <!-- The plugin assembly, net48 to match what KSP loads. It reads only the shared
       KspSnapshot, so it has no KSP or Unity reference. An Uplink that needs a live
       API adds one here, with a HintPath under $(KspManaged) and Private="false". -->
  <PropertyGroup>
    <TargetFramework>net48</TargetFramework>
    <LangVersion>12</LangVersion>
    <Nullable>enable</Nullable>
    <AssemblyName>${ns}</AssemblyName>
    <RootNamespace>${ns}</RootNamespace>
    <AppendTargetFrameworkToOutputPath>false</AppendTargetFrameworkToOutputPath>
    <CopyLocalLockFileAssemblies>true</CopyLocalLockFileAssemblies>
  </PropertyGroup>

  <!-- IncludeAssets="compile": compiled against and never copied to the output,
       because GonogoCore provides Sitrep.Contract.dll at runtime. -->
  <ItemGroup>
    ${contractPackage(' IncludeAssets="compile" PrivateAssets="all"')}
    ${referenceAssemblies}
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\\mod-contract\\${ns}.Contract.csproj" />
  </ItemGroup>

  <!-- Provenance, ClientSource and ExpectedClientHash are generated and kept out
       of git, because one of them can name the machine that baked it. -->
  <Target Name="RequireBakedClientSource" BeforeTargets="CoreCompile">
    <Error
      Condition="!Exists('$(MSBuildProjectDirectory)\\Provenance.g.cs') Or !Exists('$(MSBuildProjectDirectory)\\ClientSource.g.cs') Or !Exists('$(MSBuildProjectDirectory)\\ExpectedClientHash.g.cs')"
      Text="mod/ is missing the files this plugin announces its client with. Write them with: npx uplink-tools bake" />
  </Target>
</Project>
`,
  );

  files.set(
    `mod/${ns}.netkan`,
    json({
      spec_version: 1,
      identifier: ns,
      name: `Gonogo ${o.name} Uplink`,
      abstract: `A Gonogo Uplink: publishes ${topic} and renders it.`,
      author: o.author,
      license: "MIT",
      release_status: "development",
      depends: [{ name: "GonogoCore" }],
      install: [{ file: `GameData/${ns}`, install_to: "GameData" }],
    }),
  );

  files.set(
    `mod/${Id}Uplink.cs`,
    `using System.Collections.Generic;
using Sitrep.Contract;

namespace ${ns}
{
    /// <summary>
    /// One channel, one publisher, no third-party mod and no live KSP API. It
    /// publishes <c>${topic}</c> off the shared <see cref="KspSnapshot"/>, so it
    /// registers with <c>AddChannelSource</c>. Reach for the capture-on-main
    /// <c>AddSampledSource</c> seam when you must read a live KSP or third-party API.
    /// </summary>
    [SitrepUplink("${id}")]
    public sealed class ${Id}Uplink : ISitrepUplink
    {
        /// <summary>The one Topic this Uplink publishes. Its payload is <see cref="${Id}Heartbeat"/>.</summary>
        public const string HeartbeatTopic = "${topic}";

        private double _ticks;

        /// <summary>
        /// What this Uplink tells the mod about itself: who it is, where its client
        /// lives, and every channel it will publish, each with how it is delivered
        /// and whether it is held back by signal delay.
        /// </summary>
        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "${id}",
            // Provenance, ClientSource and ExpectedClientHash are written by \`uplink-tools bake\`, and one version covers both halves of the Uplink.
            Version = Provenance.Version,
            Name = Provenance.Name,
            Author = Provenance.Author,
            Repo = Provenance.Repo,
            // The app loads a client only for a plugin that says where the bundle lives, and refuses one that vouches for no hash.
            ExpectedClientHash = string.IsNullOrEmpty(ExpectedClientHash.Value)
                ? null
                : ExpectedClientHash.Value,
            ClientSource = new UplinkClientSource
            {
                Url = ClientSource.Url,
                DevPath = string.IsNullOrEmpty(ClientSource.DevPath) ? null : ClientSource.DevPath,
            },
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = HeartbeatTopic,
                    Delivery = Delivery.LossyLatest,
                    // TrueNow: a heartbeat describes the connection, not a vessel.
                    // A fact about a vessel's state is DelayRole.Delayed.
                    Delay = DelayRole.TrueNow,
                    Emission = new EmissionPolicy(
                        keyframeIntervalUt: 30,
                        quantum: EmissionQuantum.Absolute(0)),
                },
            },
        };

        /// <summary>Called once at startup. Each channel the manifest declares gets its source here.</summary>
        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(HeartbeatTopic, Sample);
        }

        /// <summary>
        /// Mandatory. An Uplink wrapping a third-party mod reports "the assembly is
        /// not loaded" here as <c>UplinkHealthState.Unavailable</c> with a reason.
        /// </summary>
        public UplinkHealth Health() => UplinkHealth.Healthy;

        /// <summary>
        /// Runs on the Courier thread, so it may touch nothing KSP-facing. Returning
        /// null publishes nothing, which is right: a substituted zero is
        /// indistinguishable from a real reading downstream.
        /// </summary>
        internal object? Sample(KspSnapshot? snapshot)
        {
            var ut = ReadableUt(snapshot);
            if (ut == null)
            {
                return null;
            }
            _ticks += 1;
            return new Dictionary<string, object?>
            {
                ["ut"] = ut,
                ["ticks"] = _ticks,
            };
        }

        /// <summary>
        /// The tick's UT, or null when there is none worth publishing. Before a
        /// save has loaded the snapshot exists and its
        /// <see cref="KspSnapshot.Ut"/> is 0, which is not a game time anyone is
        /// playing at, so 0 is treated as no reading.
        /// </summary>
        private static double? ReadableUt(KspSnapshot? snapshot)
        {
            if (snapshot == null)
            {
                return null;
            }
            var ut = snapshot.Ut;
            if (ut == 0.0 || double.IsNaN(ut) || double.IsInfinity(ut))
            {
                return null;
            }
            return ut;
        }
    }
}
`,
  );

  files.set(
    `mod-tests/${ns}.Tests.csproj`,
    `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <LangVersion>12</LangVersion>
    <IsPackable>false</IsPackable>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.11.1" />
    <PackageReference Include="xunit" Version="2.9.2" />
    <PackageReference Include="xunit.runner.visualstudio" Version="2.8.2">
      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>
      <PrivateAssets>all</PrivateAssets>
    </PackageReference>
  </ItemGroup>

  <!-- The plugin targets net48 and this targets net10.0, so its sources are
       compiled in rather than referenced. -->
  <ItemGroup>
    <Compile Include="..\\mod\\*.cs" />
  </ItemGroup>

  <!-- For a test project the package also carries Sitrep.Contract.TestSupport
       (fakes and rule assertions) and the real delay engine behind it. -->
  <ItemGroup>
    ${contractPackage("")}
    <ProjectReference Include="..\\mod-contract\\${ns}.Contract.csproj" />
  </ItemGroup>

  <Target Name="RequireBakedClientSource" BeforeTargets="CoreCompile">
    <Error
      Condition="!Exists('$(MSBuildProjectDirectory)\\..\\mod\\Provenance.g.cs') Or !Exists('$(MSBuildProjectDirectory)\\..\\mod\\ClientSource.g.cs') Or !Exists('$(MSBuildProjectDirectory)\\..\\mod\\ExpectedClientHash.g.cs')"
      Text="mod/ is missing the files the plugin announces its client with. Write them with: npx uplink-tools bake" />
  </Target>
</Project>
`,
  );

  files.set(
    `mod-tests/${Id}UplinkTests.cs`,
    `using System.Collections.Generic;
using Sitrep.Contract;
using Xunit;

namespace ${ns}.Tests
{
    public class ${Id}UplinkTests
    {
        [Fact]
        public void DeclaresOneTrueNowChannel()
        {
            var manifest = new ${Id}Uplink().Manifest;

            Assert.Equal("${id}", manifest.Id);
            var channel = Assert.Single(manifest.Channels);
            Assert.Equal(${Id}Uplink.HeartbeatTopic, channel.Topic);
            Assert.Equal(DelayRole.TrueNow, channel.Delay);
        }

        [Fact]
        public void AnnouncesItsClientSoTheAppCanFindIt()
        {
            var manifest = new ${Id}Uplink().Manifest;

            Assert.NotNull(manifest.ClientSource);
            Assert.NotEqual("", manifest.ClientSource!.Url);
            Assert.NotEqual("", manifest.Version);
            // Null until \`uplink-tools bake --bundle\` has hashed a built bundle, and never a malformed value.
            Assert.True(
                manifest.ExpectedClientHash == null
                    || manifest.ExpectedClientHash.StartsWith("sha256-"));
        }

        [Fact]
        public void PublishesNothingWithoutAReadableUt()
        {
            Assert.Null(new ${Id}Uplink().Sample(null));
            Assert.Null(new ${Id}Uplink().Sample(new KspSnapshot { Ut = 0.0 }));
            Assert.Null(new ${Id}Uplink().Sample(new KspSnapshot { Ut = double.NaN }));
        }

        [Fact]
        public void CarriesTheSnapshotUtAndACountThatAdvances()
        {
            var uplink = new ${Id}Uplink();

            var first = Assert.IsType<Dictionary<string, object?>>(
                uplink.Sample(new KspSnapshot { Ut = 1234.5 }));
            Assert.Equal(1234.5, first["ut"]);
            Assert.Equal(1.0, first["ticks"]);

            var second = Assert.IsType<Dictionary<string, object?>>(
                uplink.Sample(new KspSnapshot { Ut = 1235.5 }));
            Assert.Equal(2.0, second["ticks"]);
        }
    }
}
`,
  );

  if (o.topics === "core") applyCoreTopics(files, o);
  return files;
}

/**
 * Turns the seed into an Uplink with no Topics of its own: no contract slice,
 * no generated types, a plugin that publishes nothing and exists to announce
 * the client, and a widget that reads a Topic Gonogo already publishes.
 *
 * It starts from the full seed and takes away, so the two shapes cannot drift
 * in the files they share.
 */
function applyCoreTopics(files: Map<string, string>, o: SeedOptions): void {
  const id = o.id;
  const Id = pascal(id);
  const ns = `Gonogo${Id}Uplink`;
  const upper = id.toUpperCase();
  const widgetId = `${id}-vessel`;
  const json = (value: unknown): string =>
    `${JSON.stringify(value, null, 2)}\n`;
  const edit = (path: string, change: (text: string) => string) => {
    const before = files.get(path);
    if (before === undefined) throw new Error(`the seed has no ${path}`);
    const after = change(before);
    if (after === before) {
      throw new Error(
        `the core-Topics seed found nothing to change in ${path}`,
      );
    }
    files.set(path, after);
  };

  for (const path of [...files.keys()]) {
    if (
      path.startsWith("mod-contract/") ||
      path.startsWith("mod-contract-codegen/") ||
      path.startsWith("client/src/Heartbeat/") ||
      path === "client/src/topics.ts"
    ) {
      files.delete(path);
    }
  }

  edit("uplink.json", (text) => {
    const declared: Record<string, unknown> = JSON.parse(text);
    const { codegen: _codegen, ...rest } = declared;
    return json(rest);
  });
  edit("client/package.json", (text) => {
    const manifest: { scripts: Record<string, string> } = JSON.parse(text);
    const {
      codegen: _codegen,
      "codegen:check": _check,
      ...scripts
    } = manifest.scripts;
    return json({ ...manifest, scripts });
  });
  edit("client/src/uplink.ts", (text) =>
    text.replace(
      /description: "[^"]*",/,
      `description: "Shows the name of the vessel being flown, from a Topic Gonogo already publishes.",`,
    ),
  );
  files.set(
    "client/src/index.ts",
    `import "./Vessel/index.js";

export { ${upper} } from "./uplink.js";
export { VesselWidget } from "./Vessel/index.js";
`,
  );
  files.set(
    "client/src/Vessel/index.tsx",
    `import { registerComponent, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import {
  EmptyState,
  HeldBadge,
  Panel,
  Section,
  Text,
} from "@ksp-gonogo/ui-kit";
import { ${upper} } from "../uplink.js";

/** Why there is no name to draw. Each is a different thing for an operator to do something about, so each has its own words. */
const NO_VALUE = {
  pending: "Waiting for a vessel",
  absent: "No vessel is being flown",
  unowned: "Nothing installed reports the vessel",
};

/**
 * The name of the vessel being flown, read from \`vessel.identity\`, a Topic
 * Gonogo publishes itself. With no vessel it says why there is none, since an
 * empty name would read as a vessel with none. When the game stops reporting
 * it keeps the last name and marks it as held, since a stale name that looks
 * current is worse than no name.
 */
function VesselWidget() {
  const identity = useTelemetry("vessel.identity");

  if (identity.state !== "observed" && identity.state !== "held") {
    return (
      <Panel
        panelTitle="Vessel"
        sections={
          <Section>
            <EmptyState>{NO_VALUE[identity.state]}</EmptyState>
          </Section>
        }
      />
    );
  }

  // A number is marked as held by <Unit>. Text has no figure to hang a mark on, so a held name carries the badge that says why it stopped updating.
  return (
    <Panel
      panelTitle="Vessel"
      sections={
        <Section>
          <Text>
            {identity.value.name}
            {identity.state === "held" && (
              <>
                {" "}
                <HeldBadge
                  grade={identity.grade}
                  subject="Vessel name"
                  size="sm"
                />
              </>
            )}
          </Text>
        </Section>
      }
    />
  );
}

registerComponent({
  id: "${widgetId}",
  name: "Vessel",
  // Shown in the widget picker and on the generated page: what it shows and what an operator can do with it, in plain words.
  description: "The name of the vessel being flown. It has no controls.",
  tags: ["${id}"],
  // In grid units. The smallest size is the smallest at which the title and the name can still be read, which \`uplink-tools docs\` checks in a real browser.
  defaultSize: { w: 5, h: 3 },
  minSize: { w: 4, h: 3 },
  component: VesselWidget,
  // The Topics it needs. When whatever serves one is unavailable, the dashboard says why in the widget's place.
  channels: ["vessel.identity"],
  defaultConfig: {},
  actions: [],
  owner: ${upper},
});

export { VesselWidget };
`,
  );
  files.set(
    "client/src/Vessel/index.test.tsx",
    `import {
  render,
  screen,
  setupStreamFixture,
  stopArriving,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { VesselWidget } from "./index.js";

const KERBAL_X = {
  vesselId: "v1",
  name: "Kerbal X",
  vesselType: 0,
  situation: 1,
  parentBodyIndex: 1,
  launchUt: null,
};

/** The widget on a stream the test feeds by hand, pinned at the game time of the sample it sends. */
function mounted() {
  const stream = setupStreamFixture({ pinnedUt: 110 });
  render(
    <stream.Provider>
      <VesselWidget />
    </stream.Provider>,
  );
  return stream;
}

describe("VesselWidget", () => {
  it("says it is waiting before the game reports a vessel, rather than drawing an empty name", () => {
    mounted();

    expect(screen.getByText(/waiting for a vessel/i)).toBeVisible();
  });

  it("draws the name that has just arrived, with no badge on it", async () => {
    const stream = mounted();

    await act(async () => {
      stream.emit("vessel.identity", KERBAL_X, { validAt: 110 });
      stream.store.beginFrame();
    });

    expect(await screen.findByText(/Kerbal X/)).toBeVisible();
    expect(screen.queryByText(/offline|held/i)).toBeNull();
  });

  it("keeps the last name when the game stops reporting, and marks it as held", async () => {
    const stream = mounted();

    await act(async () => {
      stream.emit("vessel.identity", KERBAL_X, { validAt: 110 });
      stream.store.beginFrame();
      stopArriving(stream);
    });

    expect(await screen.findByText(/Kerbal X/)).toBeVisible();
    expect(screen.queryByText(/waiting/i)).toBeNull();
    // The fixture dropped the link, so the badge gives that as the reason.
    expect(screen.getByText(/offline/i)).toBeVisible();
  });

  it("says no vessel is being flown when the game confirms there is none", async () => {
    const stream = mounted();

    await act(async () => {
      stream.emit("vessel.identity", null, { validAt: 110 });
      stream.store.beginFrame();
    });

    expect(await screen.findByText(/no vessel is being flown/i)).toBeVisible();
  });

  it("says nothing reports the vessel when nothing will ever publish the Topic", async () => {
    const stream = mounted();

    await act(async () => {
      stream.store.markTopicUnowned("vessel.identity");
    });

    expect(
      await screen.findByText(/nothing installed reports the vessel/i),
    ).toBeVisible();
  });
});
`,
  );
  files.set(
    "client/src/Vessel/__fixtures__/named.json",
    json({
      _meta: {
        notes:
          "A fixture is a scene the render harness mounts the widget in. Everything the widget reads has to be emitted in _stream, because the harness feeds it nothing by default.",
      },
      _scene: {
        widget: widgetId,
        hero: true,
        caption: "A vessel named Kerbal X on the pad",
        modes: ["default", "min"],
      },
      _stream: {
        pinnedUt: 1000000,
        emits: [
          {
            topic: "vessel.identity",
            payload: {
              vesselId: "v1",
              name: "Kerbal X",
              vesselType: 0,
              situation: 1,
              parentBodyIndex: 1,
              launchUt: null,
            },
          },
        ],
      },
    }),
  );

  const sliceReference = `  <ItemGroup>
    <ProjectReference Include="..\\mod-contract\\${ns}.Contract.csproj" />
  </ItemGroup>

`;
  edit(`mod/${ns}.csproj`, (text) => text.replace(sliceReference, ""));
  edit(`mod-tests/${ns}.Tests.csproj`, (text) =>
    text.replace(
      `    <ProjectReference Include="..\\mod-contract\\${ns}.Contract.csproj" />\n`,
      "",
    ),
  );
  edit(`mod/${ns}.netkan`, (text) =>
    text.replace(
      /"abstract": "[^"]*"/,
      `"abstract": "A Gonogo Uplink: adds a widget to the dashboard."`,
    ),
  );
  files.set(
    `mod/${Id}Uplink.cs`,
    `using Sitrep.Contract;

namespace ${ns}
{
    /// <summary>
    /// Publishes nothing of its own. It is here so the mod can tell the app that
    /// this Uplink is installed and where its client lives: the app loads a
    /// client only for an Uplink a plugin announces. Its widgets read Topics
    /// Gonogo already publishes. To publish one of your own, declare it in
    /// <c>Channels</c> and give it a source in <see cref="Register"/>.
    /// </summary>
    [SitrepUplink("${id}")]
    public sealed class ${Id}Uplink : ISitrepUplink
    {
        /// <summary>
        /// What this Uplink tells the mod about itself: who it is and where its
        /// client lives. It declares no channels.
        /// </summary>
        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "${id}",
            // Provenance, ClientSource and ExpectedClientHash are written by \`uplink-tools bake\`, and one version covers both halves of the Uplink.
            Version = Provenance.Version,
            Name = Provenance.Name,
            Author = Provenance.Author,
            Repo = Provenance.Repo,
            // The app loads a client only for a plugin that says where the bundle lives, and refuses one that vouches for no hash.
            ExpectedClientHash = string.IsNullOrEmpty(ExpectedClientHash.Value)
                ? null
                : ExpectedClientHash.Value,
            ClientSource = new UplinkClientSource
            {
                Url = ClientSource.Url,
                DevPath = string.IsNullOrEmpty(ClientSource.DevPath) ? null : ClientSource.DevPath,
            },
        };

        /// <summary>Called once at startup. There is nothing to register until this Uplink declares a channel or a command.</summary>
        public void Register(IUplinkHost host)
        {
        }

        /// <summary>
        /// Mandatory. An Uplink wrapping a third-party mod reports "the assembly is
        /// not loaded" here as <c>UplinkHealthState.Unavailable</c> with a reason.
        /// </summary>
        public UplinkHealth Health() => UplinkHealth.Healthy;
    }
}
`,
  );
  files.set(
    `mod-tests/${Id}UplinkTests.cs`,
    `using Sitrep.Contract;
using Xunit;

namespace ${ns}.Tests
{
    public class ${Id}UplinkTests
    {
        [Fact]
        public void DeclaresNoChannelOfItsOwn()
        {
            var manifest = new ${Id}Uplink().Manifest;

            Assert.Equal("${id}", manifest.Id);
            Assert.Empty(manifest.Channels);
        }

        [Fact]
        public void AnnouncesItsClientSoTheAppCanFindIt()
        {
            var manifest = new ${Id}Uplink().Manifest;

            Assert.NotNull(manifest.ClientSource);
            Assert.NotEqual("", manifest.ClientSource!.Url);
            Assert.NotEqual("", manifest.Version);
            // Null until \`uplink-tools bake --bundle\` has hashed a built bundle, and never a malformed value.
            Assert.True(
                manifest.ExpectedClientHash == null
                    || manifest.ExpectedClientHash.StartsWith("sha256-"));
        }

        [Fact]
        public void ReportsItselfHealthy()
        {
            Assert.Equal(UplinkHealthState.Healthy, new ${Id}Uplink().Health().State);
        }
    }
}
`,
  );
}

/**
 * This package's own version, read from its manifest rather than baked in at
 * build: the published manifest carries the version a release or RC was stamped
 * with, and every published package carries that same one. Found by walking up,
 * since the source and the bundled `dist` sit at different depths.
 */
function ownVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const path = join(dir, "package.json");
    if (existsSync(path)) {
      const manifest = asRecord(JSON.parse(readFileSync(path, "utf8")));
      if (manifest.name === "@ksp-gonogo/uplink-tools") {
        if (typeof manifest.version !== "string") {
          throw new Error(`${path} carries no version`);
        }
        return manifest.version;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("cannot find @ksp-gonogo/uplink-tools' own package.json");
    }
    dir = parent;
  }
}

/** Every published package moves in lockstep, so a fresh Uplink pins each sibling to exactly the version of the tools that wrote it. */
const fallbackDependencies = (version: string) => ({
  "@ksp-gonogo/ui-kit": version,
  "styled-components": "^6.0.0",
});

const fallbackDevDependencies = (version: string) => ({
  "@ksp-gonogo/sitrep-sdk": version,
  "@ksp-gonogo/uplink-tools": version,
  "@testing-library/jest-dom": "^6.9.1",
  "@testing-library/react": "^16.3.2",
  "@types/react": "^18.3.28",
  esbuild: "^0.28.0",
  "jest-axe": "^10.0.0",
  jsdom: "^29.0.2",
  playwright: "^1.60.0",
  react: "^18.0.0",
  "react-dom": "^18.0.0",
  typescript: "^5.0.0",
  vitest: "^4.1.4",
});

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

const asStrings = (value: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(asRecord(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

/**
 * What a sibling Uplink in the same repo already pins, or `undefined` when there
 * is none. A repo that vendors its packages by `file:` tarball pins them
 * identically for every client, and a new one has to pin the same bytes: a
 * floating range would move it independently of the rest. The contract package
 * is read the same way, from the sibling's plugin project.
 */
function siblingPins(uplinksDir: string | undefined) {
  if (uplinksDir === undefined || !existsSync(uplinksDir)) return undefined;
  for (const sibling of readdirSync(uplinksDir).sort()) {
    const pkg = join(uplinksDir, sibling, "client", "package.json");
    const decl = join(uplinksDir, sibling, "uplink.json");
    if (!existsSync(pkg) || !existsSync(decl)) continue;
    const parsed = asRecord(JSON.parse(readFileSync(pkg, "utf8")));
    const declared = asRecord(JSON.parse(readFileSync(decl, "utf8")));
    const project = join(
      uplinksDir,
      sibling,
      "mod",
      `${String(declared.gamedata ?? "")}.csproj`,
    );
    const contractVersion = existsSync(project)
      ? /Include="KspGonogo\.Sitrep\.Contract"\s+Version="\[?([^"\]]+)\]?"/.exec(
          readFileSync(project, "utf8"),
        )?.[1]
      : undefined;
    return {
      id: String(declared.id ?? sibling),
      dependencies: asStrings(parsed.dependencies),
      devDependencies: asStrings(parsed.devDependencies),
      repo: String(declared.repo ?? ""),
      author: String(declared.author ?? ""),
      clientUrl: String(asRecord(declared.client).url ?? ""),
      contractVersion,
    };
  }
  return undefined;
}

export const NEW_USAGE = `uplink-tools new [<id>] [options]

  Scaffold a fresh Uplink and leave it building: the hand-written seed (plugin,
  tests, a minimal widget and its fixture, and a contract slice when it has
  Topics of its own), then its generators. After writing the files it bakes
  what the plugin announces, generates the client's types (needs the .NET SDK),
  installs the client's dependencies and writes the generated page.

  It asks what it was not told. Every question is one of these flags, so with
  all of them given, or with --yes, it asks nothing. With no terminal it never
  asks: it stops and names each flag that is missing.

${questionHelp()}

  --yes                  take the default for every question not answered above
  --dir <dir>            put it in <dir>/<id>, beside any Uplinks already there
  --no-generate          do not generate the client's types
  --no-install           do not install the client's dependencies, which also
                         leaves the generated page unwritten

  Where it goes:
    in a repo with an uplinks/ folder   uplinks/<id>/, pinned like its siblings
    anywhere else                       the current directory, which becomes
                                        the Uplink's own repo`;

/**
 * The folder of sibling Uplinks the seed joins, or `undefined` when the current
 * directory is to become the Uplink's own repo.
 *
 * A repo holding several Uplinks keeps them under `uplinks/`, and a new one
 * there inherits its siblings' pins. An author with one Uplink has no such
 * folder, and the repo itself is the Uplink: `uplink.json` at its root.
 */
function siblingsFolder(
  cwd: string,
  dirFlag: string | undefined,
): string | undefined {
  if (dirFlag !== undefined || existsSync(resolve(cwd, "uplinks"))) {
    return resolve(cwd, dirFlag ?? "uplinks");
  }
  return undefined;
}

/** What a repo that IS one Uplink keeps out of git: installs, builds, local renders, the .NET output, what bake writes and where this machine's KSP is. */
const SINGLE_REPO_GITIGNORE = `node_modules/
dist/
renders/
bin/
obj/
*.g.cs
ksp.local.props
`;

/**
 * Where the game is, for a plugin that references its assemblies.
 *
 * The scaffold's plugin references none, so nothing here is read until an
 * author adds one. The game's assemblies are theirs: these files name a
 * location and never copy from it.
 */
const SINGLE_REPO_BUILD_PROPS = `<Project>
  <!-- Where your KSP install is, for a plugin that references the game's own
       assemblies (Assembly-CSharp, UnityEngine and the rest). The scaffold's
       heartbeat references none, so none of this is read until you add one:

         <Reference Include="Assembly-CSharp" Private="false">
           <HintPath>$(KspManaged)/Assembly-CSharp.dll</HintPath>
         </Reference>

       KspRoot is the folder that holds KSP_Data (or KSP.app on macOS) and
       GameData. It comes from, in order: -p:KspRoot=... on the command line,
       the KSP_ROOT environment variable, then ksp.local.props beside this file,
       which is yours and kept out of git:

         <Project><PropertyGroup><KspRoot>/path/to/KSP</KspRoot></PropertyGroup></Project>
  -->
  <PropertyGroup>
    <KspRoot Condition="'$(KspRoot)' == ''">$(KSP_ROOT)</KspRoot>
  </PropertyGroup>
  <Import Project="$(MSBuildThisFileDirectory)ksp.local.props"
          Condition="'$(KspRoot)' == '' And Exists('$(MSBuildThisFileDirectory)ksp.local.props')" />
  <PropertyGroup>
    <KspRoot Condition="'$(KspRoot)' == ''">KSP_ROOT-is-not-set</KspRoot>
    <KspManaged Condition="'$(KspManaged)' == '' And Exists('$(KspRoot)/KSP.app/Contents/Resources/Data/Managed')">$(KspRoot)/KSP.app/Contents/Resources/Data/Managed</KspManaged>
    <KspManaged Condition="'$(KspManaged)' == ''">$(KspRoot)/KSP_Data/Managed</KspManaged>
    <KspGameData Condition="'$(KspGameData)' == ''">$(KspRoot)/GameData</KspGameData>
  </PropertyGroup>
</Project>
`;

const SINGLE_REPO_BUILD_TARGETS = `<Project>
  <!-- Says what is wrong when a project references the game and the game was not
       found, instead of leaving it to a page of "type or namespace not found".
       A project with no reference under $(KspManaged) or $(KspGameData) is never
       asked where KSP is. -->
  <Target Name="RequireKspInstall" BeforeTargets="ResolveAssemblyReferences">
    <ItemGroup>
      <_KspReference Include="@(Reference)"
                     Condition="'%(Reference.HintPath)' != '' And ($([System.String]::Copy('%(Reference.HintPath)').StartsWith('$(KspManaged)')) Or $([System.String]::Copy('%(Reference.HintPath)').StartsWith('$(KspGameData)')))" />
      <_MissingKspReference Include="@(_KspReference)" Condition="!Exists('%(_KspReference.HintPath)')" />
    </ItemGroup>
    <Error Condition="'@(_MissingKspReference)' != '' And '$(KspRoot)' == 'KSP_ROOT-is-not-set'"
           Text="This project references the game's assemblies (@(_MissingKspReference)) and does not know where KSP is. Set the KSP_ROOT environment variable to your KSP install, the folder holding KSP_Data and GameData, or pass -p:KspRoot=&lt;that folder&gt;. Directory.Build.props has the detail." />
    <Error Condition="'@(_MissingKspReference)' != '' And '$(KspRoot)' != 'KSP_ROOT-is-not-set'"
           Text="KspRoot is $(KspRoot), and these referenced assemblies are not under it: @(_MissingKspReference->'%(HintPath)'). KspRoot must be the folder holding KSP_Data (or KSP.app) and GameData." />
  </Target>
</Project>
`;

/**
 * The CI a lone Uplink's repo runs on every push: the same commands its author
 * runs, and nothing of ours beyond them.
 */
function ciWorkflow(topics: Answers["topics"]): string {
  return `name: ci

# Checks both halves of this Uplink on every push, with the commands you run
# yourself. A plugin that references the game's own assemblies cannot build
# here: they are not yours or ours to put in a repository, so a public runner
# has none. One that reaches its mod by reflection, as the scaffold does, can.
on:
  push:
  pull_request:

jobs:
  uplink:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v6
        with:
          node-version: "24"
      - uses: actions/setup-dotnet@v5
        with:
          dotnet-version: "10.0.x"

      - name: Install the client
        working-directory: client
        run: npm install
${
  topics === "own"
    ? `
      - name: The generated client types are current
        working-directory: client
        run: npm run codegen:check
`
    : ""
}
      - name: Typecheck the client
        working-directory: client
        run: npm run typecheck

      - name: Test the client
        working-directory: client
        run: npm test

      - name: Test the plugin
        run: dotnet test mod-tests

      # Bundles the client, bakes its hash into the plugin, compiles and zips.
      # It refuses a client URL that is still the scaffold's placeholder.
      - name: Build both halves for release
        working-directory: client
        run: npm run release

      - uses: actions/upload-artifact@v4
        with:
          name: uplink
          path: |
            client/dist
            dist
`;
}

/** Runs one of the scaffold's follow-on steps, and reports a failure as something left to do rather than as a crash. */
function attempt(
  label: string,
  command: string,
  run: () => void,
): string | undefined {
  console.log(`\n== ${label}`);
  try {
    run();
    return undefined;
  } catch (err) {
    const reason = (err instanceof Error ? err.message : String(err)).trim();
    console.error(`\n${label} did not finish: ${reason}`);
    return `${label} did not finish. Once that is put right: ${command}`;
  }
}

function shell(command: string, args: readonly string[], cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    // npm and npx are batch files on Windows, which only a shell can start.
    shell: process.platform === "win32",
  });
  if (result.error) {
    throw new Error(
      Reflect.get(result.error, "code") === "ENOENT"
        ? `${command} is not on PATH`
        : result.error.message,
    );
  }
  if (result.status !== 0) {
    throw new Error(`\`${command} ${args.join(" ")}\` exited ${result.status}`);
  }
}

/** `@clack/prompts`, loaded only once a question is really going to be asked on a terminal. */
async function loadPrompter(): Promise<Prompter> {
  const clack = await import("@clack/prompts");
  return {
    text: (options) => clack.text(options),
    select: (options) => clack.select<string>(options),
    confirm: (options) => clack.confirm(options),
    isCancel: (value): value is symbol => clack.isCancel(value),
  };
}

export interface NewUplinkRuntime {
  /** Whether there is a terminal to ask on. Defaults to whether stdin is one. */
  interactive?: boolean;
  /** Supplies the prompts. Defaults to `@clack/prompts`, loaded on first use. */
  loadPrompter?: () => Promise<Prompter>;
}

/**
 * Runs `new`. Returns 0 when the directory it leaves builds, 1 when the files
 * were written and a later step did not finish, and 2 when a question went
 * unanswered with nobody to ask, having written nothing.
 */
export async function newUplink(
  argv: readonly string[],
  cwd: string = process.cwd(),
  runtime: NewUplinkRuntime = {},
): Promise<number> {
  const flags = parseFlags(argv, {
    verb: "new",
    usage: NEW_USAGE,
    values: ["--dir", ...QUESTION_VALUES],
    switches: ["--no-generate", "--no-install", "--yes", ...QUESTION_SWITCHES],
    positionals: 1,
  });
  const { values, switches } = flags;

  const uplinksDir = siblingsFolder(cwd, values.get("--dir"));
  const sibling = siblingPins(uplinksDir);

  let answers: Answers;
  try {
    answers = await resolveAnswers({
      flags,
      cwd,
      yes: switches.has("--yes"),
      interactive: runtime.interactive ?? process.stdin.isTTY === true,
      inherited: sibling && { author: sibling.author, repo: sibling.repo },
      loadPrompter: runtime.loadPrompter ?? loadPrompter,
    });
  } catch (err) {
    if (err instanceof MissingAnswers) {
      console.error(err.message);
      return 2;
    }
    throw err;
  }
  const { id } = answers;

  const target = uplinksDir ? join(uplinksDir, id) : resolve(cwd);
  if (uplinksDir !== undefined && existsSync(target)) {
    throw new Error(
      `${target} already exists. new never overwrites: remove it or pick another id.`,
    );
  }

  const named = answers.repo;
  const owner = named?.owner ?? PLACEHOLDER_OWNER;
  const repoName = named?.name ?? (uplinksDir ? "your-uplinks" : id);
  // A repo of several Uplinks publishes each under its own folder of the releases branch.
  const releasesPath = uplinksDir ? "uplinks/releases" : "releases";
  const derivedUrl = `https://cdn.jsdelivr.net/gh/${owner}/${repoName}@releases/${releasesPath}/${id}/0.0.1/${id}.client.js`;
  // A sibling's URL with this Uplink's id in its place: the same repository and layout, which is where this one will be published too.
  const inheritedUrl = sibling?.clientUrl
    ? sibling.clientUrl.split(sibling.id).join(id)
    : undefined;
  const files = renderSeed({
    id,
    name: answers.name,
    author: answers.author,
    repo: named
      ? `https://github.com/${owner}/${repoName}`
      : sibling?.repo || `https://github.com/${owner}/${repoName}`,
    clientUrl: named ? derivedUrl : (inheritedUrl ?? derivedUrl),
    contractVersion: sibling?.contractVersion ?? ownVersion(),
    topics: answers.topics,
    dependencies: sibling?.dependencies ?? fallbackDependencies(ownVersion()),
    devDependencies:
      sibling?.devDependencies ?? fallbackDevDependencies(ownVersion()),
  });
  // What belongs to a repository, which a folder of sibling Uplinks already has of its own.
  const repoOnly: string[] = [];
  if (!uplinksDir) {
    files.set(".gitignore", SINGLE_REPO_GITIGNORE);
    files.set("Directory.Build.props", SINGLE_REPO_BUILD_PROPS);
    files.set("Directory.Build.targets", SINGLE_REPO_BUILD_TARGETS);
    if (answers.workflows) {
      files.set(".github/workflows/ci.yml", ciWorkflow(answers.topics));
    }
    if (answers.ksp !== null) {
      files.set(
        "ksp.local.props",
        `<Project>
  <!-- Where KSP is on this machine. Kept out of git: Directory.Build.props reads it. -->
  <PropertyGroup>
    <KspRoot>${answers.ksp.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</KspRoot>
  </PropertyGroup>
</Project>
`,
      );
    }
  } else {
    if (answers.workflows) repoOnly.push("a workflow (--workflows)");
    if (answers.ksp !== null) repoOnly.push("a KSP location (--ksp)");
  }

  const clashes = [...files.keys()].filter((path) =>
    existsSync(join(target, path)),
  );
  if (clashes.length > 0) {
    throw new Error(
      `new never overwrites, and ${target} already holds ${clashes.join(", ")}. ` +
        "Run it in an empty directory, or pass --dir to put the Uplink in a folder of its own.",
    );
  }

  for (const [path, content] of files) {
    const out = join(target, path);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, content);
  }
  console.log(`${id}: wrote ${files.size} files to ${target}`);
  if (repoOnly.length > 0) {
    console.log(
      `  not written: ${repoOnly.join(" and ")}. Those belong to a repository, and this Uplink joined one that has its own.`,
    );
  }
  console.log(describeBake(bakeUplink({ uplinkDir: target })));

  const clientDir = join(target, "client");
  const client = relative(cwd, clientDir) || ".";
  const inClient = (command: string) => `cd ${client} && ${command}`;
  const pageCommand = inClient("npm run page");
  const ownTopics = answers.topics === "own";
  const unfinished: string[] = [];
  const note = (failure: string | undefined) => {
    if (failure !== undefined) unfinished.push(failure);
    return failure === undefined;
  };

  // An Uplink with no Topics of its own has no types to generate, so that step is neither run nor owed.
  const generated =
    !ownTopics ||
    (!switches.has("--no-generate") &&
      note(
        attempt(
          "generate the client's types",
          inClient("npx uplink-tools codegen"),
          () => {
            generate({ uplinkDir: target });
          },
        ),
      ));
  const installed = switches.has("--no-install")
    ? false
    : note(
        attempt(
          "install the client's dependencies",
          inClient("npm install"),
          () => shell("npm", ["install"], clientDir),
        ),
      );
  // Written by `uplink-tools page`, which needs no browser and is allowed under CI, where a first write is as legitimate as anywhere. It needs the install and reads the generated types.
  const paged =
    generated &&
    installed &&
    note(
      attempt("write the generated page", pageCommand, () =>
        shell("npm", ["run", "page"], clientDir),
      ),
    );

  const skipped = [
    ...(ownTopics && switches.has("--no-generate")
      ? [`generate the client's types: ${inClient("npx uplink-tools codegen")}`]
      : []),
    ...(switches.has("--no-install")
      ? [`install the client's dependencies: ${inClient("npm install")}`]
      : []),
    ...(!paged && unfinished.length === 0
      ? [`write the generated page, then commit it: ${pageCommand}`]
      : []),
  ];
  const yours = [
    "say what it is for in the description in client/src/uplink.ts, which opens the generated page",
    ...(named || inheritedUrl
      ? []
      : [
          'set "repo" and "client.url" in uplink.json to where it will be published (or scaffold with --repo <owner>/<name>): release refuses the placeholder',
        ]),
    `prove both halves: ${inClient("npm test")}, and dotnet test ${relative(cwd, join(target, "mod-tests")) || "."}`,
    `when it is ready to install in a game: ${inClient("npm run release")}, which bundles, bakes, compiles and zips in the order that makes the app load the client`,
  ];
  const section = (title: string, lines: readonly string[]) =>
    lines.length === 0
      ? ""
      : `\n${title}\n${lines.map((line) => `  - ${line}`).join("\n")}\n`;
  console.log(
    section("Did not finish:", unfinished) +
      section("Skipped, as asked:", skipped) +
      section("Next:", yours),
  );
  return unfinished.length === 0 ? 0 : 1;
}
