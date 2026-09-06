# Creating an Uplink

An **Uplink** extends gonogo with new telemetry, commands, and dashboard widgets. It is two halves
shipped as one unit:

- a **mod** (a C# DLL installed into KSP) that declares **Topics** (data it publishes) and **Commands**
  (actions it accepts)
- a **client** (a TypeScript/React bundle) that self-registers the **widgets and augments** which read
  those Topics and fire those Commands

The two halves share one identity (an `id` like `example`) and one version line. You own and host both.
There is no central marketplace to submit to and no reviewer to wait on: the gonogo app discovers your
Uplink because its mod is installed and running, fetches your client bundle from wherever you host it,
verifies it against a hash, and loads it. This guide walks the whole path.

Every TypeScript block below is a complete file or module, and the whole set is compiled against the
two published packages by `docs/examples/typecheck-guide-examples.mjs`. They are one fictional Uplink,
`example`, publishing a reactor's output and taking one command. Copy them and they build.

This repo also ships eleven Uplinks of its own under `mod/Gonogo*Uplink/`. They are worked examples,
not a canon: each is held to the same isolation rule as yours (`docs/uplink-isolation.md`) and uses the
same public API, and each carries a generated page at `client/README.md` showing its Topics, widgets
and screenshots. Read one whose shape matches what you are building. Nothing in this guide assumes you
have read any of them.

---

## Repo layout

Keep both halves in one repo. The shape below is worth mirroring, because the split between the mod
and its **contract**, and between the contract and its codegen twin, is load-bearing rather than
tidiness (see "Getting your contract into your client"):

```text
example-uplink/
  uplink.json                     # id, name, author, repo: read by `gonogo-uplink bundle`
  ExampleUplink/                  # the mod half
    ExampleUplink.cs
    ExampleUplink.csproj
    client/                       # the client half
      package.json
      gonogo-uplink.json          # generated version + compat manifest (see "The one version line")
      src/
        uplink.ts                 # defineUplinkClient(...): the client identity
        topics.ts                 # your Topics, typed and registered
        commands.ts               # your Commands, typed and registered
        units.ts                  # registerUnit on both seams, for tokens you introduce
        index.ts                  # the entry point: bare imports plus two named re-exports
        Reactor/index.tsx         # a widget, registered with owner: EXAMPLE
        __generated__/            # codegen output, never hand-edited
        test/setup.ts
  ExampleUplink.Contract/         # the wire types, referencing only Sitrep.Contract
  ExampleUplink.Contract.Codegen/ # the codegen-only twin of the above
  CodegenTwin.props               # the shape both twins share (see "Add a codegen-only TWIN")
  Sitrep.Contract/                # vendored: the codegen twin needs its sources, not its DLL
  Sitrep.Contract.Codegen/        # the codegen-only twin of THAT
  ExampleUplink.Tests/
```

The client is nested under the mod directory rather than beside it because the two halves version and
ship together, and because `gonogo-uplink bundle` searches up to three levels above the client for
`uplink.json`, so either arrangement is found.

### The tools, and where each assembly comes from

Two things are worth pinning down before the first file, because neither is discoverable by reading
the code.

**`gonogo-uplink` is a bin of `@ksp-gonogo/sitrep-sdk`**, the same package your client already depends
on. There is nothing else to install: `pnpm exec gonogo-uplink <command>` from your client directory,
or `npx gonogo-uplink` under npm. Every invocation in this guide is that command.

**`Sitrep.Contract.dll` is not on NuGet.** It is installed by the Gonogo mod, at
`<KSP>/GameData/Gonogo/Plugins/Sitrep.Contract.dll`, built for `net472`. You reference that file
directly, with `Private="false"`, because GonogoCore already loads it and a second copy in your own
output would give KSP two. The same is true of KSP's and Unity's own assemblies, which live in
`<KSP>/KSP_x64_Data/Managed/`, and of `0Harmony.dll` under `GameData/000_Harmony/` if you patch
anything.

So the mod project, in full:

```text
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net48</TargetFramework>
    <LangVersion>12</LangVersion>
    <Nullable>enable</Nullable>
    <AssemblyName>ExampleUplink</AssemblyName>
    <RootNamespace>ExampleUplink</RootNamespace>
    <AppendTargetFrameworkToOutputPath>false</AppendTargetFrameworkToOutputPath>
    <CopyLocalLockFileAssemblies>true</CopyLocalLockFileAssemblies>
    <!-- Your own machine's paths; pass them on the command line in CI. -->
    <KspManaged>/path/to/KSP/KSP_x64_Data/Managed</KspManaged>
    <KspGameData>/path/to/KSP/GameData</KspGameData>
  </PropertyGroup>

  <!-- Private="false" throughout: KSP has all of these loaded already. -->
  <ItemGroup>
    <Reference Include="Assembly-CSharp" Private="false">
      <HintPath>$(KspManaged)/Assembly-CSharp.dll</HintPath>
    </Reference>
    <Reference Include="UnityEngine" Private="false">
      <HintPath>$(KspManaged)/UnityEngine.dll</HintPath>
    </Reference>
    <Reference Include="UnityEngine.CoreModule" Private="false">
      <HintPath>$(KspManaged)/UnityEngine.CoreModule.dll</HintPath>
    </Reference>
    <!-- Only if you install a Harmony patch (see "Reading another mod's internals"). -->
    <Reference Include="0Harmony" Private="false">
      <HintPath>$(KspGameData)/000_Harmony/0Harmony.dll</HintPath>
    </Reference>
    <Reference Include="Sitrep.Contract" Private="false">
      <HintPath>$(KspGameData)/Gonogo/Plugins/Sitrep.Contract.dll</HintPath>
    </Reference>
    <!-- YOUR contract slice takes the default Private="true": nothing else
         ships it, so it has to land beside your DLL. -->
    <ProjectReference Include="../ExampleUplink.Contract/ExampleUplink.Contract.csproj" />
  </ItemGroup>
</Project>
```

And the contract slice, which touches no KSP type and so stays a plain library:

```text
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <!-- net48, matching the mod that references it. rtcli never loads THIS
         build: it loads the netstandard2.0 twin of step 2. -->
    <TargetFramework>net48</TargetFramework>
    <Nullable>enable</Nullable>
    <LangVersion>latest</LangVersion>
    <AssemblyName>ExampleUplink.Contract</AssemblyName>
    <RootNamespace>ExampleUplink</RootNamespace>
    <KspGameData>/path/to/KSP/GameData</KspGameData>
  </PropertyGroup>
  <!-- NO Reinforced.Typings reference here, in either target framework. See
       "Add a codegen-only TWIN" for what happens when one creeps in. -->
  <ItemGroup>
    <Reference Include="Sitrep.Contract" Private="false">
      <HintPath>$(KspGameData)/Gonogo/Plugins/Sitrep.Contract.dll</HintPath>
    </Reference>
  </ItemGroup>
</Project>
```

Note the split: the mod half reaches into KSP, the contract slice is plain DTOs and touches nothing
but `Sitrep.Contract`. That is what lets step 2 recompile those same sources as `netstandard2.0` for
rtcli, which could not load a KSP-linked assembly at all, and it is why the two are separate projects
rather than one.

---

## Part 1: the mod half

A mod class implements `ISitrepUplink` and carries the `[SitrepUplink("<id>")]` attribute. The host
discovers it by that attribute, reads its `UplinkManifest`, and calls `Register`. The `id` in the
attribute is the identity that ties the two halves together: it MUST match your client's
`defineUplinkClient` id and your `gonogo-uplink.json` id.

The attribute also carries the contract version you were built against, defaulted at COMPILE time, so
a binary that was never rebuilt keeps reporting the version it actually shipped against. The host
refuses an Uplink whose contract MAJOR differs from its own and never calls its `Register`, because
your payload types are a shape it cannot type-check against. A refusal is not silent: the Uplink rides
`system.uplinks` as a present-and-refused entry carrying both version numbers, and the app's setup
wizard shows a row saying which contract you were built for and which one the running mod speaks. A
MINOR difference either way is fine, Minor bumps are additive.

`ISitrepUplink` has exactly three members, and this example uses all of them: `Manifest`, `Register`
and `Health`. There is **no teardown hook**, deliberately: an Uplink is registered once per game
session and lives as long as the mod does, so a Harmony patch you install in `Register` stays
installed. Patch defensively rather than planning to remove it.

```csharp
using System.Collections.Generic;
using Sitrep.Contract;
using ExampleUplink.Contract;

[SitrepUplink("example")]
public sealed class ExampleUplink : ISitrepUplink
{
    public const string AvailableTopic = "example.available";
    public const string ReactorTopic = "example.reactor";
    public const string SetOutputCommand = "example.setOutput";

    public UplinkManifest Manifest { get; } = new UplinkManifest
    {
        Id = "example",
        Version = "0.1.0",

        // How an operator sees you in the consent dialog, and where a
        // suspicious one goes to look. Empty reads as absent, never as a
        // stand-in value.
        Name = "Example Uplink",
        Author = "you",
        Repo = "https://github.com/you/example-uplink",

        // Where the app fetches your CLIENT from, and the hash it must match.
        // Both are read off the live `system.uplinks` roster: this is how the
        // app learns your bundleUrl. See "Distribution".
        ClientSource = new UplinkClientSource
        {
            Url = "https://example.com/uplinks/example/example.client.js",
        },
        // `gonogo-uplink bake-hash --namespace Example.Generated` writes the
        // class this reads; see "The one version line".
        ExpectedClientHash = Example.Generated.ExpectedClientHash.Value,

        // Topics this Uplink publishes. Each ChannelDeclaration names a Topic,
        // its delivery mode, its emission cadence, and its delay role.
        Channels = new List<ChannelDeclaration>
        {
            // The presence gate: a bare boolean saying the mod behind this
            // Uplink is actually running. Nothing synthesises this for you,
            // it is an ordinary channel you declare and publish like any
            // other, and every Uplink in this repo declares one.
            new ChannelDeclaration
            {
                Topic = AvailableTopic,
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                Delay = DelayRole.TrueNow,
            },
            new ChannelDeclaration
            {
                Topic = ReactorTopic,
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                // Delayed rides the light-time signal delay like any vessel-sourced
                // value; TrueNow bypasses it (only for genuine ground-side facts)
                Delay = DelayRole.Delayed,
            },
        },

        // Commands this Uplink accepts. Delayed:false runs immediately (a game
        // or player action); Delayed:true rides the signal delay (a command to
        // the craft).
        Commands = new List<CommandDeclaration>
        {
            new CommandDeclaration { Command = SetOutputCommand, Delayed = true },
        },
    };

    // Mandatory health self-report. Return Healthy once registered; return
    // Unavailable(reason) when a dependency is missing so the app can say why.
    public UplinkHealth Health() => UplinkHealth.Healthy;

    public void Register(IUplinkHost host)
    {
        // Publish a Topic. The mapper is `Func<KspSnapshot?, object?>`, and
        // what it returns has to be a shape the core serializer can write:
        // see "Flatten your payload" below for why ReadReactor hands back a
        // dictionary rather than the POCO.
        host.AddChannelSource(AvailableTopic, _ => true);
        host.AddChannelSource(ReactorTopic, snapshot => ReadReactor(snapshot));

        // Handle a Command: typed args in, a CommandResult out.
        host.AddCommandHandler<SetOutputArgs, CommandResult>(SetOutputCommand, SetOutput);
    }

    private Dictionary<string, object?>? ReadReactor(KspSnapshot? snapshot)
    {
        var status = ReadReactorStatus(snapshot);
        // Publishing nothing is how you say "no reading", and the client sees
        // `pending` rather than a fabricated zero.
        return status == null ? null : ExampleWire.Reactor(status);
    }

    private ReactorStatus? ReadReactorStatus(KspSnapshot? snapshot) => /* ... */ null;

    private CommandResult SetOutput(SetOutputArgs args)
    {
        if (args.TargetPower < 0)
        {
            // A REFUSAL: the game said no. This is what lands on the client
            // handle's `refusals`, with `detail` shown in the game's own words.
            return CommandResult.Fail(
                CommandErrorCode.Range, "Output cannot be negative.");
        }
        return CommandResult.Ok();
    }
}
```

**Returning a payload from a command.** `CommandResult.Ok()` is success and nothing more. To answer
with data, declare the payload type on the attribute (`[SitrepCommand("example.readout", Payload =
typeof(ReactorReadout))]`, see "Register your commands"), handle it as
`AddCommandHandler<TArgs, CommandResult<ReactorReadout>>`, and return
`CommandResult<ReactorReadout>.Ok(payload)`. The generated TS names that reply `CommandResultOf<T>`.

**`Emission` and `Delivery`, since both are easy to copy without reading.**

- `Delivery.LossyLatest` drops a superseded sample rather than queueing it, which is what a READING
  wants: the newest value is the only one worth having. `Delivery.ReliableOrdered` is the other
  member, for a stream where every item matters and order is meaningful (an event log, a terminal
  feed)
- `keyframeIntervalUt: 30` emits unconditionally every 30 UT seconds whether or not the value
  changed. It is the baseline that makes a cold start, a quickload and a resubscribe recoverable
  without waiting for the next real change, and it must be greater than zero
- `quantum` is the deadband a value must clear before a CHANGE emission fires in between keyframes.
  `EmissionQuantum.Absolute(0)` means any change at all emits; `Absolute(5)` means five units of the
  value's own scale; `EmissionQuantum.PercentOfRange(0.01, min, max)` is 1% of a known range, for a
  value whose useful precision is relative rather than absolute
- two optional constructor arguments tune the rest: `minSampleIntervalUt` refuses to even look more
  often than that, and `maxRateIntervalUt` clamps how often a re-tripping deadband may fire. Both
  default to 0, which disables them

Key points:

- **`Health()` is mandatory** and cheap: it is polled on a background thread, so read a cached field, not
  live KSP state. Return `new UplinkHealth(UplinkHealthState.Unavailable, reason)` when your dependency is
  absent, and the app surfaces that reason instead of the widget silently doing nothing
- **Health is also where a dependency's IDENTITY goes.** The third argument is a list of
  `UplinkHealthFact(label, value)` rows: which file you loaded, which build, which hash, whatever an
  operator would have to quote when reporting your Uplink's state. The app lists them beside your detail
  line without knowing what any of them mean, so you do not need a Topic of your own to carry them, and
  you should not invent one: a Topic gets a unit, a delay role and a history, none of which a file path
  wants. Keep readings on Topics and identity here
- **`AddChannelSource`** publishes a Topic from the main-thread game snapshot. **`AddSampledSource`** is
  the capture-on-main / handle-on-Courier variant, for state that is NOT already on the shared
  `KspSnapshot` and can only be read from the Unity main thread. Read
  `IUplinkHost.AddSampledSource`'s own doc comment in `Sitrep.Contract` before using it, and read the
  gated overload's second: gating a capture that writes state anything else reads starves that reader
  silently, with no log line and no degraded mode
- **Topic and Command names are namespaced by your id** (`example.reactor`), which keeps them from
  colliding with other Uplinks
- **Flatten your payload before you publish it.** What reaches the wire has to be a shape the core
  serializer can write: numbers, strings, booleans, enums, `Dictionary<string, object?>` and arrays,
  nested however you like. It cannot write a class of your own, and by design it never will be able
  to, a core serializer may not reference your assembly. Publish the POCO raw and the mod tells you
  so: the subscriber gets a `payload-serialization-error` naming your type, the app logs it, and your
  Uplink is marked Unavailable with the same reason on the `system.uplinks` roster and in KSP.log

So your POCO stays as the typing mirror codegen reflects over, and one small class turns it into the
wire shape. This is the whole of it:

```text
using System.Collections.Generic;
using ExampleUplink.Contract;

namespace ExampleUplink
{
    /// <summary>The wire shapes for this Uplink's channels.</summary>
    internal static class ExampleWire
    {
        // Keys are camelCase and match the generated TS interface field for
        // field: `outputPower` here is `outputPower?: Value<"kW">` there. A key
        // that does not match is a field the client reads as undefined, with
        // nothing failing, so keep the two in step by eye when you add one.
        public static Dictionary<string, object?> Reactor(ReactorStatus s) =>
            new Dictionary<string, object?>
            {
                ["online"] = s.Online,
                ["outputPower"] = s.OutputPower,
                ["coreTemp"] = s.CoreTemp,
                ["throughput"] = s.Throughput,
            };
    }
}
```

Two conventions the serializer expects and the generated types assume. An **enum** goes on the wire
as its integer ordinal, not its name. A **nested payload** is another `Dictionary<string, object?>`
under its own key, and a **list** of them is a `List<Dictionary<string, object?>>`; both are exactly
what the generated interface's nested type and array say they are.
`GonogoRealAntennasUplink/RaWire.cs` in this repo is the same class with four channels on it, if you
want a longer worked one.

### Reading another mod's internals

Most Uplinks wrap a mod that exposes no API, so you reach its state by reflection: look the type up
by name, read the members you need, and stay compiled against nothing but `Sitrep.Contract`. That
part is routine. Two things about it are not, and both have cost us a wrong answer already.

**A field read is safe. A call is safe only once you have read its body.**

The tempting shortcut is "a managed, parameterless getter is harmless, the danger is native
interop". That is false, and it fails in the worst direction. A mod's own fatal-log helper aborts
the process, and it gets called from the default branch of an ordinary-looking switch. Principia's
frame selector holds no native handle at all, and four of its parameterless members still reach it:

```text
FrameParameters()   default branch -> Log.Fatal("Unexpected frame_type ...")
Name()              -> Log.Fatal("Unexpected type ..."), plus three root-body cases
NavballName()       same naming path
Abbreviation()      same naming path
```

Reachable, innocuous-looking, forbidden. Nothing about their signatures says so.

What makes this worth a rule rather than a warning is that the loose version gives the right
answer for the wrong reason. `BurnEditor.Δv()` really is safe, and it passes the loose test too,
so a shortcut that had been "working" would have kept working right up to the first member that
happened to have a default branch. If you invoke anything on a foreign object, decompile it first
and write down what you found next to the call. If you cannot, derive the value from fields
instead: a label you format yourself is always safer than the mod's own formatter.

**A field you can read is not necessarily a field that is true.**

Ask what WRITES it. Three cases, and only the first is safe to read whenever you like:

| the field is | read it | example |
| --- | --- | --- |
| operator state, or restored from the save | freely, it is current | a display toggle, a persisted length |
| recomputed by the mod's own UI each repaint | only from a hook, and stamp when you saw it | a value the mod refreshes while its window draws |
| never written unless a window is open | same, and treat "never seen" as its own state | a list the mod fills when the operator looks |

The second and third are the trap, because an unread field is not empty: it holds whatever its
constructor set, which usually looks like a plausible value. A poll of a window-gated setting will
happily report the default as though it were the operator's choice, with nothing anywhere to say
otherwise. If your value only exists while some window renders, put a `Harmony` postfix on that
render, latch the value with `Planetarium.GetUniversalTime()` beside it, and publish it as a
sample AT that instant, and the client's own staleness handling then does the rest for free.

And never publish absence from a source that cannot tell "none" from "not looked yet". Publish
nothing, so the client reads `absent` and can say so.

---

## Part 2: the client half

### Getting your contract into your client

Step zero of the client half is a typed contract. Your Topic payloads are C# classes, and the client
needs the matching TypeScript. Three things come out of one codegen run: the interfaces, a Topic map,
and a unit map. `mod/codegen.sh` in this repo runs exactly this per Uplink, and is the script to read
alongside this section.

**1. Put the wire types in their own project.** `ExampleUplink.Contract` holds the payloads and the
command args, references `Sitrep.Contract` and nothing else, and is what both your mod and codegen
read. Annotate the quantities:

```csharp
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using Sitrep.Contract;

namespace ExampleUplink.Contract
{
    // Three attributes, and only one of them is guarded.
    //
    // [SitrepContract] marks this as a WIRE type. It lives in Sitrep.Contract
    // itself, so anything reflecting over it resolves an assembly that is
    // already loaded.
    //
    // [SitrepTopic] names the Topic this payload is the shape of, and is what
    // EmitTopicMap reflects over.
    //
    // [TsInterface] is Reinforced.Typings', and it MUST sit behind the #if:
    // it is the attribute whose presence in a SHIPPED assembly drags in a
    // metadata reference to Reinforced.Typings.dll, which is deliberately
    // never deployed. See step 2. Every contract type in this repo is written
    // exactly this way.
    [SitrepContract]
    [SitrepTopic("example.reactor")]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public sealed class ReactorStatus
    {
        // `Units` here is Sitrep.Contract's own catalog, from the using above.
        [SitrepUnit(Units.Flag)]
        public bool Online { get; set; }

        [SitrepUnit("kW")]
        public double OutputPower { get; set; }

        [SitrepUnit("K")]
        public double CoreTemp { get; set; }

        // A token the core catalog has never heard of is FINE: the generated
        // SitrepUnit union is open. Declare it in your OWN catalog class (see
        // "Your own catalog") so a typo still fails, then teach the client
        // what it means.
        [SitrepUnit(ExampleUnits.ThermalUnits)]
        public double Throughput { get; set; }
    }

    // A command's args class is the same shape, plus [SitrepCommand], which is
    // what fills the generated command map. See "Register your commands".
    [SitrepContract]
    [SitrepCommand("example.setOutput")]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public sealed class SetOutputArgs
    {
        [SitrepUnit("kW")]
        public double TargetPower { get; set; }
    }
}
```

`[TsInterface]` and the fluent `builder.ExportAsInterfaces(...)` in step 3 configure the same
blueprint, so strictly you could do without the attribute. Keep it: it is how every slice in this
repo reads, and it means the type declares its own intent rather than depending on being remembered
in a list two files away.

**2. Add a codegen-only TWIN of that project.** Reinforced.Typings drives codegen by reading
`[TsInterface]`/`[TsEnum]` out of an assembly's metadata, so those attributes have to be compiled into
something, and it must not be the assembly you ship. A shipped contract assembly holding a metadata
reference to `Reinforced.Typings.dll` while being deployed without it throws
`FileNotFoundException` from anything that asks one of its types for its attributes, and
`Enum.ToString()` asks, because enum formatting looks for `[Flags]`. Nine contract projects in this
repo had that leak.

So `ExampleUplink.Contract.Codegen` recompiles the SAME sources with `SITREP_CODEGEN` defined, which is
the only configuration in which the RT attributes and your `Configure` method exist at all. Nothing
references the twin and nothing ships it. The twin itself is a name, a source directory and one
reference, over a shared props file:

```text
<!-- ExampleUplink.Contract.Codegen/ExampleUplink.Contract.Codegen.csproj -->
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <CodegenTwinSource>..\ExampleUplink.Contract</CodegenTwinSource>
    <AssemblyName>ExampleUplink.Contract</AssemblyName>
    <RootNamespace>ExampleUplink</RootNamespace>
  </PropertyGroup>
  <Import Project="..\CodegenTwin.props" />
  <!-- The CODEGEN-flavoured core contract, not the shipped DLL: rtcli resolves
       the core types your slice references, and the RtConfig helpers step 3
       calls exist only in this build. See "Where the codegen contract comes
       from" below. -->
  <ItemGroup>
    <ProjectReference Include="..\Sitrep.Contract.Codegen\Sitrep.Contract.Codegen.csproj" />
  </ItemGroup>
</Project>
```

Keeping `AssemblyName` equal to the shipped assembly's name matters: rtcli sees the same assembly
identity, type names and member order, so the generated TypeScript does not churn.

`CodegenTwin.props` is the half both twins share. It is not published anywhere, so write it yourself,
once, beside them:

```text
<!-- CodegenTwin.props -->
<Project>
  <PropertyGroup>
    <TargetFramework>netstandard2.0</TargetFramework>
    <Nullable>enable</Nullable>
    <LangVersion>latest</LangVersion>
    <IsPackable>false</IsPackable>
    <DefineConstants>$(DefineConstants);SITREP_CODEGEN</DefineConstants>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>
    <!-- A netstandard2.0 library does not copy package assemblies to output by
         default, which would leave Reinforced.Typings.dll absent beside the very
         assembly rtcli loads for its attributes. -->
    <CopyLocalLockFileAssemblies>true</CopyLocalLockFileAssemblies>
    <!-- The only route from your `///` prose to the generated TypeScript:
         Reinforced.Typings reads an XMLDOC file, never the sources. -->
    <GenerateDocumentationFile>true</GenerateDocumentationFile>
    <NoWarn>$(NoWarn);CS1591</NoWarn>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="$(CodegenTwinSource)\**\*.cs"
             Exclude="$(CodegenTwinSource)\bin\**\*.cs;$(CodegenTwinSource)\obj\**\*.cs" />
  </ItemGroup>
  <ItemGroup>
    <!-- A plain reference on purpose: a twin is codegen-only, so
         Reinforced.Typings.dll landing in ITS output is exactly what we want. -->
    <PackageReference Include="Reinforced.Typings" Version="1.6.7" />
  </ItemGroup>
</Project>
```

#### Where the codegen contract comes from

The `Sitrep.Contract.dll` in your KSP install is the SHIPPED build, and step 3's `RtConfig` helpers
are not in it: they take a `Reinforced.Typings.Fluent.ConfigurationBuilder`, which is precisely the
reference the shipped assembly may not carry, so the whole class sits behind the same
`#if SITREP_CODEGEN`. Codegen therefore needs a codegen-flavoured build of the core contract too, and
you make one the same way you make yours: gonogo is public and MIT, so take `mod/Sitrep.Contract/`
from `github.com/ksp-gonogo/gonogo` at the tag matching the contract major your Uplink targets, drop
it beside your projects, and give it a twin whose `CodegenTwinSource` points at it and whose
`AssemblyName` is `Sitrep.Contract`. Nothing you ship references either copy.

This is the one place the build path is heavier than it should be, and it is heavier because there is
no published codegen artifact yet, not because vendoring is the design.

**3. Write the `Configure` method rtcli calls.** It lives in the contract project, behind
`#if SITREP_CODEGEN`. Three calls do the work: export the types as interfaces, retype the annotated
properties from bare numbers to `Value<unit>`, and emit the two maps.

```csharp
#if SITREP_CODEGEN
using System;
using Reinforced.Typings.Fluent;

namespace ExampleUplink.Contract
{
    public static class ExampleRtConfig
    {
        public static void Configure(ConfigurationBuilder builder)
        {
            builder.Global(g => g
                .CamelCaseForProperties()
                .UseModules(true)
                .AutoOptionalProperties()
                // What makes rtcli's DocumentationFilePath reach the emitted
                // declarations at all, and turns the raw XMLDOC into TSDoc.
                .GenerateDocumentation()
                .UseVisitor<Sitrep.Contract.RtDocVisitor>());

            // Must precede any registration below: the fluent configuration
            // runs before the documentation is loaded.
            Sitrep.Contract.RtDocText.MergeRemarksIntoSummaries(builder);

            // Held in a local because ApplyUnitValueTypes re-enters this exact
            // set: only a type registered with rtcli may have its properties
            // retyped. A nested payload left out of this set generates with
            // bare numbers where its parent generates Value<> types, in the
            // same file, with nothing failing.
            var wireTypes = new[] { typeof(ReactorStatus), typeof(SetOutputArgs) };

            builder.ExportAsInterfaces(wireTypes, c => c.AutoI(false).WithPublicProperties());

            // `valueImportFrom` is the specifier that reaches the SDK from YOUR
            // generated file. Core's default is a relative path that does not
            // resolve from an Uplink's client.
            Sitrep.Contract.RtConfig.ApplyUnitValueTypes(
                builder, wireTypes, valueImportFrom: "@ksp-gonogo/sitrep-sdk");

            // Which env vars you read is your choice; these mirror the
            // first-party naming. Both emitters are no-ops when unset.
            var topicMapOut = Environment.GetEnvironmentVariable("EXAMPLE_TOPICMAP_OUT");
            if (!string.IsNullOrEmpty(topicMapOut))
            {
                Sitrep.Contract.RtConfig.EmitTopicMap(
                    topicMapOut!, typeof(ExampleRtConfig).Assembly);
            }

            var unitMapOut = Environment.GetEnvironmentVariable("EXAMPLE_UNITMAP_OUT");
            if (!string.IsNullOrEmpty(unitMapOut))
            {
                Sitrep.Contract.RtConfig.EmitUnitMap(
                    unitMapOut!,
                    Environment.GetEnvironmentVariable("EXAMPLE_UNITJSON_OUT"),
                    typeof(ExampleRtConfig).Assembly);
            }

            // The write-side map, off your [SitrepCommand] tags. Omit this and
            // `command-map.ts` is never written, so `client/src/commands.ts`
            // imports a file that does not exist. `CommandResult` /
            // `CommandResultOf` are core's and are not in YOUR contract.ts, so
            // they come from the published package rather than a relative path
            // that would not resolve out of src/__generated__/.
            var commandMapOut = Environment.GetEnvironmentVariable("EXAMPLE_COMMANDMAP_OUT");
            if (!string.IsNullOrEmpty(commandMapOut))
            {
                Sitrep.Contract.RtConfig.EmitCommandMap(
                    commandMapOut!,
                    typeof(ExampleRtConfig).Assembly,
                    resultImportFrom: "@ksp-gonogo/sitrep-sdk");
            }
        }
    }
}
#endif
```

`ApplyUnitValueTypes` skips inbound-only command args deliberately, so `SetOutputArgs` generates with
bare numbers even though it is in the set.

**4. Run rtcli over the twin's output**, writing into your client's `src/__generated__/`:

```bash
RT_PKG="$HOME/.nuget/packages/reinforced.typings/1.6.7"
OUT="ExampleUplink/client/src/__generated__"

dotnet build ExampleUplink.Contract.Codegen/ExampleUplink.Contract.Codegen.csproj -v minimal
mkdir -p "$OUT"

BIN="ExampleUplink.Contract.Codegen/bin/Debug/netstandard2.0"

DOTNET_ROLL_FORWARD=LatestMajor \
  EXAMPLE_TOPICMAP_OUT="$OUT/topic-map.ts" \
  EXAMPLE_UNITMAP_OUT="$OUT/units.ts" \
  EXAMPLE_UNITJSON_OUT="$OUT/units.json" \
  EXAMPLE_COMMANDMAP_OUT="$OUT/command-map.ts" \
  dotnet "$RT_PKG/tools/net5.0/rtcli.dll" \
  DocumentationFilePath="$BIN/ExampleUplink.Contract.xml" \
  SourceAssemblies="$BIN/ExampleUplink.Contract.dll" \
  TargetFile="$OUT/contract.ts" \
  ConfigurationMethod="ExampleUplink.Contract.ExampleRtConfig.Configure"
```

`DocumentationFilePath` is what carries your `///` prose onto the generated declarations. Leave it
out and the emitted TypeScript is field names with no reasoning attached.

Five files land in `src/__generated__/`, and none of them is ever hand-edited:

| file | what it holds | who reads it |
| --- | --- | --- |
| `contract.ts` | one interface per wire type, camelCased, quantities as `Value<unit>` | your widgets, `topics.ts` |
| `topic-map.ts` | `GeneratedTopicPayloadMap` and `GENERATED_TOPIC_IDS` | reference for your `declare module` block |
| `command-map.ts` | `GeneratedCommandArgsMap`, `GeneratedCommandReplyMap` and `GENERATED_COMMAND_IDS` | `commands.ts`, at module load |
| `units.ts` | `GENERATED_TOPIC_UNITS` / `_SHAPES` and `GENERATED_TYPE_UNITS` / `_SHAPES` | `topics.ts`, at module load |
| `units.json` | the same unit map as data | anything that is not TypeScript |

`topic-map.ts` is a reference rather than something you import: it names the Topics your
`[SitrepTopic]` attributes declared, and **it is not a list of every Topic on your wire**. A dynamic
namespace registered through `IUplinkHost.RegisterDynamicNamespace` materialises its Topics per subject
at runtime, so no attribute exists for reflection to find and nothing about it appears there.

### Declare the client identity

Every client bundle declares its identity once, in `client/src/uplink.ts`, with `defineUplinkClient` from
the SDK. It returns a frozen handle:

```ts
// client/src/uplink.ts
import { defineUplinkClient } from "@ksp-gonogo/sitrep-sdk";

// Must equal your package.json version. `gonogo-uplink docs` refuses to write a
// manifest where the two disagree, because the app compares what it reads in
// the manifest against what your loaded bundle declares.
const UPLINK_VERSION = "0.1.0";

export const EXAMPLE = defineUplinkClient({
  id: "example", // MUST match [SitrepUplink("example")] and gonogo-uplink.json
  version: UPLINK_VERSION,
  name: "Example Uplink",
  // The subtitle on your generated README, so write it for a reader deciding
  // whether to install this.
  description: "Reactor output, core temperature and throughput, from the example mod.",
});
```

### Register your Topics, and the generic surfaces follow

Your client tells the SDK which Topics you own, at module load, beside the `declare module`
augmentation that types them. Both halves are needed and they answer different questions:

```ts
// client/src/topics.ts
import {
  registerBarePrimitiveTopic,
  registerTopicUnits,
  registerTypeUnits,
} from "@ksp-gonogo/sitrep-sdk";
import type { ReactorStatus } from "./__generated__/contract";
import {
  GENERATED_TOPIC_SHAPES,
  GENERATED_TOPIC_UNITS,
  GENERATED_TYPE_SHAPES,
  GENERATED_TYPE_UNITS,
} from "./__generated__/units";

// The TYPE half. `TopicPayloadMap` is the SDK's declaration-merging seam, and
// merging into it is what makes `useTelemetry("example.reactor")` answer a
// Reading of ReactorStatus rather than failing to resolve the id at all.
declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    "example.available": boolean;
    "example.reactor": ReactorStatus;
  }
}

// The RUNTIME half, part one: which Topic ids exist. Named for the commonest
// case (a bare boolean with no C# payload type), but a structured Topic
// registers here too, and this is also what makes your Topic pickable and
// promotable in the app's generic surfaces.
registerBarePrimitiveTopic("example.available");
registerBarePrimitiveTopic("example.reactor");

// Part two: what turns a bare number on the wire into the `Value` your type
// promises. Loop your own generated maps, so a Topic you add later needs no
// new call site.
for (const [topic, units] of Object.entries(GENERATED_TOPIC_UNITS)) {
  registerTopicUnits(topic, units, GENERATED_TOPIC_SHAPES[topic] ?? {});
}
for (const [name, units] of Object.entries(GENERATED_TYPE_UNITS)) {
  registerTypeUnits(name, units, GENERATED_TYPE_SHAPES[name] ?? {});
}
```

Register the type-keyed half as well as the topic-keyed half. `registerTopicUnits` covers a Topic's OWN
fields, which is the whole of the problem for a flat payload and none of it for a nested one: the
decoder learns from the shape map that a field holds another shape, then resolves that shape BY NAME
through the type-keyed registry. Register only the topic and every quantity nested one level down
arrives bare while the generated type still says `Value<"m">`.

Registration buys more than the decode, and you do nothing further to collect it. It is the only
statement your Topics exist that reaches a running app, so it is what the app's generic surfaces read.
Your Topics are promoted to the stream on the same footing as a first-party one, and every field you
declared a unit for turns up, labelled and dimensioned, in the pickers the graph widget, the threshold
alarms and the note tags are all built from. There is no list in the gonogo repo to get your Topic added
to, and asking for one would be the wrong fix: it could only ever name an Uplink that shipped before it
was written.

The one field that will not appear is one with no declared unit. A field the walk cannot dimension is a
field a picker cannot order or render, so annotate the whole payload rather than the interesting half.

### Register widgets and augments with `owner`

Every widget and augment your client registers stamps that handle as `owner`. This is the whole point of
the handle: the widget picker's mod search tags derive from `owner.id` automatically, so a user searching
"example" finds your widgets with no per-widget field to remember.

Here is the smallest complete widget, reading the bare boolean presence Topic the mod declares and
publishes in Part 1:

```tsx
// client/src/Presence/index.tsx
import type { ComponentProps } from "@ksp-gonogo/sitrep-sdk";
import { registerComponent, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import { Panel, Section, StatusPill } from "@ksp-gonogo/ui-kit";
// Side-effect import: your Topics have to be typed and registered before a
// widget reads one, and a widget pulls that itself rather than relying on the
// entry point's import order.
import "../topics";
import { EXAMPLE } from "../uplink";

type PresenceConfig = Record<string, never>;

function PresenceWidget(_props: ComponentProps<PresenceConfig>) {
  // `useTelemetry` answers a `Reading`, never the payload. `observed` is the
  // only arm that means "true, right now": see the next section.
  const reading = useTelemetry("example.available");
  const online = reading.state === "observed" && reading.value;

  // The body goes in `sections` and the Panel tag is self-closing. Passing
  // children instead is the retiring form; see "Giving your widget a body".
  return (
    <Panel
      panelTitle="Reactor"
      compactTitle={["REACTOR", "RTR"]}
      sections={
        <Section title="Status">
          <StatusPill $tone={online ? "go" : "warning"}>
            {online ? "ONLINE" : "NO READING"}
          </StatusPill>
        </Section>
      }
    />
  );
}

registerComponent<PresenceConfig>({
  id: "example-presence",
  name: "Reactor Presence",
  // Required, and it is the line on your generated README, so one sentence
  // about what an operator sees.
  description: "Whether the example mod is reporting a reactor at all.",
  tags: ["telemetry"],
  component: PresenceWidget,
  // Typed against your merged TopicPayloadMap, so a typo fails the build.
  channels: ["example.available"],
  actions: [],
  defaultConfig: {},
  owner: EXAMPLE, // <- stamps ownership; search tags derive "example"
});
```

`description` and `tags` are required. There is no `category` field; `tags` is the free-form list a
picker may style. `channels` names the Topics the widget REQUIRES and is typed against `TopicId`, so it
is checked; `optionalChannels` is the same for a read the widget can do without.

> If you are migrating an older client: the previous per-widget `mod` field is gone. Ownership now comes
> from `owner: <handle>`, and the search tag derives from `owner.id`. Delete any old `mod:` field

### What a Topic read answers: `Reading`

`useTelemetry` does not answer your payload. It answers a `Reading` of it, a discriminated union
carrying TWO independent discriminants, and there is no member you can read a value off without first
writing `state`:

```text
type Reading<T> =
  | { state: "pending";   reckoning: "none" }
  | { state: "unowned";   reckoning: "none" }
  | { state: "absent";    reckoning: "none";      atUt: Value<"ut"> }
  | { state: "observed";  reckoning: "none";      value: T; atUt: Value<"ut"> }
  | { state: "observed";  reckoning: "available"; value: T; atUt: Value<"ut">;
                          reckoned: Reckoning<T> }
  | { state: "stale";     reckoning: "none";      value: T; asOfUt: Value<"ut">;
                          grade: StaleGrade }
  | { state: "stale";     reckoning: "available"; value: T; asOfUt: Value<"ut">;
                          grade: StaleGrade; reckoned: Reckoning<T> };
```

`state` answers how CURRENT the value is. `reckoning` answers whether a forward MODEL is on offer for
it. They are orthogonal: a quantity whose cause is known (a conic, a rate) is forward-modellable
whether or not the last packet arrived on time, so a live reading can carry a model just as a stale one
can. Every member carries `reckoning`, so you can ask either question first.

This is the most consequential thing on the read surface, so it is worth the paragraph. A widget that
renders stale data as though it were live is this project's worst failure mode, and the weaker fix
already exists and did not work: a staleness badge rides its own channel beside the value, ui-kit
renders it, and the dashboard even badges the panel header from it. Zero of the thirty-nine built-in
telemetry widgets adopted it, because a badge beside a body is chrome and nothing forces the body to
consult it. Reaching a value here means branching, and the branch is where the caveat gets rendered.

What each arm means:

- **`pending`**: nothing at or before the frame's view time yet. A cold Topic, or a resync after a
  rewind. It may become something else on the next frame
- **`unowned`**: nothing will EVER publish this Topic. No installed Uplink declares it and it falls
  under no dynamic namespace, so waiting is futile. Decided by the mod, from a subscribe that came back
  unacknowledged, never inferred client-side from silence
- **`absent`**: a confirmed tombstone. The subject says there is no value. Carries `atUt`, so a widget
  can say "no reactor aboard, confirmed 3 s ago" rather than asserting it for the rest of the mission
- **`observed`**: the newest sample that could have reached us. Note that under a light-time delay every
  value is old, and a value 4 s old under a 4 s light-time is as current as physics permits, so it is
  `observed`. Delay is not staleness
- **`stale`**: updates we should have had did not arrive. `value` is the last REAL observation and
  `asOfUt` says when it was made. This is the honest majority

And the second axis:

- **`reckoning: "none"`**: no model is on offer this frame. Also the honest majority
- **`reckoning: "available"`**: a model is on offer, and `reckoned` carries what it says the quantity is
  at this frame's view time. `value` is still the last real observation, never the modelled number, so a
  widget that ignores the model renders real data rather than an invented figure

`grade` says which kind of missed update a stale reading was (`held-stale`, `disconnected`,
`last-before-blackout`), and it labels the same render rather than changing it, which is why it is a
plain field and not three more arms. `reckoned` is different: it is a REQUIRED field of a member
selected by a REQUIRED discriminant, so `reading.reckoned` does not compile until you have written
`reading.reckoning === "available"`. An OPTIONAL field would compile everywhere and answer `undefined`,
and silently dropping a reckoning while the widget still looked right is precisely what this type
prevents.

A model withdraws by not being offered on the next frame, so there is no horizon field to compare
against and `reckoned` is never absent on a reading that carries it.

Here is the whole union handled once, in a helper, which is the shape to copy:

```tsx
// client/src/Reactor/index.tsx
import type { ComponentProps, Reading } from "@ksp-gonogo/sitrep-sdk";
import {
  registerComponent,
  useCommand,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Panel,
  ReadoutCaption,
  Row,
  RowName,
  Section,
  Stack,
  Unit,
  usePanelDelay,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import type { ReactorStatus } from "../__generated__/contract";
import "../topics";
import { EXAMPLE } from "../uplink";

type ReactorConfig = Record<string, never>;

/**
 * The value to draw, and what to say about its currency.
 *
 * The model is asked about FIRST, on its own axis, so a reading carrying one
 * can never fall through into a branch written for the unmodelled case. After
 * that there is one branch per `state`, and the compiler will not let you leave
 * one out, so a new state added later fails here rather than rendering blank.
 */
function present(reading: Reading<ReactorStatus>): {
  caption: string;
  status?: ReactorStatus;
} {
  if (reading.reckoning === "available") {
    // The modelled value for THIS frame, not the last observation. Draw
    // `reading.value` instead and you have declined to propagate, which is
    // legitimate and should be written as `withoutReckoning(reading)` so it
    // is greppable.
    return {
      caption: "modelled forward to this frame",
      status: reading.reckoned.value,
    };
  }
  switch (reading.state) {
    case "pending":
      return { caption: "waiting for the first sample" };
    case "unowned":
      return { caption: "no installed Uplink publishes this" };
    case "absent":
      return {
        caption: `no reactor aboard, confirmed at ${writeQuantity(reading.atUt)}`,
      };
    case "observed":
      return { caption: "live", status: reading.value };
    case "stale":
      return {
        caption: `last seen ${writeQuantity(reading.asOfUt)} (${reading.grade})`,
        status: reading.value,
      };
  }
}

export function ReactorWidget(_props: ComponentProps<ReactorConfig>) {
  const { caption, status } = present(useTelemetry("example.reactor"));
  const setOutput = useCommand("example.setOutput");
  usePanelDelay(setOutput);

  const raise = () =>
    void setOutput.send({ targetPower: 500 }, { label: "Raise output to 500 kW" });

  return (
    <Panel
      panelTitle="Reactor"
      sections={
        <Section title="Core">
          {/* `Unit` renders the null token for an absent value, so a read can
              be handed straight over without a gate of its own. */}
          <Stack gap="xs" as="ul">
            <Row>
              <RowName>Output</RowName>
              <Unit value={status?.outputPower} />
            </Row>
            <Row>
              <RowName>Core temperature</RowName>
              <Unit value={status?.coreTemp} />
            </Row>
          </Stack>
          <ReadoutCaption>{caption}</ReadoutCaption>
          <button type="button" onClick={raise} disabled={status === undefined}>
            Raise output
          </button>
        </Section>
      }
    />
  );
}

registerComponent<ReactorConfig>({
  id: "example-reactor",
  name: "Reactor",
  description: "Reactor output and core temperature, with a set-output command.",
  tags: ["telemetry", "control"],
  component: ReactorWidget,
  channels: ["example.reactor"],
  actions: [],
  defaultConfig: {},
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 3, h: 3 },
  requires: ["flight"],
  owner: EXAMPLE,
});
```

Two rules the helper encodes, worth stating separately:

- **Never assert past the union.** `useTelemetry("example.reactor") as ReactorStatus | undefined`
  compiles and is a lie the compiler cannot see in either direction: every read then answers `undefined`
  forever and the widget says "no reading" for the rest of the mission. A cast is a stronger blind spot
  than `unknown`, because someone chose it
- **A judgement is withheld, not held.** A go/no-go, a band, a coloured pill: the operator reads those
  as the situation NOW, and a judgement cannot be dated. Draw those from `observed`, or from a reading
  whose `reckoning` is `"available"` so the figure really is for this frame, and say nothing on a plain
  `stale`. A stale GO is the worst thing a widget can draw

`hasAnswered(reading)` collapses the arms to a boolean for the narrow case of a presence gate, where the
question is "should the gate be open" rather than "what should I say". Do not reach for it in a widget
that renders something to a user: `pending` may become true on the next frame and `unowned` never will,
and the two want opposite words on screen.

### Firing a Command

`useCommand(command)` returns a handle. `send(args, opts)` dispatches:

```tsx
// client/src/Reactor/Controls.tsx
import { useCommand } from "@ksp-gonogo/sitrep-sdk";
import { CommandDelay, usePanelDelay } from "@ksp-gonogo/ui-kit";

export function ReactorControls({ targetPower }: { targetPower: number }) {
  const setOutput = useCommand("example.setOutput");

  // A delayed command owes the operator its delay UX. `usePanelDelay` hands
  // this command's delay state to the surrounding Panel's rail, which is the
  // normal way; `<CommandDelay>` renders it inline where there is no Panel.
  usePanelDelay(setOutput);

  return (
    <>
      <button
        type="button"
        // `send` takes your args object, and a `label` that names the dispatch
        // in the in-flight list an operator watches.
        onClick={() =>
          void setOutput.send(
            { targetPower },
            { label: `Set output to ${targetPower} kW` },
          )
        }
        // `status` is a discriminated union, not a string: branch on `phase`.
        disabled={setOutput.status.phase === "in-flight"}
      >
        Set output
      </button>
      {setOutput.refusals.map((refusal) => (
        <p key={refusal.id}>
          {/* `detail` is the refusal in the GAME's own words when it had any,
              and `errorCode` is the machine-readable half. Never parse either. */}
          {refusal.detail ?? refusal.errorCode}{" "}
          <button type="button" onClick={() => setOutput.dismiss(refusal.id)}>
            dismiss
          </button>
        </p>
      ))}
      <CommandDelay handle={setOutput} />
    </>
  );
}
```

The handle carries more than `send`:

| field | what it is |
| --- | --- |
| `status` | this command's lifecycle, as a union on `phase`: `idle`, `in-flight`, `confirmed`, `failed`, `refused`, `lost` |
| `inFlight` | the dispatches still travelling, each with its reach and reply ETAs |
| `refusals` | dispatches the GAME refused, until dismissed. Different from a rejection: a refusal never left |
| `gate` | what the mod says about this command in ADVANCE, or `undefined` when nothing is known |
| `effectiveDelaySeconds` | the one-way delay under the current vantage, 0 for instant |
| `shape` | which delay display this command uses; hand it straight to `<CommandDelay>` |
| `dismiss(id)` | clear a dead dispatch or a refusal, the manual out for anything that would sit forever |

### Register your commands, and `send` gets typed

`useCommand` is keyed on `CommandId` exactly as `useTelemetry` is on `TopicId`, so a command the SDK
knows resolves its own args and its own reply. Your commands are yours, so you register them the same
way you register your Topics, in a file beside `topics.ts`:

```ts
// client/src/commands.ts
import { registerUplinkCommand } from "@ksp-gonogo/sitrep-sdk";
import {
  GENERATED_COMMAND_IDS,
  type GeneratedCommandArgsMap,
  type GeneratedCommandReplyMap,
} from "./__generated__/command-map";

// The TYPE half, the write-side twin of the `TopicPayloadMap` merge above.
declare module "@ksp-gonogo/sitrep-sdk" {
  interface CommandArgsMap extends GeneratedCommandArgsMap {}
  interface CommandReplyMap extends GeneratedCommandReplyMap {}
}

// The RUNTIME half: which command ids exist, so `isCommandId` and
// `getAllKnownCommandIds` can see them.
for (const id of GENERATED_COMMAND_IDS) {
  registerUplinkCommand(id);
}

// Something NAMED for `index.ts` to re-export, so the augmentation above
// survives into `dist/index.d.ts`. See the paragraph below.
export const UPLINK_COMMAND_IDS = GENERATED_COMMAND_IDS;
```

Both halves come off the generated map rather than a list written here, so a command you add to your
contract later needs no new line. **Re-export something NAMED from this module** in
`client/src/index.ts` (`export { UPLINK_COMMAND_IDS } from "./commands";`), for the same reason
`topics.ts` is re-exported: a bare `import "./commands"` is elided from the emitted
`dist/index.d.ts`, so the `declare module` augmentation never crosses the package boundary and every
consumer resolves your commands to the bare envelope. Export a constant, as above, if the module has
nothing else to give.

What fills the map is the `[SitrepCommand]` attribute on your args class, which is the one already on
`SetOutputArgs` in "Put the wire types in their own project" above. One args class can carry several
tags where one shape serves several commands. `Payload = typeof(T)` names the `T` a handler answers
with as `CommandResult<T>` (`CommandResultOf<T>` on the TypeScript side); leave it off and the
command resolves a bare `CommandResult`, which is success or nothing more. `Result = typeof(T)` is
the sibling that names the resolved type outright rather than wrapping it, and setting both throws.
A command that takes no arguments carries its tag on an empty marker class of your own, the way a
no-payload DTO already works.

A command id you have NOT registered still dispatches: it falls to `useCommand`'s untyped overload,
where `args` is `unknown` unless you name it. The reply is not: it stays `AnyCommandReply`, the result
envelope every command answers with, so even a command nobody could name is not readable as though it
were its own payload. That overload is the escape hatch for a DYNAMIC command whose id is computed per
subject and so can have no static member:

```ts
import { useCommand } from "@ksp-gonogo/sitrep-sdk";

declare const probeId: string;

const reset = useCommand<{ id: string }>(`example.probe.${probeId}.reset`);
```

**A resolved reply is always a command that ran.** The game refusing is a REJECTION carrying a
`CommandErrorCode`, and it also lands on `refusals` above, so `CommandResult` in the reply position
never means "said no quietly".

**Passing a handle down: write `UseCommandResultFor`, not `UseCommandResult`.** The place a handle
loses its types is the annotation it travels through, and a prop typed bare gets the envelope floor
and nothing more. A widget that types its control but not the prop it reaches that control through
has typed nothing:

```ts
import type { UseCommandResultFor } from "@ksp-gonogo/sitrep-sdk";

// One id, or a union of ids that answer alike.
type SetOutputHandle = UseCommandResultFor<"example.setOutput">;
```

Both halves come off the command map, so `send` takes that command's args and `<CommandButton>`'s
`onConfirmed` receives its reply, one row deep or ten.

### Sharing a derivation with other Uplinks

A **Processor** is a declared pure function of Topics, evaluated once per Sitrep frame however many
widgets read it. Your client registers one through its handle, and reads it back with `useProcessor`:

```ts
// client/src/processor.ts
import { useProcessor } from "@ksp-gonogo/sitrep-sdk";
import type { ReactorStatus } from "./__generated__/contract";
import "./topics";
import { EXAMPLE } from "./uplink";

export interface ThermalSummary {
  overTemp: boolean;
}

export const THERMAL_SUMMARY = EXAMPLE.registerProcessor({
  id: "thermal-summary", // registers as "example:thermal-summary"
  deps: ["example.reactor"] as const,
  // `deps` is `as const`, so `reactor` is typed off it: no annotation, and a
  // Topic added to `deps` widens the tuple rather than needing one written out.
  compute: ([reactor]): ThermalSummary => ({
    overTemp: (reactor?.coreTemp?.magnitude ?? 0) > 1200,
  }),
});

// Your own widgets import the handle and read the result off its brand.
export function useThermalSummary(): ThermalSummary | undefined {
  return useProcessor(THERMAL_SUMMARY);
}
```

That handle is how a consumer gets the RESULT TYPE, because `useProcessor` reads it off the handle's
brand. Which decides who can consume it:

- **Your own widgets**: import the handle, nothing else needed
- **Anything in the app** (a first-party widget, the shared SDK derivations): already works
- **Another Uplink**: not by importing your handle. Your client is not a published package, so nobody
  outside it can install or typecheck against it, and there is nothing to import. That is the isolation
  rule doing its job, not a gap: an Uplink that reached into another one would break, with no compile-time
  signal at all, the moment a user uninstalled the mod behind it

There is no registry trick that gets round this. A `declare module` augmentation is scoped to a
TypeScript **program**, and another Uplink's program can never include your declaration file, so keying a
registry by processor id moves the problem without solving it. Topics have exactly the same limit: an
Uplink cannot type another Uplink's Topic either.

**So if you want your derivation consumable by an Uplink you have never met, the contract has to live in
the SDK.** `defineProcessorContract` is that split: the id and the result type published from
`@ksp-gonogo/sitrep-sdk`, where every Uplink already compiles against them, and the implementation
registered by whichever client owns the mod it derives from.

```text
// in @ksp-gonogo/sitrep-sdk, beside the result type it names
export interface ThermalSummary { overTemp: boolean }
export const THERMAL_SUMMARY =
  defineProcessorContract<ThermalSummary>("example:thermal-summary");

// in YOUR client: import the type you must satisfy, register the derivation
EXAMPLE.registerProcessor({ id: "thermal-summary", deps, compute });

// in ANY other Uplink: imports the SDK, and neither your package nor your types
const thermal = useProcessor(THERMAL_SUMMARY);   // ThermalSummary | undefined
```

The id must be owner-stamped (`<owner>:<id>`), matching what `registerProcessor` stamps; an unstamped one
throws, because a handle that silently answers `undefined` forever is indistinguishable from the mod not
being installed. And that is what absence looks like: no implementation registered means `undefined`,
which every consumer already handles because it is also what `useProcessor` answers before the first
frame. Nothing crashes when the mod is missing.

Getting a contract into the SDK is a conversation, not a code change you make alone: open an issue. In the
meantime, the mechanism that already composes across Uplinks with no coordination at all is a
**contribution**, where the HOST declares the slot and its entry type and any number of Uplinks feed it.

**One more thing your `compute` owes.** The evaluator only wakes a processor's consumers when the result
actually changed, and it decides that by comparing the result structurally. So return **data**: numbers,
strings, arrays, plain objects, and `Value`s (or your own wrapper in the same style, a data object over a
methods-only prototype). A `Map`, a `Date`, a class that keeps its state behind a getter, or a function in
the payload cannot be compared, so every consumer is woken on every frame. That is not silent: it counts
against the `Processor uncomparable results/sec` budget, whose threshold is zero, and logs a warning
naming your processor and the shape.

### Putting your UI inside somebody else's widget: slots

A **slot** is an addressable place in a widget where another package may render. Two kinds, and the
difference is what you hand over:

- an **augment** is a React component. `registerAugment` binds it to a slot id and `<AugmentSlot>` is
  what the owning widget mounts
- a **contribution** is pure data. The host declares the slot and its entry type, and renders every
  contributed entry itself, so several Uplinks composing into one slot cannot fight over layout

**Every widget has three slots you did not have to ask for**, mounted by `Panel` rather than by the
widget: `<componentId>.sections` and `<componentId>.actions` (augments) and `<componentId>.badges` (a
contribution slot). So an Uplink can add a body section or a header action to any widget in the app,
including one whose author never declared a slot, and this is usually the answer when a widget looks
like it needs a slot ADDED to it.

Beyond those, the first-party widgets declare forty named slots (thirty-three augment, seven
contribution), and the catalogue is the type rather than a list in a document: `SlotId` is the union of
every declared augment id and `SlotProps<S>` the props one hands its augment, `ContributionSlotId` and
`ContributionEntry<S>` the same for the data kind, all from `@ksp-gonogo/sitrep-sdk`. Autocomplete on
the slot id is the enumeration, and it is current by construction where a prose list would go stale.

A slot id not in the registry falls back to a loose props bag rather than failing, so a typo costs you
a silent no-render rather than a compile error. Read the id off the completion list.

To own a slot in YOUR widget, declare it in the registration (`augmentSlots` or `contributionSlots`),
merge its props type into `SlotRegistry` from your own client, and mount `<AugmentSlot>` where it goes.
Declare a given id as one kind or the other, never both.

**`AugmentSlot`, `registerAugment`, `getAugmentsForSlot` and `clearAugments` are exported from BOTH
published packages, and they are not the same function.** Import them from
**`@ksp-gonogo/sitrep-sdk`**. The SDK's are shims that resolve through the host the app installs, which
is the single registry the running app reads and the one your test's `installRealTestHost` wires up.
ui-kit's are the implementation the host is built FROM, so registering through those in a test leaves
you observing a registry the app never consults, and nothing about the call looks wrong. It is the
sharpest instance of a dozen names the two barrels share; `registerUnit` is the other, and that one is
covered under "The two seams" below.

`ContributionsProvider`, by contrast, is ui-kit's directly and is not shimmed, because the aggregation
lives beside the per-widget store it writes. Import that one from ui-kit.

### Wire the side-effect entry point

`client/src/index.ts` is the entry the app loads, and it has two jobs that want two different forms.

Most registration happens as a side effect of import, so those stay **bare imports** (never let a
bundler tree-shake them away). The two modules carrying a `declare module` augmentation are the
exception: a bare import is elided from the emitted `dist/index.d.ts`, so `topics.ts` and
`commands.ts` are **re-exported by name** instead. Miss that and everything still runs, while every
consumer resolves your Topics to `unknown` and your commands to the bare envelope.

```ts
// client/src/index.ts
import "./uplink"; // defineUplinkClient(EXAMPLE) runs first
import "./units"; // registerUnit on both seams, before anything renders
import "./Presence"; // registerComponent(... owner: EXAMPLE)
import "./Reactor"; // ditto

// Named re-exports, NOT bare imports: these two carry the `declare module`
// augmentations, and only an export carries one across the package boundary.
export { UPLINK_COMMAND_IDS } from "./commands";
export * from "./topics";
```

---

## The one version line and the compat gate

An Uplink has **one version** spanning both halves. You never hand-write the compatibility numbers: a
build step generates `gonogo-uplink.json`, the sidecar manifest that ships next to your client bundle.
Its shape:

```json
{
  "id": "example",
  "name": "Example Uplink",
  "description": "Reactor output, core temperature and throughput, from the example mod.",
  "author": "you",
  "repo": "https://github.com/you/example-uplink",
  "version": "0.1.0",
  "minAppVersion": "1.0.0",
  "apiVersion": "1.0.0",
  "uiKitVersion": "0.2.0",
  "contractMajor": 14,
  "contractMinor": 5,
  "bundleUrl": "example/example.client.js",
  "integrity": "sha256-2b1f...",
  "sdkVersion": "0.0.1"
}
```

**`gonogo-uplink docs` and `gonogo-uplink bundle` write the same file.** One is generated beside your
client for review, the other beside the bundle you distribute, and they are byte-identical for the same
Uplink: both call one writer in the SDK. That was not always true, and the two shapes it produced were
the reason this section had to say which one the loader honours.

- **`name`**, **`author`** and **`repo`** are facts about the Uplink as a DISTRIBUTION, declared in
  `uplink.json` (see "Distribution"). An Uplink with no `uplink.json` falls back to the name its client
  registers, and carries empty strings for the other two rather than an invented author
- **`description`** is what you declared on `defineUplinkClient`, and it is the subtitle on your
  generated README
- **`apiVersion`** pins the `@ksp-gonogo/sitrep-sdk` authoring surface you built against
  (`EXTENSION_API_VERSION`)
- **`uiKitVersion`** pins the `@ksp-gonogo/ui-kit` design-system surface (`UI_KIT_VERSION`)
- **`contractMajor`/`contractMinor`** pin the telemetry contract your Topics and Commands speak
- **`minAppVersion`** is an advisory floor, and the one field nothing can derive, because it is a claim
  about the APP rather than about your code. Declare it in `uplink.json`, or in your `package.json`
  under `"gonogo": { "minAppVersion": "1.4.0" }` when you have no `uplink.json`
- **`bundleUrl`** is where your bundle sits RELATIVE to this file, which is all either command can
  honestly say: the loader finds the manifest by stripping the last segment off the bundle's own URL
- **`integrity`** is `sha256-` plus the hex sha256 of the file you DISTRIBUTE
- **`sdkVersion`** is the version of the tool that wrote the file

Everything else is read out of the bundle the tool just loaded, so the manifest describes the code it
came from. `integrity` is the exception, because the tool cannot guess which file you ship: pass
`--bundle <path>` when you generate for a release. Without it the field is written empty, the run warns
you, and the app will quarantine the Uplink with an integrity mismatch. That is correct for a working
copy, which is why every `gonogo-uplink.json` checked into this repo carries `""`.

At load time the app runs `checkUplinkCompat(manifest, app)` and gets one of three verdicts:

- **`load`** compatible, proceed
- **`refuse`** a hard mismatch (an `apiVersion`, `uiKitVersion`, or contract major/minor the app can't
  honour); the Uplink is quarantined with the exact reason shown in the in-app Uplinks list
- **`warn-load`** the only soft case: the app is older than `minAppVersion`, logged but still loaded

Build these numbers, never type them. The mod side bakes its matching client hash the same way:

```bash
gonogo-uplink bake-hash \
  --bundle ExampleUplink/client/dist/example/example.client.js \
  --out ExampleUplink/Generated/ExpectedClientHash.g.cs \
  --namespace Example.Generated
```

That writes an `internal static class ExpectedClientHash` with one `Value` constant, which is what
your `UplinkManifest.ExpectedClientHash` reads (see Part 1), so the running mod can vouch for the
exact bundle it expects. Hash the bundle you actually publish: a hash of a differently-built copy is
one the loader can never match, and it fails as tampering rather than as a bad build. (The Uplinks bundled with
this repo take `pnpm --filter @ksp-gonogo/app bake-uplink-hash <UplinkId>` instead, because their bundle
is emitted by the app's own build rather than by their author.)

---

## The externals rule (do not skip this)

Import from **`@ksp-gonogo/sitrep-sdk`** and **`@ksp-gonogo/ui-kit`**. They are the
two packages gonogo publishes for RUNTIME, and between them they carry the whole
authoring surface: the hooks, every `registerX`, the generated contract, the unit
system and the design system.

Nothing else in the gonogo repo is importable. `core`, `components`, `data`, `ui`,
`sitrep-client` and `logger` are private and unpublished, so an outside author cannot
install or build against them, and `@ksp-gonogo/ui` and `@ksp-gonogo/ui-kit` are
different packages. The app's baked import map resolves fifteen specifiers at runtime,
those six included, and that is not a licence to import them: it fixes runtime
resolution for first-party code and does nothing for building yours. The rule is
`docs/uplink-isolation.md`, and there is no first-party exemption.

The subpath list is exhaustive, and the sdk publishes subpaths that are not on it.
Yours are **`/frames`** (reference-frame arithmetic), **`/media`** (see below) and
**`/testing`**. `@ksp-gonogo/sitrep-sdk/spine` and `/registry` appear in the
package's `exports` with exactly the same weight and are NOT author surfaces:
`/spine` is where the read semantics, the timeline store and every hook the root
barrel shims are implemented, and `/registry` is dashboard orchestration.
ui-kit's are `/testing`, `/guards`, `/render-probe`, `/render`, `/page-check` and
`/tokens.css`.

Each package's `/testing` is for your tests and never for your widgets. There is no
third package: `@ksp-gonogo/sitrep-testing` used to be one and was deleted once the
spine came down into the SDK, so anything that names it is out of date.

A camera Uplink also gets **`@ksp-gonogo/sitrep-sdk/media`**, a subpath of the same
package: the delayed-playout buffer, the per-frame pipeline and the shared
per-camera stream cache, all riding the one delay authority telemetry reads. It is
a subpath rather than part of the root barrel because it pulls WebCodecs and Worker
machinery a telemetry-only Uplink has no use for, so importing the root never
loads it. Externalise it as its own specifier: the app's import map is keyed on
exact strings, and externalising `@ksp-gonogo/sitrep-sdk` does not cover a subpath
of it. esbuild externalises a subpath of an externalised package NAME, so a
missing import-map entry survives typecheck and the build itself and throws at
`import(bundleUrl)`. `gonogo-uplink bundle` checks the emitted bytes for exactly
this and fails the build.

Build your client bundle **external-expecting**. Declare `react`,
`styled-components` and the two gonogo packages as externals/peer dependencies,
and do NOT bundle your own copies.

```jsonc
// client/package.json (shape)
"peerDependencies": { "react": "^18.0.0" },
"dependencies": {
  "@ksp-gonogo/ui-kit": "^0.2.0",
  "styled-components": "^6.0.0"
},
"devDependencies": {
  // The sdk is a devDependency because nothing of it survives into your bundle:
  // it is externalised, and the host supplies the singleton at runtime. Put it
  // in `dependencies` instead and a consumer installs a second copy for nothing.
  "@ksp-gonogo/sitrep-sdk": "^0.1.0",
  // esbuild is the bundler `gonogo-uplink bundle` calls, resolved from YOUR
  // client so a pinned version is the one used. playwright and the font are the
  // render harness's optional peers.
  "esbuild": "^0.28.0",
  "playwright": "^1.60.0",
  "@fontsource/jetbrains-mono": "^5.2.8",
  "react": "^18.0.0",
  "react-dom": "^18.0.0",
  "typescript": "^5.0.0",
  "vitest": "^4.1.4"
}
```

Why this is not optional: the loader runs `import(bundleUrl)` and the host resolves
your bare imports to its own singletons. Bundle a second copy of React and you get
two Reacts, so hooks break. Bundle a second copy of the SDK and your
`registerComponent` calls land somewhere the dashboard never reads, so your widgets
never appear.

---

## Distribution

Decentralised by design: you own the repo and you host the bundle. There is no central hub.

- Publish your **mod** through CKAN like any KSP mod
- Host your **client bundle** yourself (a static host, a release asset, your own server)
- **Your MOD declares where it lives.** `UplinkManifest.ClientSource.Url` is the bundle URL and
  `UplinkManifest.ExpectedClientHash` is the sha256 the bytes must match, both shown in Part 1. They
  ride the live `system.uplinks` roster on `clientSource` and `expectedClientHash`, and the app builds
  its loader descriptor from them plus the sidecar manifest it fetches beside the bundle. There is
  nothing to register anywhere: an Uplink whose mod is installed and declares a `ClientSource` is an
  Uplink the app will offer to load
- `ClientSource.DevPath` is an optional local override the loader PREFERS when present: point it at a
  `http://localhost:PORT` build you are serving while iterating, and leave it null in a release

`gonogo-uplink bundle` builds the file you distribute. It reads an `uplink.json` sitting beside both
halves (searched up to three levels above the client), which is where the facts about the Uplink as a
DISTRIBUTION live, as opposed to the facts about its code:

```json
{
  "id": "example",
  "name": "Example Uplink",
  "author": "you",
  "repo": "https://github.com/you/example-uplink",
  "minAppVersion": "1.0.0"
}
```

`gonogo-uplink docs` reads the same file, from the same search, so the manifest it writes beside your
client and the one `bundle` writes beside your bundle agree field for field.

The command emits `dist/<id>/<id>.client.js`, its `.sha256`, and a `gonogo-uplink.json` beside it. Each
Uplink gets its own directory because the loader derives the sidecar's URL from the bundle's own, by
stripping the last path segment: publish two Uplinks into one flat directory and they share one sidecar
path, and the last one written wins.

**What decides which Uplinks load:** the live `system.uplinks` roster the running mod publishes, and
nothing else. The app carries no list of Uplink names, not even for the ones that ship with it, so your
Uplink reaches the loader on exactly the same path a first-party one does. With no mod talking (an app
opened before KSP, or a dev session with no game running) nothing is attempted, because nothing has said
what is installed; `?uplinkLoaderIds=a,b` names ids by hand for that case.

The load sequence the app runs for each Uplink:

1. build the descriptor: for a third-party Uplink that means `clientSource` and `expectedClientHash`
   off the roster entry, plus the `gonogo-uplink.json` sidecar fetched beside the bundle, which is
   where the version and every compat number come from
2. run the compat gate + the mod-hash gate **before fetching any bytes** (import is irreversible, so
   nothing is fetched for an Uplink that will be refused)
3. ask for **consent** on first load of a given `id@version` (a remembered grant short-circuits next time)
4. fetch the bundle bytes
5. verify `sha256(bytes)` against the descriptor's `integrity`. For a first-party Uplink that is a
   three-way agreement (mod, index, bytes); a third-party id has no index entry, so your mod's own
   `ExpectedClientHash` IS the `integrity` and the check is mod against bytes. Still a real hash
   gate, and the one thing no override can be granted past
6. `import()` the bundle, which runs its `registerComponent(...)` calls against the host

Every refusal quarantines the Uplink with a legible reason in the in-app Uplinks list. There are no silent
loads and no silent no-ops. Note one hard requirement: integrity verification uses `crypto.subtle`, which
browsers only expose on a **secure origin**, so the gonogo main screen must be served over **https or
localhost**, not a bare LAN IP.

---

## The local dev loop

You will not want to publish a bundle to a public URL on every edit, and today you do not have to
publish one at all to see your widget: **the tests are the loop.**
`setupStreamFixture` stands up the real telemetry client, timeline store and view clock, and
`renderWidget` mounts your widget in the same provider stack the dashboard puts around one, so a
render there is the render the app performs. `gonogo-uplink render` then photographs the same fixtures
through a real browser. See "Testing your Uplink" below; that is the whole of the fast loop, and it
needs no game running.

Pointing a running app at a LOCAL bundle does work: set `ClientSource.DevPath` on your mod's manifest
to a `http://localhost:PORT` URL and the loader prefers it over `Url`. What is NOT built is making that
loop fast. For a third-party Uplink the hash your MOD vouches for is the only trust anchor there is,
so the integrity gate compares the fetched bytes against it and nothing can be loaded past that. Each
edit therefore costs a `gonogo-uplink bundle`, a `bake-hash`, a mod rebuild and a page reload. It is
a way to see your widget in a real dashboard, not a way to iterate in one.

(The first-party workflow, importing the client as a workspace package into the app build for an HMR
loop, is not available to you and is not meant to be: it requires being inside this repo, which is
exactly the position an Uplink author is not in.)

---

## Testing your Uplink

The harness is two subpaths of the two packages you already have:
**`@ksp-gonogo/sitrep-sdk/testing`** for the host, the spine and the stream
fixture, and **`@ksp-gonogo/ui-kit/testing`** for the provider stack a widget is
mounted in and the readout assertions. They deliberately do not re-export each
other: a host and a provider stack are genuinely two things, and your setup names
both.

Your widgets call SDK hooks (`useTelemetry`, `useCommand`), and those
are shims that resolve through the host the app installs at boot. A unit test has no
app, so it has to install one:

```ts
// client/src/test/setup.ts
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
import { type UnitMatchers, unitMatchers } from "@ksp-gonogo/ui-kit/testing";
import { expect } from "vitest";
// Brings `toBeInTheDocument` and its siblings, as TYPES as well as matchers, so
// leaving it out fails the typecheck rather than the test.
import "@testing-library/jest-dom";

installDomStubs(); // jsdom gaps: ResizeObserver, canvas, matchMedia
PerfBudget.installTestGate(); // fail a test that pushes a budget over its cap
setQuantityLocale("en-GB"); // so a render is reproducible off your machine

// The quantity matcher, registered once. The type half is a merge you write
// yourself: importing the module never changes anyone's `expect` types without
// them asking for it.
expect.extend(unitMatchers);
declare module "vitest" {
  interface Assertion<T> extends UnitMatchers<T> {}
}

// The four augment members come from ui-kit because that is where the augment
// registry and `<AugmentSlot>` live, and ui-kit imports the SDK, so the SDK
// cannot import them back. Everything else in the host is the SDK's own.
installRealTestHost({
  AugmentSlot,
  clearAugments,
  getAugmentsForSlot,
  registerAugment,
});
```

You cannot write `installRealTestHost` yourself, and it is worth knowing why: the
implementations behind the shims are the ones the app installs, and passing a shim
back in as its own implementation is infinite recursion rather than a bridge. That
is the single thing you are being handed here.

### Running a widget off the real stream

`setupStreamFixture` builds a real `TelemetryClient` / `TimelineStore` / `ViewClock`
behind a `TelemetryProvider`, and you emit frames by hand. It is the same pipeline
the app runs, not a stand-in, so a test that passes here is evidence about the
stream and not about a mock of it.

```tsx
// client/src/Reactor/index.test.tsx
import { value } from "@ksp-gonogo/sitrep-sdk";
import { setupStreamFixture, waitFor } from "@ksp-gonogo/sitrep-sdk/testing";
import { renderWidget } from "@ksp-gonogo/ui-kit/testing";
import { expect, it } from "vitest";
import "./index";

it("shows the reactor's output once a frame arrives", async () => {
  const fixture = setupStreamFixture({
    carriedChannels: ["example.reactor"], // required: nothing is promoted silently
    pinnedUt: 1000, // omit to leave the clock live
  });

  // `renderWidget` takes the REGISTERED ID, not the element, and mounts the
  // widget in the dashboard's provider stack. `wrapper` goes OUTSIDE that
  // stack, which is where the app mounts the equivalent.
  renderWidget("example-reactor", { wrapper: fixture.Provider });

  await waitFor(() => expect(fixture.transport.isSubscribed("example.reactor")).toBe(true));
  // `magnitude` is denominated in the unit the token names: this is 420 kW.
  fixture.emit("example.reactor", { outputPower: { magnitude: 420, unit: "kW" } });

  // Not `getByText`: a `<Unit>` readout is several elements, never one text
  // node. See "Testing it" under Showing a quantity.
  await waitFor(() => expect(document.body).toShowQuantity(value("kW", 420)));
});
```

Two things that surprise everyone once:

- **`emit` is subscription-gated.** A frame nothing has subscribed to yet is
  dropped, exactly as in production, which is why the test above waits for the
  subscription before emitting
- **`delaySeconds` and `pinnedUt` are mutually exclusive.** A pinned clock wins
  outright over the delay computation, which makes `delaySeconds` a silent no-op.
  To test delay, leave the clock live and drive it with
  `fixture.wall.advanceBy(seconds)` plus `fixture.store.beginFrame()`

### `render`, and the theme

`render` and `renderHook` come from `@ksp-gonogo/sitrep-sdk/testing` and they mount
the kit's theme for you. Every `@ksp-gonogo/ui-kit` primitive reads
`theme.space[...]` off the styled-components context, and with no provider that is a
TypeError rather than a fallback. Everything else Testing Library offers
(`screen`, `waitFor`, `within`, `act`, `fireEvent`) is re-exported unchanged, so
this is a drop-in for the import source.

For a widget rather than a plain component, `renderWidget` from
`@ksp-gonogo/ui-kit/testing` mounts it inside the same provider stack the dashboard
puts around one, which is what the stream-fixture test above uses. A widget
rendered bare is a widget the app never runs: `Panel` reads its stream status off a
provider, so with none mounted the status badge never appears and a `waitFor` on it
returns having proved nothing.

It takes the REGISTERED ID rather than the element, so the module that calls
`registerComponent` has to have been imported:

```text
renderWidget(widgetId: string, options?: {
  instanceId?: string;   // what the widget sees as its own `id` prop
  config?: Record<string, unknown>;  // its per-instance config
  w?: number; h?: number;            // grid units, for a responsive widget
  onConfigChange?: (config: Record<string, unknown>) => void;
  wrapper?: (props: { children: ReactNode }) => JSX.Element;
}): RenderResult
```

`wrapper` mounts OUTSIDE the dashboard stack, which is where the app mounts the
equivalent: a stream fixture's `Provider` belongs above the widget host, because
the host's own hooks read telemetry through it.

Include the accessibility smoke assertion in a widget's test, through the helper
rather than by hand: `await expectNoA11yViolations(container)` from
`@ksp-gonogo/ui-kit/testing`. A hand-rolled `await axe(container)` walks the DOM
asynchronously while a live widget keeps updating, and every one of those updates
lands outside `act`.

### Screenshots and your README

`gonogo-uplink render` and `gonogo-uplink docs` turn your fixtures into images and
your registrations into a page, and `docs --check` keeps that page from going
stale. See **[docs/uplink-rendering.md](./uplink-rendering.md)**: it is the same
harness your unit tests use, driven through a real browser.

There is exactly one of it. If it cannot photograph something your Uplink does,
that is a gap in the tool and it gets filled there rather than in a driver of
your own: a fixture nothing renders and a harness only you can run are the two
ways a widget ends up shipping with no picture of it.

---

## Giving your widget a body: `sections`, not children

A dashboard tile is any shape the operator drags it to. A widget that composes
its own body cannot know which shape it got, so it runs everything down one
column and wastes the width of a landscape tile. `Panel` does know, so the
decision belongs to it.

Pass your body as `sections` and close the tag:

```tsx
// client/src/Reactor/Body.tsx
import { Panel, Row, RowName, Section, Stack, Unit } from "@ksp-gonogo/ui-kit";
import type { ReactorStatus } from "../__generated__/contract";

export function ReactorBody({ status }: { status?: ReactorStatus }) {
  return (
    <Panel
      panelTitle="REACTOR"
      sections={[
        <Section key="core" title="Core">
          <Stack gap="xs" as="ul">
            <Row>
              <RowName>Temperature</RowName>
              <Unit value={status?.coreTemp} />
            </Row>
          </Stack>
        </Section>,
        <Section key="output" title="Output">
          <Stack gap="xs" as="ul">
            <Row>
              <RowName>Power</RowName>
              <Unit value={status?.outputPower} />
            </Row>
          </Stack>
        </Section>,
      ]}
    />
  );
}
```

Those two sections stack in a narrow tile and sit side by side in a wide one,
with your widget saying nothing about either. `Section` renders its own `title`
as a real `h4` under the panel's `h3`, so you stop hand-rolling the heading.
`Row` defaults to an `<li>`, so give it a list parent (`<Stack as="ul">`), and
`RowName` is the truncating label child.

Three things worth knowing:

- **one section costs nothing.** `sections={<Section>...</Section>}` is the normal
  way to write a widget whose body is a single list, and it is not an abuse of
  the prop
- **`full` spans every column.** For the section a wide layout should not put
  beside another: a summary strip the columns below it belong to, or a table
  whose columns are already its own
- **`sectionMinWidth` tunes the threshold.** Raise it for sections with long
  rows; set it to `100%` for a widget that should never columnise

Children instead of `sections` is the retiring form, and a shrink-only ratchet
in this repo will fail a new one. The single exception is a widget that is
WHOLLY a drawing, a map or a globe, which passes `floatingHeader` and keeps its
children: its content is the panel rather than a section of it.

---

## Showing a quantity, and testing that you did

Every number your Topic declares a unit for arrives as a `Value`: an object
carrying the magnitude AND the unit, not a bare number.

**`magnitude` is denominated in the unit the token names, always.** A value whose
unit is `"kW"` holds kilowatts, so `{ magnitude: 420, unit: "kW" }` is 420 kW and
`{ magnitude: 420, unit: "W" }` is 420 watts, and the two are the same quantity
only if one of them is wrong. What the ladder does is separate: it converts to
the family's base to pick a RUNG, which is why `value("W", 12400)` renders
"12.4 kW". Get this the wrong way round in a fixture and every number in your
tests is off by the unit's ratio, while still looking right.

Render one with `<Unit>` and name neither half:

```tsx
// client/src/Reactor/Readout.tsx
import { Unit } from "@ksp-gonogo/ui-kit";
import type { ReactorStatus } from "../__generated__/contract";

export function Readout({ status }: { status?: ReactorStatus }) {
  // Renders "12.4 kW", or the null token when the value is absent, so a read
  // can be handed straight over.
  return <Unit value={status?.outputPower} />;
}
```

That is the whole surface. The kit picks the ladder rung, the symbol, and how
the value is announced to a screen reader, so a change to any of those reaches
your widget without you editing it. **Do not format a quantity yourself.** A
hand-written `` `${x.magnitude / 1000} km` `` pins the rung, loses the styling,
and is read aloud as the letters "k", "m".

Two escapes exist for the places a React node cannot go, both from
`@ksp-gonogo/ui-kit`: `speakQuantity` for an accessible name or a `title`, and
`writeQuantity` for visible text that is MEASURED, such as an SVG `<text>` or a
canvas label.

### Declaring your own units

Your mod half annotates its contract as shown in "Getting your contract into your
client": `[SitrepUnit("kW")]` on the property, and a token the core catalog has
never heard of is fine, because the generated `SitrepUnit` union is open.
`UnitDescriptor.ToJson(typeof(ReactorStatus).Assembly)` gives you the matching
descriptor, the same document the mod serves on `system.units`.

#### Your own catalog

Declare the tokens you introduce in a public static class in your contract
project **whose name ends in `Units`**. Codegen judges your assembly against
core's catalog PLUS yours, so an undeclared token stops the build instead of
reaching the client as an opaque symbol with no dimension and no ladder. There
is no first-party exemption: the rule that applies to the Uplinks shipped in
this repo is the one that applies to yours.

Name it for your Uplink rather than calling it `Units` outright. A class named
exactly `Units` in the same namespace as your payloads SHADOWS
`Sitrep.Contract.Units`, so `[SitrepUnit(Units.Flag)]` on the type next door
stops resolving the moment you add one, with an error that reads like a missing
`using`. The catalog scan accepts either name for exactly this reason.

```csharp
namespace ExampleUplink.Contract
{
    public static class ExampleUnits
    {
        public const string ThermalUnits = "thermalUnits";
    }
}
```

A compound counts as declared when both halves are: `MB/s` passes once `MB` and
`s` do, so a rate does not need its own constant per rung.

#### The two seams

A unit has two independent halves, and they live in different packages because
they answer different questions.

```ts
// client/src/units.ts
import { registerUnit } from "@ksp-gonogo/sitrep-sdk";
import { registerUnit as registerDisplayUnit } from "@ksp-gonogo/ui-kit";

// MODEL: what it IS. Dimension and ratio are what make values add up, and are
// all the SDK needs. Dimension onto an EXISTING base where one fits (`bit`,
// `m`, `s`) rather than inventing a private axis, or your quantity becomes an
// island nothing else can convert with.
registerUnit({ symbol: "MB", kind: "data", dimension: { bit: 1 }, ratio: 8e6 });

// DISPLAY: how it READS. Which rung a value lands on is the kit's business.
registerDisplayUnit({
  symbol: "MB",
  kind: "data",
  family: "bytes",
  ladder: [
    { from: 8, symbol: "B", per: 8 },
    { from: 8e3, symbol: "kB", per: 8e3 },
    { from: 8e6, symbol: "MB", per: 8e6 },
  ],
});

// A token that names a category rather than a scale needs a display half only,
// with no ladder. Until you register anything, the value still renders, bare
// and unscaled.
registerDisplayUnit({ symbol: "thermalUnits", kind: "count" });
```

The two are different functions with the same name, in the two packages you must
import, so alias one at the import as above. It is the sharpest of a dozen names
the two barrels share.

#### Families, and sharing one with a mod you have never met

`family` is the set of rungs a value climbs WITHIN. It exists because one kind
can span scales that must never interleave: bits and bytes are both `data` and
share a dimension so a link budget and a file size stay convertible, but a byte
quantity landing on a bit rung would read `32 kbit/s` where it means `4 kB/s`.
Ladders key on family, so each keeps its own rungs.

Two Uplinks may declare into the SAME family, and should when they mean the
same thing by it: a megabyte is nobody's private invention. Declaring a symbol
identically twice is a no-op, so independent mods coalesce without coordinating.
Declaring it DIFFERENTLY throws, because which one won would otherwise depend on
module load order and the number on screen would change with it.

Core owns only a dimension's base (`bit` for data), so that mods cannot diverge
on the axis by accident. Rungs and families belong to whoever models them.

### Testing it

`<Unit>` renders the number, the symbol, and a visually hidden word as separate
elements, so a readout is **not one text node** and `getByText("12.4 kW")` finds
nothing. `@ksp-gonogo/ui-kit/testing` is how you read it back:

```ts
// client/src/Reactor/readout.test.ts
import { value } from "@ksp-gonogo/sitrep-sdk";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { expect, it } from "vitest";

it("shows the output it was given", () => {
  // What a sighted reader sees, screen-reader words stripped.
  expect(visibleText()).toContain("12.4 kW");

  // Or assert the QUANTITY without pinning how it is spelled. `toShowQuantity`
  // comes from the `expect.extend` in the setup file above. 12400 W is what
  // the kit renders as "12.4 kW": the magnitude is in the unit the token
  // names, and the ladder picks the rung.
  expect(document.body).toShowQuantity(value("W", 12400));
});
```

Prefer the matcher when you mean "the widget shows the output it was given":
it formats through the same ladder the component renders with, so a later
change to where watts hand off to kilowatts does not break your test. Use the
literal string when the exact spelling is the thing you mean to pin.

**Pin the locale in your test setup.** `<Unit>` writes a number in the
reader's own locale, which is right for an operator and wrong for a snapshot:
the same reading is `1,234,567.5` here, `1 234 567,5` in France and
`12,34,567.5` in India. `setQuantityLocale("en-GB")` in the setup file above is
what fixes it.

### Guarding it

The rule above is easy to agree with and easy to forget, so do not rely on
remembering it. One test file holds you to it:

```ts
// client/src/units.guard.test.ts
import { expectNoHandTypedUnits } from "@ksp-gonogo/ui-kit/guards";
import { it } from "vitest";

it("types no unit symbol next to a number", () => {
  expectNoHandTypedUnits({ dir: "src" });
});
```

It walks your source for a `${...}` interpolation followed by a unit symbol,
skips tests, build output and CSS lengths (`width: ${pct}%` is not a readout),
skips comments so a file explaining the rule is not its own first offender, and
throws naming the file, the line and the fix.

**This is not a hypothetical tidiness rule.** The first-party app grew eleven
private unit ladders before anyone noticed, and unpicking them took days. Its
own guard then globbed `packages/` and stopped, so three of the bundled Uplinks
did the same thing again: a signal badge doing its own `* 100` on a value that
already carried `ratio`, a coverage readout, two latitudes, and a
metres-to-kilometres divide written out three times. Nothing was wrong with the
authors. Nothing was watching.

Two options worth knowing:

- **`symbols`** extends what it looks for. If you `registerUnit({ symbol: "Sv" })`,
  pass `symbols: [...HAND_TYPED_SYMBOLS, "Sv"]` so the guard notices when
  somebody writes yours by hand instead
- **`baseline`** is a per-file allowance, for adopting this on a codebase that
  already has offenders: `baseline: { "Reactor/index.tsx": 3 }`, lowered as you
  convert. Never raise one. Going BELOW an entry throws too, so a stale
  allowance cannot quietly leave the door open behind a conversion

Skip the guard only if your Uplink renders nothing at all, which is a narrower
case than it sounds: one bundled Uplink was exactly that when this was written,
and it now ships several widgets, a `ui-kit` dependency, and its own byte units.
An Uplink that renders nothing today is an Uplink that renders something the
week after.

---

## Checklist

- [ ] mod class carries `[SitrepUplink("<id>")]`, implements `ISitrepUplink`, and declares its Topics
      (`Channels`) and Commands, including a `<id>.available` presence channel it publishes itself
- [ ] the manifest declares `Name`/`Author`/`Repo`, and a `ClientSource.Url` plus
      `ExpectedClientHash`, which is how the app finds and verifies your bundle
- [ ] every Topic mapper returns a serializer-writable shape (a `Dictionary<string, object?>`), never
      a POCO of your own
- [ ] `Health()` returns a cached verdict, never a live KSP read
- [ ] the wire types live in their own `.Contract` project, with a `.Contract.Codegen` twin, and the
      SHIPPED contract assembly carries no Reinforced.Typings reference
- [ ] `src/__generated__/` is codegen output, committed and never hand-edited
- [ ] `client/src/uplink.ts` calls `defineUplinkClient` with the SAME id as the mod, and a `version`
      equal to `package.json`'s
- [ ] `client/src/topics.ts` merges `TopicPayloadMap`, calls `registerBarePrimitiveTopic` for every
      Topic, and registers BOTH the topic-keyed and the type-keyed unit maps
- [ ] every command's args class carries `[SitrepCommand("<id>")]`, and `client/src/commands.ts`
      merges `CommandArgsMap`/`CommandReplyMap` and calls `registerUplinkCommand` for every id
- [ ] every `registerComponent` / `registerAugment` passes `owner: <handle>`, and every registration
      carries a `description` and `tags`
- [ ] every `useTelemetry` read branches on `Reading.state`; no cast past the union, and no judgement
      (a pill, a band, a go/no-go) drawn from `stale`
- [ ] every delayed command's handle reaches `usePanelDelay` or `<CommandDelay>`
- [ ] `client/src/index.ts` bare-imports every registration module, and RE-EXPORTS `topics.ts` and
      `commands.ts` by name so their `declare module` augmentations reach `dist/index.d.ts`
- [ ] the bundle is built external-expecting (react, styled-components, sdk, ui-kit NOT inlined), and
      imports nothing else of gonogo's
- [ ] `uplink.json` declares the id, name, author and repo, so `gonogo-uplink bundle` can run
- [ ] `gonogo-uplink.json` is build-generated, never hand-written, and generated with `--bundle` for a
      release so `integrity` is filled
- [ ] the mod is on CKAN and the client bundle is hosted with its URL + integrity hash
- [ ] every quantity renders through `<Unit>`; no hand-formatted unit symbols
- [ ] every unit token you introduce is declared in your own `<Name>Units` class (never named plainly
      `Units`, which shadows core's), and registered on both seams: dimension and ratio with the SDK,
      family and rungs with ui-kit
- [ ] `expectNoHandTypedUnits({ dir: "src" })` runs as a test (skip only if the Uplink renders nothing)
- [ ] the test setup calls `setQuantityLocale("en-GB")`, so a render is reproducible
- [ ] tests import `@ksp-gonogo/sitrep-sdk/testing` and `@ksp-gonogo/ui-kit/testing`, and nothing in `src/` does
- [ ] every widget has at least one fixture, `gonogo-uplink docs` runs, and `docs --check` is in CI
- [ ] widget tests read readouts with `visibleText` / `toShowQuantity`, not `getByText`
- [ ] the main screen is served over https or localhost so integrity verification works
