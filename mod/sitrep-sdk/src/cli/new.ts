/**
 * `gonogo-uplink new <id>`: the hand-written seed of a fresh Uplink.
 *
 * It emits only what an author writes. Everything a generator owns is left to
 * that generator, so the scaffold cannot drift from the toolchain: the contract,
 * topic map and unit map come from the codegen twin, the page from `docs`, and
 * the client source and hash `.g.cs` files from the release bake. The one
 * generator the scaffold runs itself, when the repo carries it, is
 * `tooling/codegen-uplink.mjs`.
 *
 * The widget is deliberately minimal. Copying a finished Uplink hands an author
 * someone else's demo to delete; an empty one that builds is a better start.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface SeedOptions {
  id: string;
  name: string;
  author: string;
  repo: string;
  clientUrl: string;
  dependencies: Readonly<Record<string, string>>;
  devDependencies: Readonly<Record<string, string>>;
}

const ID_PATTERN = /^[a-z][a-z0-9]{1,29}$/;

export function validateUplinkId(id: string): string | undefined {
  if (ID_PATTERN.test(id)) return undefined;
  return (
    `"${id}" is not a usable Uplink id. It names a Topic prefix, a C# namespace and a ` +
    "GameData folder, so it is lowercase letters and digits only, starts with a letter " +
    "and is 2 to 30 characters long."
  );
}

const pascal = (id: string): string => id[0].toUpperCase() + id.slice(1);

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
        build: "tsc -p tsconfig.json",
        test: "vitest run",
        typecheck:
          "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.nodenext.json",
        render: "gonogo-uplink render",
        docs: "gonogo-uplink docs",
        "docs:check": "gonogo-uplink docs --check",
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
    "client/uplink.md",
    `${o.name} is a new Uplink. Replace this with what it is for, which mod it
integrates and what someone has to install first.

Everything else on the generated page is derived from your registrations, your
contract slice and your fixtures. Run \`npm run docs\` and commit what it writes.

## widget:${widgetId}

Publishes a tick count and the universal time of the last sample.
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

export const ${upper} = defineUplinkClient({
  id: "${id}",
  version: UPLINK_VERSION,
  name: ${JSON.stringify(o.name)},
  description: "A new Uplink: one channel and one widget.",
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

declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    "${topic}": ${Id}Heartbeat;
  }
}

for (const [topic, units] of Object.entries(GENERATED_TOPIC_UNITS)) {
  registerTopicUnits(topic, units, GENERATED_TOPIC_SHAPES[topic] ?? {});
}
for (const [typeName, units] of Object.entries(GENERATED_TYPE_UNITS)) {
  registerTypeUnits(typeName, units, GENERATED_TYPE_SHAPES[typeName] ?? {});
}

export type { ${Id}Heartbeat };
`,
  );

  files.set(
    "client/src/Heartbeat/index.tsx",
    `import { registerComponent, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import { EmptyState, Panel, Section, Text, Unit } from "@ksp-gonogo/ui-kit";
import { ${upper} } from "../uplink.js";

function HeartbeatWidget() {
  const heartbeat = useTelemetry("${topic}");

  if (heartbeat.state !== "observed") {
    return (
      <Panel
        panelTitle="Heartbeat"
        sections={
          <Section>
            <EmptyState>Waiting for the ${id} Uplink</EmptyState>
          </Section>
        }
      />
    );
  }

  return (
    <Panel
      panelTitle="Heartbeat"
      sections={
        <Section>
          <Text>
            Ticks <Unit value={heartbeat.value.ticks} />
          </Text>
          <Text>
            UT <Unit value={heartbeat.value.ut} />
          </Text>
        </Section>
      }
    />
  );
}

registerComponent({
  id: "${widgetId}",
  name: "Heartbeat",
  description: "How many times the ${o.name} Uplink has published, and the universal time of the last sample.",
  tags: ["${id}"],
  defaultSize: { w: 3, h: 3 },
  minSize: { w: 2, h: 2 },
  component: HeartbeatWidget,
  dataRequirements: ["${topic}"],
  defaultConfig: {},
  actions: [],
  owner: ${upper},
});

export { HeartbeatWidget };
`,
  );

  files.set(
    "client/src/Heartbeat/index.test.tsx",
    `import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { HeartbeatWidget } from "./index.js";

describe("HeartbeatWidget", () => {
  it("says it is waiting rather than rendering a zero", () => {
    render(<HeartbeatWidget />);

    expect(screen.getByText(/waiting for the ${id} uplink/i)).toBeVisible();
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

  <!-- Private="false": GonogoCore provides Sitrep.Contract.dll at runtime, and two
       copies of one assembly identity are two sets of types that do not compare equal. -->
  <ItemGroup>
    <Reference Include="Sitrep.Contract" Private="false">
      <HintPath>$(GonogoContract)\\netstandard2.0\\Sitrep.Contract.dll</HintPath>
    </Reference>
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
/// The <c>${topic}</c> channel. A wire type belongs in the Uplink's own contract
/// slice, never in <c>Sitrep.Contract</c>.
/// </summary>
[SitrepContract]
[SitrepTopic("${topic}")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class ${Id}Heartbeat
{
    /// <summary>Universal time the sample was captured at.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? Ut { get; set; }

    /// <summary>How many times this Uplink has published, since load.</summary>
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
        builder.Global(g => g
            .CamelCaseForProperties()
            .UseModules(true)
            .AutoOptionalProperties());

        var wireTypes = new[] { typeof(${Id}Heartbeat) };

        builder.ExportAsInterfaces(wireTypes, c => c.AutoI(false).WithPublicProperties());
        Sitrep.Contract.RtConfig.ApplyUnitValueTypes(
            builder, wireTypes, valueImportFrom: "@ksp-gonogo/sitrep-sdk");

        var topicMapOut = Environment.GetEnvironmentVariable("SITREP_${upper}_TOPICMAP_OUT");
        if (!string.IsNullOrEmpty(topicMapOut))
        {
            Sitrep.Contract.RtConfig.EmitTopicMap(topicMapOut!, typeof(${Id}RtConfig).Assembly);
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
       SITREP_CODEGEN defined. Nothing references it and nothing ships it. -->
  <PropertyGroup>
    <CodegenTwinSource>..\\mod-contract</CodegenTwinSource>
    <AssemblyName>${ns}.Contract</AssemblyName>
    <RootNamespace>${ns}</RootNamespace>
  </PropertyGroup>
  <Import Project="$(GonogoContract)\\CodegenTwin.props" />

  <ItemGroup>
    <Reference Include="Sitrep.Contract">
      <HintPath>$(GonogoContract)\\codegen\\Sitrep.Contract.dll</HintPath>
    </Reference>
  </ItemGroup>
</Project>
`,
  );

  files.set(
    `mod/${ns}.csproj`,
    `<Project Sdk="Microsoft.NET.Sdk">
  <!-- The plugin assembly, net48 to match what KSP loads. It reads only the shared
       KspSnapshot, so it has no KSP or Unity reference. An Uplink that needs a live
       API adds a $(KspManaged) reference here. -->
  <PropertyGroup>
    <TargetFramework>net48</TargetFramework>
    <LangVersion>12</LangVersion>
    <Nullable>enable</Nullable>
    <AssemblyName>${ns}</AssemblyName>
    <RootNamespace>${ns}</RootNamespace>
    <AppendTargetFrameworkToOutputPath>false</AppendTargetFrameworkToOutputPath>
    <CopyLocalLockFileAssemblies>true</CopyLocalLockFileAssemblies>
  </PropertyGroup>

  <ItemGroup>
    <Reference Include="Sitrep.Contract" Private="false">
      <HintPath>$(GonogoContract)\\net472\\Sitrep.Contract.dll</HintPath>
    </Reference>
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\\mod-contract\\${ns}.Contract.csproj" />
  </ItemGroup>
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
        public const string HeartbeatTopic = "${topic}";

        private double _ticks;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "${id}",
            Version = "1.0.0",
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
        /// The tick's UT, or null when it was not honestly read. Core fills
        /// <see cref="KspSnapshot.Ut"/> with 0 when Planetarium throws, which is
        /// live before any save has loaded, so a non-null snapshot can carry a UT
        /// nobody read.
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
    <Compile Include="..\\mod\\${Id}Uplink.cs" />
  </ItemGroup>

  <ItemGroup>
    <Reference Include="Sitrep.Contract">
      <HintPath>$(GonogoContract)\\netstandard2.0\\Sitrep.Contract.dll</HintPath>
    </Reference>
    <ProjectReference Include="..\\mod-contract\\${ns}.Contract.csproj" />
    <Reference Include="Sitrep.Contract.TestSupport">
      <HintPath>$(GonogoDevkit)\\Sitrep.Contract.TestSupport.dll</HintPath>
    </Reference>
    <PackageReference Include="xunit.assert" Version="2.9.2" />
  </ItemGroup>
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

  return files;
}

const FALLBACK_DEPENDENCIES = {
  "@ksp-gonogo/ui-kit": "latest",
  "styled-components": "^6.0.0",
};

const FALLBACK_DEV_DEPENDENCIES = {
  "@ksp-gonogo/sitrep-sdk": "latest",
  "@ksp-gonogo/uplink-tools": "latest",
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
};

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
 * floating range would move it independently of the rest.
 */
