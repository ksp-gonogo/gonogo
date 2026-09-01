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

Keep both halves in one repo. The first-party shape is four sibling projects plus the client, and it is
worth mirroring, because the split between the mod and its **contract** is load-bearing rather than
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
        index.ts                  # side-effect registration entry point
        Reactor/index.tsx         # a widget, registered with owner: EXAMPLE
        __generated__/            # codegen output, never hand-edited
        test/setup.ts
  ExampleUplink.Contract/         # the wire types, referencing only Sitrep.Contract
  ExampleUplink.Contract.Codegen/ # the codegen-only twin of the above
  ExampleUplink.Tests/
```

The client is nested under the mod directory rather than beside it because the two halves version and
ship together, and because `gonogo-uplink bundle` searches up to three levels above the client for
`uplink.json`, so either arrangement is found.

---

## Part 1: the mod half

A mod class implements `ISitrepUplink` and carries the `[SitrepUplink("<id>")]` attribute. The host
discovers it by that attribute, reads its `UplinkManifest`, and calls `Register`. The `id` in the
attribute is the identity that ties the two halves together: it MUST match your client's
`defineUplinkClient` id and your `gonogo-uplink.json` id.

```csharp
using System.Collections.Generic;
using Sitrep.Contract;
using ExampleUplink.Contract;

[SitrepUplink("example")]
public sealed class ExampleUplink : ISitrepUplink
{
    public const string ReactorTopic = "example.reactor";
    public const string SetOutputCommand = "example.setOutput";

    public UplinkManifest Manifest { get; } = new UplinkManifest
    {
        Id = "example",
        Version = "0.1.0",

        // Topics this Uplink publishes. Each ChannelDeclaration names a Topic,
        // its delivery mode, its emission cadence, and its delay role.
        Channels = new List<ChannelDeclaration>
        {
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
        // Publish a Topic: map the current game snapshot to the value.
        host.AddChannelSource(ReactorTopic, snapshot => ReadReactor(snapshot));

        // Handle a Command: typed args in, a CommandResult out.
        host.AddCommandHandler<SetOutputArgs, CommandResult>(SetOutputCommand, SetOutput);
    }

    private ReactorStatus? ReadReactor(KspSnapshot? snapshot) => /* ... */ null;
    private CommandResult SetOutput(SetOutputArgs args) => CommandResult.Ok();
}
```

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
FrameParameters()   default branch -> Log.Fatal("Unexpected frame_type …")
Name()              -> Log.Fatal("Unexpected type …"), plus three root-body cases
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
using Sitrep.Contract;

namespace ExampleUplink.Contract
{
    [SitrepTopic("example.reactor")]
    public sealed class ReactorStatus
    {
        [SitrepUnit(Units.Flag)]
        public bool Online { get; set; }

        [SitrepUnit("kW")]
        public double OutputPower { get; set; }

        [SitrepUnit("K")]
        public double CoreTemp { get; set; }

        // A token the core catalog has never heard of is FINE: the generated
        // SitrepUnit union is open. Declare it in your OWN Units class (see
        // "Your own catalog") so a typo still fails, then teach the client
        // what it means.
        [SitrepUnit("thermalUnits")]
        public double Throughput { get; set; }
    }

    public sealed class SetOutputArgs
    {
        public double TargetPower { get; set; }
    }
}
```

**2. Add a codegen-only TWIN of that project.** Reinforced.Typings drives codegen by reading
`[TsInterface]`/`[TsEnum]` out of an assembly's metadata, so those attributes have to be compiled into
something, and it must not be the assembly you ship. A shipped contract assembly holding a metadata
reference to `Reinforced.Typings.dll` while being deployed without it throws
`FileNotFoundException` from anything that asks one of its types for its attributes, and
`Enum.ToString()` asks, because enum formatting looks for `[Flags]`. Nine contract projects in this
repo had that leak.

So `ExampleUplink.Contract.Codegen` recompiles the SAME sources with `SITREP_CODEGEN` defined, which is
the only configuration in which the RT attributes and your `RtConfig` class exist at all. Nothing
references the twin and nothing ships it. `mod/CodegenTwin.props` is the shared shape; a twin is five
lines:

```text
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <CodegenTwinSource>..\ExampleUplink.Contract</CodegenTwinSource>
    <AssemblyName>ExampleUplink.Contract</AssemblyName>
    <RootNamespace>ExampleUplink</RootNamespace>
  </PropertyGroup>
  <Import Project="..\CodegenTwin.props" />
</Project>
```

Keeping `AssemblyName` equal to the shipped assembly's name matters: rtcli sees the same assembly
identity, type names and member order, so the generated TypeScript does not churn.

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
                .AutoOptionalProperties());

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