function inheritFromSibling(uplinksDir: string, id: string) {
  if (!existsSync(uplinksDir)) return undefined;
  for (const sibling of readdirSync(uplinksDir).sort()) {
    if (sibling === id) continue;
    const pkg = join(uplinksDir, sibling, "client", "package.json");
    const decl = join(uplinksDir, sibling, "uplink.json");
    if (!existsSync(pkg) || !existsSync(decl)) continue;
    const parsed = asRecord(JSON.parse(readFileSync(pkg, "utf8")));
    const declared = asRecord(JSON.parse(readFileSync(decl, "utf8")));
    const siblingId = String(declared.id ?? sibling);
    const url = String(asRecord(declared.client).url ?? "");
    return {
      dependencies: asStrings(parsed.dependencies),
      devDependencies: asStrings(parsed.devDependencies),
      repo: String(declared.repo ?? ""),
      author: String(declared.author ?? ""),
      clientUrl: url.split(siblingId).join(id),
    };
  }
  return undefined;
}

export const NEW_USAGE = `gonogo-uplink new <id> [options]

  Scaffold a fresh Uplink: the hand-written seed only (contract slice, plugin,
  tests, a minimal widget and its fixture). Generated files are left to their
  generators, so nothing here can drift from the toolchain.

  --dir <dir>      the directory holding Uplinks (default: ./uplinks)
  --name <name>    the display name (default: the id, capitalised)
  --author <name>  written to uplink.json and the netkan
  --no-generate    do not run tooling/codegen-uplink.mjs afterwards`;