DOTNET_ROLL_FORWARD=LatestMajor \
  EXAMPLE_TOPICMAP_OUT="$OUT/topic-map.ts" \
  EXAMPLE_UNITMAP_OUT="$OUT/units.ts" \
  EXAMPLE_UNITJSON_OUT="$OUT/units.json" \
  dotnet "$RT_PKG/tools/net5.0/rtcli.dll" \
  SourceAssemblies="ExampleUplink.Contract.Codegen/bin/Debug/netstandard2.0/ExampleUplink.Contract.dll" \
  TargetFile="$OUT/contract.ts" \
  ConfigurationMethod="ExampleUplink.Contract.ExampleRtConfig.Configure"
```

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

Here is the smallest complete widget, reading the bare boolean Topic:

```tsx
// client/src/Presence/index.tsx
import type { ComponentProps } from "@ksp-gonogo/sitrep-sdk";
import { registerComponent, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import { Panel, StatusPill } from "@ksp-gonogo/ui-kit";
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

  return (
    <Panel panelTitle="Reactor" compactTitle={["REACTOR", "RTR"]}>
      <StatusPill $tone={online ? "go" : "warning"}>
        {online ? "ONLINE" : "NO READING"}
      </StatusPill>
    </Panel>
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

`useTelemetry` does not answer your payload. It answers a `Reading` of it, a six-arm discriminated
union, and there is no arm you can read a value off without first writing the discriminant:

```text
type Reading<T> =
  | { state: "pending" }
  | { state: "unowned" }
  | { state: "absent";      atUt: Value<"ut"> }
  | { state: "observed";    value: T; atUt: Value<"ut"> }
  | { state: "stale";       value: T; asOfUt: Value<"ut">; grade: StaleGrade }
  | { state: "reckonable";  value: T; asOfUt: Value<"ut">; grade: StaleGrade;
                            reckoned: Reckoning<T> };
```

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
- **`stale`**: updates we should have had did not arrive, and nothing can honestly model the gap.
  `value` is the last REAL observation and `asOfUt` says when it was made. This is the honest majority
- **`reckonable`**: updates were missed AND a model exists. Carries the last real observation exactly as
  `stale` does, plus `reckoned`, the forward-modelled value for this frame

`grade` says which kind of missed update it was (`held-stale`, `disconnected`, `last-before-blackout`),
and it labels the same render rather than changing it, which is why it is a field and not three more
arms. `reckoned` is a required field on its own arm, because an optional one is a field a destructuring
consumer ignores by default, and silently dropping a reckoning while the widget still looked right is
precisely what this type prevents.

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
 * The value to draw, and what to say about its currency. One branch per arm,
 * and the compiler will not let you leave one out, so a seventh arm added
 * later fails here rather than rendering as blank.
 */
function present(reading: Reading<ReactorStatus>): {
  caption: string;
  status?: ReactorStatus;
} {
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
    case "reckonable":
      // The modelled value for THIS frame, not the last observation. Draw
      // `reading.value` instead and you have declined to propagate, which is
      // legitimate and should be written as `withoutReckoning(reading)` so it
      // is greppable.
      return {
        caption: `modelled forward from ${writeQuantity(reading.asOfUt)}`,
        status: reading.reckoned.value,
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
  as the situation NOW, and a judgement cannot be dated. Draw those from `observed` and `reckonable`
  only, and say nothing on `stale`. A stale GO is the worst thing a widget can draw

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
```

Both halves come off the generated map rather than a list written here, so a command you add to your
contract later needs no new line. Re-export this module from `client/src/index.ts` (`export {} from
"./commands"`, not a bare `import`), for the same reason `topics.ts` is re-exported: a bare import is
elided from the emitted `dist/index.d.ts` and the augmentation never crosses the package boundary.

What fills the map is the `[SitrepCommand]` attribute on your args class, in your contract slice:

```csharp
[SitrepContract]
[TsInterface]
[SitrepCommand("example.setOutput")]
public class SetOutputArgs
{
    [SitrepUnit(Units.Kilowatts)]
    public double TargetPower { get; set; }
}
```

One args class can carry several tags where one shape serves several commands. `Payload = typeof(T)`
names the `T` of a handler's `CommandResult<T>`; leave it off and the command resolves a bare
`CommandResult`, which is success or nothing more. A command that takes no arguments carries its tag
on an empty marker class of your own, the way a no-payload DTO already works.

A command id you have NOT registered still dispatches: it falls to `useCommand`'s untyped overload and
`send` stays `(args?: unknown) => Promise<unknown>`, which is where every call was before the map
existed. That overload is the escape hatch for a DYNAMIC command whose id is computed per subject and
so can have no static member:

```ts
const reset = useCommand<{ id: string }>(`example.probe.${probeId}.reset`);
```

**A resolved reply is always a command that ran.** The game refusing is a REJECTION carrying a
`CommandErrorCode`, and it also lands on `refusals` above, so `CommandResult` in the reply position
never means "said no quietly".

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

`client/src/index.ts` is the entry the app loads. Registration happens as a side effect of import, so keep
the registration imports as **bare imports** (never let a bundler tree-shake them away):

```ts
// client/src/index.ts
import "./uplink"; // defineUplinkClient(EXAMPLE) runs first
import "./topics"; // the Topic types and the runtime registrations
import "./Presence"; // registerComponent(... owner: EXAMPLE)
import "./Reactor"; // ditto
```

---

## The one version line and the compat gate

An Uplink has **one version** spanning both halves. You never hand-write the compatibility numbers: a
build step generates `gonogo-uplink.json`, the sidecar manifest that ships next to your client bundle.
Its shape:

```json
{
  "id": "example",
  "version": "0.1.0",
  "description": "Reactor output, core temperature and throughput, from the example mod.",
  "minAppVersion": "1.0.0",
  "apiVersion": "1.0.0",
  "uiKitVersion": "0.2.0",
  "contractMajor": 14,
  "contractMinor": 5,
  "integrity": "sha256-2b1f…"
}
```

- **`description`** is what you declared on `defineUplinkClient`, and it is the subtitle on your
  generated README
- **`apiVersion`** pins the `@ksp-gonogo/sitrep-sdk` authoring surface you built against
  (`EXTENSION_API_VERSION`)
- **`uiKitVersion`** pins the `@ksp-gonogo/ui-kit` design-system surface (`UI_KIT_VERSION`)
- **`contractMajor`/`contractMinor`** pin the telemetry contract your Topics and Commands speak
- **`minAppVersion`** is an advisory floor, and the one field nothing can derive, because it is a claim
  about the APP rather than about your code. Declare it in your `package.json` under
  `"gonogo": { "minAppVersion": "1.4.0" }`
- **`integrity`** is `sha256-` plus the hex sha256 of the file you DISTRIBUTE

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

Build these numbers, never type them. The mod side bakes its matching client hash the same way
(`gonogo-uplink bake-hash`, or `mod/scripts/bake-client-hash.mjs` in this repo, which writes
`ExpectedClientHash.g.cs`), so the running mod can vouch for the exact bundle it expects.

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
- Host your **client bundle** yourself (a static host, a release asset, your own server) and ship its URL
  alongside the mod
- The app's registry descriptor for your Uplink carries the `bundleUrl` and the `integrity` hash

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

1. resolve the version to load from the registry descriptor
2. run the compat gate + the mod-hash gate **before fetching any bytes** (import is irreversible, so
   nothing is fetched for an Uplink that will be refused)
3. ask for **consent** on first load of a given `id@version` (a remembered grant short-circuits next time)
4. fetch the bundle bytes
5. verify `sha256(bytes)` against the descriptor's `integrity`, and against the hash the running mod
   vouches for when it emits one (a three-way agreement: mod, index, bytes)
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

What is NOT built is pointing a running app at a local bundle: a localhost dev-server URL or a local
directory in place of the published `bundleUrl`, so you could watch a real dashboard update as you
edit. That is gated behind on-device work and remains a promise this guide is making, not a button that
exists today. Until it lands, seeing your widget inside a live app means building a bundle with
`gonogo-uplink bundle` and serving it from a local static host over `https` or `localhost`, which
verifies the way the real path does, at the cost of a rebuild per edit.

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
import { render, screen, setupStreamFixture, waitFor } from "@ksp-gonogo/sitrep-sdk/testing";
import { expect, it } from "vitest";
import { ReactorWidget } from "./index";

it("shows the reactor's output once a frame arrives", async () => {
  const fixture = setupStreamFixture({
    carriedChannels: ["example.reactor"], // required: nothing is promoted silently
    pinnedUt: 1000, // omit to leave the clock live
  });

  render(
    <fixture.Provider>
      <ReactorWidget id="example-reactor" />
    </fixture.Provider>,
  );

  await waitFor(() => expect(fixture.transport.isSubscribed("example.reactor")).toBe(true));
  fixture.emit("example.reactor", { outputPower: { magnitude: 420, unit: "kW" } });

  await waitFor(() => expect(screen.getByText("420")).toBeInTheDocument());
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
`theme.space[…]` off the styled-components context, and with no provider that is a
TypeError rather than a fallback. Everything else Testing Library offers
(`screen`, `waitFor`, `within`, `act`, `fireEvent`) is re-exported unchanged, so
this is a drop-in for the import source.

For a widget rather than a plain component, `renderWidget` from
`@ksp-gonogo/ui-kit/testing` mounts it inside the same provider stack the dashboard
puts around one. A widget rendered bare is a widget the app never runs: `Panel`
reads its stream status off a provider, so with none mounted the status badge never
appears and a `waitFor` on it returns having proved nothing.

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

- **one section costs nothing.** `sections={<Section>…</Section>}` is the normal
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
carrying the magnitude AND the unit, not a bare number. Render it with `<Unit>`
and name neither:

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

Declare the tokens you introduce in a public static `Units` class in your
contract project. Codegen judges your assembly against core's catalog PLUS
yours, so an undeclared token stops the build instead of reaching the client as
an opaque symbol with no dimension and no ladder. There is no first-party
exemption: the rule that applies to the Uplinks shipped in this repo is the one
that applies to yours.

```csharp
namespace ExampleUplink.Contract
{
    public static class Units
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
  // comes from the `expect.extend` in the setup file above.
  expect(document.body).toShowQuantity(value("kW", 12400));
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
      (`Channels`) and Commands
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
- [ ] `client/src/index.ts` bare-imports every registration module
- [ ] the bundle is built external-expecting (react, styled-components, sdk, ui-kit NOT inlined), and
      imports nothing else of gonogo's
- [ ] `uplink.json` declares the id, name, author and repo, so `gonogo-uplink bundle` can run
- [ ] `gonogo-uplink.json` is build-generated, never hand-written, and generated with `--bundle` for a
      release so `integrity` is filled
- [ ] the mod is on CKAN and the client bundle is hosted with its URL + integrity hash
- [ ] every quantity renders through `<Unit>`; no hand-formatted unit symbols
- [ ] every unit token you introduce is declared in your own `Units` class, and registered on both
      seams: dimension and ratio with the SDK, family and rungs with ui-kit
- [ ] `expectNoHandTypedUnits({ dir: "src" })` runs as a test (skip only if the Uplink renders nothing)
- [ ] the test setup calls `setQuantityLocale("en-GB")`, so a render is reproducible
- [ ] tests import `@ksp-gonogo/sitrep-sdk/testing` and `@ksp-gonogo/ui-kit/testing`, and nothing in `src/` does
- [ ] every widget has at least one fixture, `gonogo-uplink docs` runs, and `docs --check` is in CI
- [ ] widget tests read readouts with `visibleText` / `toShowQuantity`, not `getByText`
- [ ] the main screen is served over https or localhost so integrity verification works