export function newUplink(argv: readonly string[]): number {
  const flag = (name: string): string | undefined =>
    argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined;
  const id = argv.find(
    (a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")),
  );
  if (!id) throw new Error(`new needs an id.\n\n${NEW_USAGE}`);
  const invalid = validateUplinkId(id);
  if (invalid) throw new Error(invalid);

  const uplinksDir = resolve(flag("--dir") ?? "uplinks");
  const target = join(uplinksDir, id);
  if (existsSync(target)) {
    throw new Error(
      `${target} already exists. new never overwrites: remove it or pick another id.`,
    );
  }

  const inherited = inheritFromSibling(uplinksDir, id);
  const files = renderSeed({
    id,
    name: flag("--name") ?? pascal(id),
    author: flag("--author") ?? inherited?.author ?? "your name here",
    repo: inherited?.repo ?? "https://github.com/you/your-uplinks",
    clientUrl:
      inherited?.clientUrl ??
      `https://cdn.jsdelivr.net/gh/you/your-uplinks@releases/uplinks/releases/${id}/0.0.1/${id}.client.js`,
    dependencies: inherited?.dependencies ?? FALLBACK_DEPENDENCIES,
    devDependencies: inherited?.devDependencies ?? FALLBACK_DEV_DEPENDENCIES,
  });

  for (const [path, content] of files) {
    const out = join(target, path);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, content);
  }
  console.log(`${id}: wrote ${files.size} files to ${target}`);

  const codegen = join(dirname(uplinksDir), "tooling", "codegen-uplink.mjs");
  const generated = !argv.includes("--no-generate") && existsSync(codegen);
  if (generated) {
    execFileSync(process.execPath, [codegen, id], { stdio: "inherit" });
  }

  const todo = [
    ...(generated
      ? []
      : [
          `generate the client types from the contract slice (tooling/codegen-uplink.mjs ${id} in a repo that carries it)`,
        ]),
    "install the client's dependencies",
    `write the generated page from ${join(target, "client")}: \`GONOGO_UPLINK_PAGE_UPDATE=1 npx vitest run\` (no browser) or \`npm run docs\` (also renders the pictures), then commit what it writes`,
  ];
  console.log(`\nNext:\n${todo.map((step) => `  - ${step}`).join("\n")}`);
  return 0;
}
